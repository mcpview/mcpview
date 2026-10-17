/**
 * Tasks extension — server-side store (io.modelcontextprotocol/tasks, SEP-2663).
 *
 * Implements the background-task lifecycle defined by the spec 2026-07-28
 * experimental extension: spawning, polling, client-input handshake, and
 * cooperative cancellation.
 *
 * **Pure module** — no framework imports, no HTTP. Everything here is
 * testable by constructing a `TaskStore` directly and calling its methods.
 * The shape mirrors `request-headers.ts`: all spec-derived rules live here,
 * the transport layer only calls `spawn / get / update / cancel`.
 *
 * @module lib/server/tasks/task-store
 */
import { METHOD_TO_CAPABILITY } from "../mrtr/capability-check.ts";

// ── Entropy ──────────────────────────────────────────────────────────────────

/**
 * Produce a cryptographically-random task ID.
 *
 * 128 bits of entropy (32 lowercase hex chars). Spec §Security Considerations:
 * "Task IDs MUST be generated with sufficient entropy that a third party cannot
 * enumerate or guess them." 128 bits satisfies that at the same level as a
 * UUID v4 but without the version/variant bits that reduce its effective
 * entropy to 122 bits.
 */
export function generateTaskId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Options a tool handler provides when opting into async-task mode.
 *
 * All fields are optional; `TaskStore` fills defaults from its own options.
 */
export interface CreateTaskOptions {
  /**
   * TTL in ms from creation. `null` = no expiry (held until maxTasks eviction).
   * Spec is silent on a default — callers omit this to get the store default.
   */
  ttlMs?: number | null;
  /**
   * Hint to the client: how often to call tasks/get (ms).
   * Spec §Task Polling: clients SHOULD respect this.
   * Default chosen as 5 000 ms — practical minimum that avoids hammering the
   * server without causing noticeable delays on human-facing workflows.
   */
  pollIntervalMs?: number;
  /** Human-readable description of the initial working state. */
  statusMessage?: string;
}

/**
 * One outstanding server-to-client request, registered in `inputRequests`.
 *
 * Shape is intentionally minimal: it mirrors the spec's `InputRequest` type
 * (method + params). The protocol is open-ended — concrete method names are
 * defined per-extension (e.g. `sampling/createMessage`).
 */
export interface InputRequest {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/**
 * Interface the running task's work function uses to interact with the store.
 *
 * Design rule: `TaskController` is never stored by the framework after the
 * `run()` promise settles. Tool handlers MUST NOT hold it past the promise.
 */
export interface TaskController {
  /**
   * Block the running work until the client delivers a response for `key`.
   *
   * Registers the request under `key` in `inputRequests` (moves task to
   * `input_required`) and resolves with the client-provided response when
   * `tasks/update` carries that key.
   *
   * Rejects with `DOMException("Task was cancelled", "AbortError")` if the
   * task is cancelled while waiting.
   *
   * Spec §Task Update Requests: "Each inputRequests key MUST be unique over
   * the entire lifetime of a single task. Server MUST NOT reuse a key after
   * a response for that key has been delivered."
   */
  requireInput(
    key: string,
    request: InputRequest,
  ): Promise<Record<string, unknown>>;

  /** Update the status message visible on the next tasks/get. */
  setStatusMessage(msg: string): void;

  /**
   * AbortSignal that fires when tasks/cancel is received.
   * Long-running work SHOULD check this to short-circuit early.
   * Spec: cancellation is cooperative — the task may still finish normally.
   */
  readonly signal: AbortSignal;
}

/**
 * Discriminated return value: a tool handler returns this to ask the framework
 * to materialise an async task instead of a synchronous result.
 *
 * Use `createTask()` to construct; do not build this object manually — the
 * `_type` discriminant is what `isAsyncTaskDescriptor()` keys on.
 */
export interface AsyncTaskDescriptor {
  readonly _type: "async-task";
  readonly options: CreateTaskOptions;
  /**
   * Background work. Return value becomes `CompletedTask.result`.
   *
   * To signal a protocol-level failure (→ `FailedTask`), throw an object with
   * `{ code: number; message: string }`. This mirrors JSON-RPC error shape and
   * is the spec's definition of the `failed` status.
   *
   * A tool-level business error (the ERPNext equivalent of "order not found")
   * MUST NOT throw — it should be returned as part of the normal result, which
   * reaches `completed`. Spec: "The 'failed' status MUST NOT be used for
   * non-JSON-RPC errors. A tool result with isError: true reaches 'completed',
   * not 'failed'."
   */
  readonly run: (ctrl: TaskController) => Promise<unknown>;
}

// ── Task shapes (mirroring spec TypeScript interfaces) ───────────────────────

/** Base fields shared by every task shape. */
export interface Task {
  taskId: string;
  status: "working" | "input_required" | "completed" | "cancelled" | "failed";
  statusMessage?: string;
  createdAt: string; // ISO 8601
  lastUpdatedAt: string; // ISO 8601
  ttlMs: number | null;
  pollIntervalMs?: number;
}

export interface WorkingTask extends Task {
  status: "working";
}

export interface InputRequiredTask extends Task {
  status: "input_required";
  /** All outstanding server-to-client requests, keyed by a unique caller-chosen identifier. */
  inputRequests: Record<string, InputRequest>;
}

export interface CompletedTask extends Task {
  status: "completed";
  result: Record<string, unknown>;
}

export interface FailedTask extends Task {
  status: "failed";
  error: Record<string, unknown>;
}

export interface CancelledTask extends Task {
  status: "cancelled";
}

/** Discriminated union of all possible task states. */
export type DetailedTask =
  | WorkingTask
  | InputRequiredTask
  | CompletedTask
  | FailedTask
  | CancelledTask;

/**
 * Fields returned as the initial result when tools/call spawns a task.
 *
 * `resultType: "task"` is added by the transport layer (NOT by stampResult —
 * stampResult always sets `"complete"`, and CreateTaskResult requires `"task"`.
 * The caller builds the response manually; see integration instructions.)
 */
export type CreateTaskResultFields = Task;

// ── TaskStore options ─────────────────────────────────────────────────────────

export interface TaskStoreOptions {
  /**
   * Default TTL for tasks whose handler did not provide one.
   *
   * Spec is silent. 3 600 000 ms (1 h) chosen because it's long enough for
   * realistic ERPNext whole-table scans (stock treemap, revenue aggregations)
   * but short enough to bound memory in a long-running server.
   */
  defaultTtlMs: number;

  /**
   * Hard cap on stored tasks (terminal + non-terminal combined).
   *
   * Spec is silent. 5 000 chosen as half the session cap (10 000) since each
   * task can carry an arbitrarily large `result` payload, so the per-entry
   * cost is higher than a session entry.
   *
   * Eviction order when the cap is reached: terminal tasks first (by
   * `terminalAt`, oldest first), then oldest non-terminal by `createdAt`.
   * Terminal tasks have already served their purpose; evicting them first is
   * the least-harmful policy.
   */
  maxTasks: number;

  /**
   * How often to sweep tasks for TTL expiry.
   *
   * Piggybacking on the same 5-minute rhythm as the session cleanup in
   * McpApp keeps operational patterns consistent. Not exposed to callers
   * as a tunable because the appropriate value tracks the session timer.
   */
  cleanupIntervalMs: number;

  /**
   * Optional callback invoked on every status transition.
   *
   * Intended as the wiring point for Track G (subscriptions/listen): once
   * that lands, the subscription layer registers here and the TaskStore
   * drives notifications without knowing about SSE or HTTP. No-op until
   * Track G ships.
   */
  onNotification?: (task: DetailedTask) => void;

  /**
   * Runtime hook to unref the sweep timer, so it cannot hold the process open.
   *
   * Injected rather than imported: the store is runtime-agnostic, and Deno and
   * Node expose different mechanisms for this.
   */
  unrefTimer?: (id: ReturnType<typeof setInterval>) => void;
}

// ── Private internal representation ──────────────────────────────────────────

/** Terminal statuses — once in one of these, no further transitions occur. */
const TERMINAL_STATUSES = new Set<string>([
  "completed",
  "cancelled",
  "failed",
]);

function isTerminal(
  status: "working" | "input_required" | "completed" | "cancelled" | "failed",
): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Internal representation of a running task.
 * Not exported — callers get `DetailedTask` snapshots via `get()`.
 */
interface InternalTask {
  taskId: string;
  /**
   * Principal that created the task.
   *
   * The spec requires an authorization check on every task-related request. A
   * task id is an unguessable bearer token, but that alone is one line of
   * defence: any caller who learns an id could otherwise read, answer or cancel
   * another caller's task. Comparing the owner closes that.
   */
  owner: string;
  status: "working" | "input_required" | "completed" | "cancelled" | "failed";
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number | null;
  pollIntervalMs?: number;

  abortController: AbortController;
  /** Settled when run() completes; attached for drain() / observability. */
  runPromise: Promise<void>;

  /**
   * Outstanding server-to-client input requests.
   *
   * Present for all statuses so snapshot reads don't need a null-check.
   * Non-empty only when status === "input_required".
   */
  inputRequests: Map<string, InputRequest>;

  /**
   * Keys that have been answered by the client.
   *
   * Spec §Task Update Requests: "Server MUST NOT reuse a key after a
   * response for that key has been delivered." Enforced in requireInput().
   */
  answeredKeys: Set<string>;

  /**
   * Pending resolvers waiting for the client's response.
   * Parallel to `inputRequests`: one entry per outstanding requireInput() call.
   */
  pendingResolvers: Map<string, (response: Record<string, unknown>) => void>;

  /** Set when status === "completed". */
  result?: Record<string, unknown>;
  /** Set when status === "failed". */
  error?: Record<string, unknown>;
  /** Unix timestamp (ms) when the task entered a terminal state. Used for eviction ordering. */
  terminalAt?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Narrow a value to a plain object (not null, not array). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Reduce a task input request to the exact JSON shape the task snapshot will
 * expose, then verify the required InputRequest fields on that shape.
 *
 * Task handlers are TypeScript callers, but a JavaScript handler (or an `any`
 * escape hatch) can pass any value here. Storing it first was unsafe: a non-string
 * key could throw only when a later tasks/get built its snapshot, and `null`
 * requests were emitted as invalid protocol objects. Canonicalising once at the
 * boundary keeps the stored value and the wire value identical.
 */
function canonicaliseTaskInputRequest(
  key: unknown,
  request: unknown,
):
  | { ok: true; key: string; request: InputRequest }
  | { ok: false; message: string } {
  if (typeof key !== "string") {
    return {
      ok: false,
      message: "Invalid task input request key: expected a string.",
    };
  }

  let canonical: unknown;
  try {
    const serialised = JSON.stringify(request);
    if (serialised === undefined) throw new Error("not JSON-serialisable");
    canonical = JSON.parse(serialised);
  } catch {
    return {
      ok: false,
      message:
        "Invalid task input request: it must be a JSON-serialisable object with a string method and object params.",
    };
  }

  if (
    !isRecord(canonical) || typeof canonical["method"] !== "string" ||
    !isRecord(canonical["params"])
  ) {
    return {
      ok: false,
      message:
        "Invalid task input request: expected an object with a string method and object params.",
    };
  }

  // The method must be one a client can actually service. Accepting any string let
  // a task ask for something like `client/request`, for which no client has a
  // handler — so the task STRANDS in `input_required` forever instead of failing.
  // A stranded task is worse than a failed one: it consumes a poll loop and never
  // resolves. Same grammar as MRTR, from the same table, so the two boundaries
  // cannot drift apart.
  if (!Object.hasOwn(METHOD_TO_CAPABILITY, canonical["method"])) {
    return {
      ok: false,
      message: `Invalid task input request: unsupported method "${
        canonical["method"]
      }". Permitted: ${Object.keys(METHOD_TO_CAPABILITY).join(", ")}.`,
    };
  }

  return {
    ok: true,
    key,
    request: canonical as unknown as InputRequest,
  };
}

/**
 * Determine whether a thrown value looks like a JSON-RPC error.
 *
 * Spec: "The 'failed' status MUST NOT be used for non-JSON-RPC errors."
 * A JSON-RPC error must have `code` (integer) and `message` (string).
 * Tool handlers that want to signal `failed` throw exactly this shape.
 */
function isJsonRpcError(v: unknown): v is { code: number; message: string } {
  return isRecord(v) && typeof v["code"] === "number" &&
    Number.isInteger(v["code"]) && typeof v["message"] === "string";
}

/**
 * Convert internal task state to the spec's public DetailedTask shape.
 *
 * This is the only place where the internal Map is converted to a Record
 * for the `inputRequests` field — keeping the internal representation as a
 * Map avoids O(n) conversions on every requireInput/update call.
 */
function toDetailedTask(internal: InternalTask): DetailedTask {
  const base: Task = {
    taskId: internal.taskId,
    status: internal.status,
    createdAt: internal.createdAt,
    lastUpdatedAt: internal.lastUpdatedAt,
    ttlMs: internal.ttlMs,
    ...(internal.statusMessage !== undefined
      ? { statusMessage: internal.statusMessage }
      : {}),
    ...(internal.pollIntervalMs !== undefined
      ? { pollIntervalMs: internal.pollIntervalMs }
      : {}),
  };

  switch (internal.status) {
    case "working":
      return { ...base, status: "working" };
    case "input_required": {
      // Object.fromEntries creates own data properties even for `__proto__`,
      // `constructor`, and `toString`. Assigning those keys to `{}` can mutate
      // or shadow its prototype instead of faithfully producing the JSON map the
      // client must receive.
      const inputRequests = Object.fromEntries(internal.inputRequests);
      return { ...base, status: "input_required", inputRequests };
    }
    case "completed":
      return { ...base, status: "completed", result: internal.result! };
    case "failed":
      return { ...base, status: "failed", error: internal.error! };
    case "cancelled":
      return { ...base, status: "cancelled" };
  }
}

/**
 * Wrap a run() result in the required `Record<string, unknown>` shape.
 *
 * Tool handlers may return any serialisable value. The spec models
 * `CompletedTask.result` as an object, so a primitive or array is boxed
 * under `"value"` rather than discarded or cast dangerously.
 */
function normaliseResult(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw;
  return { value: raw };
}

// ── Public factory / type-guard ────────────────────────────────────────────────

/**
 * Factory for tool handlers that want to run asynchronously.
 *
 * Returns an `AsyncTaskDescriptor` the framework detects and routes through
 * the `TaskStore`. The handler never sees the store directly — it only receives
 * the `TaskController` when `run()` is invoked.
 *
 * @example
 * ```typescript
 * // Inside a tool handler:
 * return createTask({ ttlMs: 60_000, pollIntervalMs: 3_000 }, async (ctrl) => {
 *   const rows = await scanWholeTable(args, ctrl.signal);
 *   return { rows };
 * });
 * ```
 */
export function createTask(
  options: CreateTaskOptions,
  run: (ctrl: TaskController) => Promise<unknown>,
): AsyncTaskDescriptor {
  return { _type: "async-task", options, run };
}

/**
 * Type guard used by the transport to distinguish an `AsyncTaskDescriptor`
 * from an ordinary tool result.
 *
 * Checks the private `_type` discriminant rather than shape-matching public
 * fields, so a tool result that happens to carry similar fields is never
 * misidentified.
 */
export function isAsyncTaskDescriptor(v: unknown): v is AsyncTaskDescriptor {
  // Two-step cast through `unknown` is intentional: `Record<string, unknown>`
  // and `AsyncTaskDescriptor` have no proven overlap, so TypeScript requires
  // the intermediate step. The runtime check on `_type` and `run` is the
  // actual guard; the cast merely satisfies the type checker.
  return isRecord(v) && v["_type"] === "async-task" &&
    typeof (v as unknown as AsyncTaskDescriptor).run === "function";
}

// ── TaskStore ──────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: TaskStoreOptions = {
  defaultTtlMs: 3_600_000, // 1 hour — see TaskStoreOptions.defaultTtlMs doc
  maxTasks: 5_000, // see TaskStoreOptions.maxTasks doc
  cleanupIntervalMs: 5 * 60 * 1_000, // 5 minutes, matching session cleanup
};

/**
 * Server-side store for background tasks spawned by the Tasks extension.
 *
 * Responsibilities:
 * - Issue unique, unguessable task IDs.
 * - Store task state and transition it as work progresses.
 * - Route client input (tasks/update) to waiting requireInput() calls.
 * - Enforce TTL expiry and a hard memory cap via eviction.
 * - Surface a notification callback for Track G (subscriptions/listen).
 *
 * All public methods are synchronous (except the background work itself)
 * to ensure the tasks/get → tasks/update → tasks/cancel request flow
 * never blocks on I/O inside the store.
 */
export class TaskStore {
  private readonly _options: TaskStoreOptions;
  private readonly _tasks = new Map<string, InternalTask>();
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: Partial<TaskStoreOptions>) {
    this._options = { ...DEFAULT_OPTIONS, ...options };

    // Only start a cleanup timer if requested — tests pass cleanupIntervalMs: 0
    // to disable it and drive cleanup manually.
    if (this._options.cleanupIntervalMs > 0) {
      this._cleanupTimer = setInterval(
        () => this._sweep(),
        this._options.cleanupIntervalMs,
      );
      // Unref'd: a housekeeping ticker must never be the reason a process cannot
      // exit. Without this, forgetting dispose() — or failing before ever
      // reaching it — hangs the runtime instead of merely leaking a timer.
      this._options.unrefTimer?.(this._cleanupTimer);
    }
  }

  /**
   * Spawn a background task from an `AsyncTaskDescriptor`.
   *
   * MUST be called after verifying the client declared the tasks capability.
   *
   * Returns the `CreateTaskResultFields` the transport should send as the
   * result of the triggering tools/call, with `resultType: "task"` added by
   * the caller. (stampResult() sets `"complete"` and must NOT be called here.)
   *
   * Spec §Task Creation: "Server MUST NOT return CreateTaskResult until the
   * task is durably created — a subsequent tasks/get for the returned taskId
   * must resolve immediately." Fulfilled: we insert into `_tasks` before
   * returning.
   */
  spawn(
    descriptor: AsyncTaskDescriptor,
    owner: string,
    formatResult?: (raw: unknown) => Record<string, unknown>,
  ): CreateTaskResultFields {
    // A tool handler can settle after shutdown began — the pipeline is async and
    // abort is cooperative. Spawning then would start un-abortable work in a store
    // nobody will ever drain again, and the task would outlive the server that
    // created it.
    if (this._disposed) {
      throw new Error(
        "[TaskStore] Cannot spawn: the store has been disposed (server is stopping or stopped).",
      );
    }
    const taskId = generateTaskId();
    const now = new Date().toISOString();

    // Spec is silent on a default; fill from store options when the handler
    // omits ttlMs, and honour `null` explicitly (no expiry).
    const ttlMs = descriptor.options.ttlMs !== undefined
      ? descriptor.options.ttlMs
      : this._options.defaultTtlMs;

    const abortController = new AbortController();

    // Allocate internal task. runPromise is assigned below AFTER the
    // controller is built, but before spawn() returns. The controller only
    // reads/writes other fields, so the placeholder is safe for the window
    // between allocation and assignment.
    const internal: InternalTask = {
      taskId,
      owner,
      status: "working",
      createdAt: now,
      lastUpdatedAt: now,
      ttlMs,
      pollIntervalMs: descriptor.options.pollIntervalMs ?? 5_000,
      ...(descriptor.options.statusMessage !== undefined
        ? { statusMessage: descriptor.options.statusMessage }
        : {}),
      abortController,
      runPromise: Promise.resolve(), // replaced below
      inputRequests: new Map(),
      answeredKeys: new Set(),
      pendingResolvers: new Map(),
    };

    // Build the TaskController. Captures `internal` by reference so every
    // field update inside run() is visible to concurrent get() calls.
    const ctrl: TaskController = {
      signal: abortController.signal,

      requireInput: (
        key: string,
        request: InputRequest,
      ): Promise<Record<string, unknown>> => {
        const validated = canonicaliseTaskInputRequest(key, request);
        if (!validated.ok) {
          // A malformed server-side request cannot be sent back to the client.
          // Unlike an HTTP request, the correct boundary response is a terminal
          // task: the caller already holds this task's id and can observe the
          // concrete failure through tasks/get. Mark it before rejecting so a
          // handler that catches the rejection cannot accidentally complete the
          // task afterwards.
          if (!isTerminal(internal.status)) {
            internal.status = "failed";
            internal.error = {
              code: -32603,
              message: validated.message,
            };
            internal.lastUpdatedAt = new Date().toISOString();
            internal.terminalAt = Date.now();
            // Reject any earlier outstanding input waits too. Their abort
            // handlers remove the requests, so no stale input can survive this
            // terminal state.
            abortController.abort();
            this._notify(internal);
          }
          return Promise.reject(new Error(validated.message));
        }
        const canonicalKey = validated.key;

        if (isTerminal(internal.status)) {
          return Promise.reject(
            new Error(
              `Cannot require task input after the task is ${internal.status}.`,
            ),
          );
        }

        // Spec §Task Update Requests: key uniqueness is lifetime-scoped, not
        // just to currently-outstanding requests. A key used, answered, and
        // re-submitted is a server bug, not a client one.
        if (internal.answeredKeys.has(canonicalKey)) {
          return Promise.reject(
            new Error(
              `Input request key "${canonicalKey}" has already been answered in this task ` +
                `and cannot be reused (spec §Task Update Requests prohibits key reuse ` +
                `after the client has delivered a response).`,
            ),
          );
        }
        if (internal.pendingResolvers.has(canonicalKey)) {
          return Promise.reject(
            new Error(
              `Input request key "${canonicalKey}" is already outstanding in this task.`,
            ),
          );
        }

        // Register the outstanding request and transition to input_required.
        internal.inputRequests.set(canonicalKey, validated.request);
        internal.lastUpdatedAt = new Date().toISOString();
        if (internal.status === "working") {
          internal.status = "input_required";
          this._notify(internal);
        }

        return new Promise<Record<string, unknown>>((resolve, reject) => {
          internal.pendingResolvers.set(canonicalKey, resolve);

          // Fire immediately if the abort already happened (race-free via
          // the AbortSignal contract: addEventListener fires synchronously
          // when the signal is already aborted).
          const onAbort = () => {
            if (!internal.pendingResolvers.has(canonicalKey)) return; // already answered
            internal.pendingResolvers.delete(canonicalKey);
            internal.inputRequests.delete(canonicalKey);
            reject(new DOMException("Task was cancelled", "AbortError"));
          };

          abortController.signal.addEventListener("abort", onAbort, {
            once: true,
          });
        });
      },

      setStatusMessage: (msg: string): void => {
        if (isTerminal(internal.status)) return;
        internal.statusMessage = msg;
        internal.lastUpdatedAt = new Date().toISOString();
      },
    };

    // Start background work. Errors in run() are caught here to drive state
    // transitions — they must not surface as unhandled rejections, which
    // would crash the Deno process.
    const runPromise: Promise<void> = descriptor.run(ctrl).then(
      (rawResult: unknown) => {
        // Guard: a TTL sweep may have already marked this task failed while
        // the run() promise was settling. Honour the first terminal state.
        if (isTerminal(internal.status)) return;

        // A completed task carries the result the original request would have
        // returned — a CallToolResult for tools/call — not the handler's raw
        // return value. The store stays ignorant of MCP result shapes: the
        // transport injects the conversion it already uses for synchronous
        // calls, so both paths produce identical output for the same handler.
        //
        // The formatter can throw: it serialises arbitrary handler output, and a
        // BigInt or a circular structure is enough. Left unguarded that produced
        // a task marked `completed` with NO result — the one state a client
        // polling for a result cannot make sense of — plus an unhandled
        // rejection. Treat it as what it is: the work finished, the result cannot
        // be represented.
        try {
          internal.result = formatResult
            ? formatResult(rawResult)
            : normaliseResult(rawResult);
          internal.status = "completed";
        } catch (formatError) {
          internal.status = "failed";
          internal.error = {
            code: -32603,
            message: `Task result could not be serialised: ${
              formatError instanceof Error
                ? formatError.message
                : String(formatError)
            }`,
          };
        }
        internal.lastUpdatedAt = new Date().toISOString();
        internal.terminalAt = Date.now();
        this._notify(internal);
      },
      (error: unknown) => {
        if (isTerminal(internal.status)) return; // TTL/eviction won the race

        const nowStr = new Date().toISOString();
        internal.lastUpdatedAt = nowStr;
        internal.terminalAt = Date.now();

        // Distinguish abort (→ cancelled) from JSON-RPC error (→ failed)
        // from generic error (→ failed with -32603).
        if (error instanceof DOMException && error.name === "AbortError") {
          internal.status = "cancelled";
        } else if (isJsonRpcError(error)) {
          internal.status = "failed";
          // Preserve any extra fields from the thrown object (e.g. `data`).
          internal.error = { ...error };
        } else {
          // Spec: failed is for protocol-level errors. If a tool throws a
          // plain Error, we treat it as Internal Error (-32603) to stay
          // spec-compliant rather than swallowing it.
          internal.status = "failed";
          internal.error = {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          };
        }
        this._notify(internal);
      },
    );

    internal.runPromise = runPromise;

    // Evict if over cap BEFORE inserting, so the new task is always stored.
    this._maybeEvict();
    // Register BEFORE returning — spec MUST §Task Creation.
    this._tasks.set(taskId, internal);

    return toDetailedTask(internal) as CreateTaskResultFields;
  }

  /**
   * Service a tasks/get request.
   *
   * Returns `null` when the taskId is unknown or has been purged
   * (caller returns -32602).
   *
   * Spec §Task Polling: "If status is 'working', return Task with status
   * 'working'; if 'input_required', return Task with inputRequests containing
   * all outstanding server-to-client requests; if 'completed', return Task
   * with result; if 'cancelled', return Task with status 'cancelled'; if
   * 'failed', return Task with error."
   */
  get(taskId: string, caller: string): DetailedTask | null {
    const internal = this._tasks.get(taskId);
    if (!internal) return null;
    // Indistinguishable from "unknown task" on purpose: telling a caller that a
    // task exists but is not theirs confirms the id, which is exactly what an
    // unguessable handle is meant to withhold.
    if (internal.owner !== caller) return null;
    return toDetailedTask(internal);
  }

  /**
   * Service a tasks/update request.
   *
   * Delivers client responses to outstanding requireInput() calls.
   *
   * Returns `true` on success, `false` if the taskId is unknown
   * (caller SHOULD return -32602 per spec §Task Update Requests).
   *
   * Spec §Task Update Requests:
   * - "Server SHOULD ignore inputResponses mapped to unknown, already-answered,
   *   or superseded keys."
   * - "Server MAY accept a partial set of responses."
   *
   * Silently ignores responses for unknown keys instead of erroring, because
   * a stale retry from an impatient client must not break an otherwise healthy
   * task.
   */
  update(
    taskId: string,
    inputResponses: Record<string, unknown>,
    caller: string,
  ): boolean {
    const internal = this._tasks.get(taskId);
    if (!internal || internal.owner !== caller) return false;

    for (const [key, rawValue] of Object.entries(inputResponses)) {
      const resolver = internal.pendingResolvers.get(key);
      if (!resolver) continue; // unknown / already-answered key — ignore

      internal.pendingResolvers.delete(key);
      internal.inputRequests.delete(key);
      internal.answeredKeys.add(key);
      internal.lastUpdatedAt = new Date().toISOString();

      // Normalise the response to Record — the spec treats the value as an
      // object; a primitive is boxed under "value" rather than dropping it.
      const response: Record<string, unknown> = isRecord(rawValue)
        ? rawValue
        : { value: rawValue };
      resolver(response);
    }

    // Move back to "working" when all pending resolvers are satisfied.
    // The run() promise may immediately re-enter "input_required" by calling
    // requireInput() again, but that transition happens inside run() before
    // this method returns — which is fine because we check pendingResolvers.size.
    if (
      internal.status === "input_required" &&
      internal.pendingResolvers.size === 0
    ) {
      internal.status = "working";
      internal.lastUpdatedAt = new Date().toISOString();
      this._notify(internal);
    }

    return true;
  }

  /**
   * Service a tasks/cancel request.
   *
   * Returns `true` if the task was found (regardless of whether the work
   * actually stops). Returns `false` if unknown (caller SHOULD return -32602).
   *
   * Spec §Task Cancellation: "Cancellation is cooperative: the server is not
   * obligated to actually stop the work; it only acknowledges intent. Eventual
   * transition to 'cancelled' is not guaranteed."
   *
   * `notifications/cancelled` MUST NOT be used for task cancellation — the spec
   * reserves a dedicated `notifications/tasks/statusChanged` notification for
   * Track G instead.
   */
  cancel(taskId: string, caller: string): boolean {
    const internal = this._tasks.get(taskId);
    if (!internal || internal.owner !== caller) return false;

    if (!isTerminal(internal.status)) {
      // Signal the AbortController so run() can observe ctrl.signal.aborted.
      // We do NOT await runPromise here — the acknowledgement is immediate.
      internal.abortController.abort();
    }
    return true;
  }

  /**
   * Signal all in-flight AbortControllers.
   *
   * Called by McpApp.stop() before awaiting httpServer.shutdown(), giving
   * background Promises a chance to observe the signal and exit early.
   * Does NOT await completion — best-effort on graceful shutdown.
   */
  drain(): void {
    for (const internal of this._tasks.values()) {
      if (!isTerminal(internal.status)) {
        internal.abortController.abort();
      }
    }
  }

  /**
   * Clear the cleanup interval.
   *
   * Must be called after drain() in McpApp.stop() to release the timer
   * and let the process exit cleanly.
   */
  /** True once dispose() ran; suppresses any late notification. */
  private _disposed = false;

  /** Whether this store has been torn down and must not accept new work. */
  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Emit a status change, unless the store was disposed.
   *
   * A drained task's `run()` promise can still settle after dispose() — abort is
   * cooperative, so work that ignores the signal keeps going. Pushing that
   * transition to a subscriber whose transport is already torn down is at best
   * useless and at worst a write to a closed stream.
   */
  private _notify(internal: InternalTask): void {
    if (this._disposed) return;
    this._options.onNotification?.(toDetailedTask(internal));
  }

  dispose(): void {
    this._disposed = true;
    if (this._cleanupTimer !== null) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  // ── Introspection (tests + diagnostics) ─────────────────────────────────────

  /** Current number of tracked tasks (terminal + non-terminal). */
  get size(): number {
    return this._tasks.size;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Sweep for TTL-expired tasks and mark them failed.
   *
   * Spec §Task Polling: "Server MAY mark a task as 'failed' at any point
   * after the TTL elapses, and subsequently delete it at any time. Returning
   * -32602 for an expired deleted task is compliant."
   *
   * We mark `failed` immediately on expiry and let maxTasks eviction handle
   * physical deletion — this avoids a second timestamp-based deletion pass.
   */
  private _sweep(): void {
    const now = Date.now();
    for (const internal of this._tasks.values()) {
      if (isTerminal(internal.status)) continue;
      if (internal.ttlMs === null) continue;

      const createdMs = new Date(internal.createdAt).getTime();
      if (now - createdMs <= internal.ttlMs) continue;

      // Abort to unblock any pending requireInput() calls.
      internal.abortController.abort();

      internal.status = "failed";
      internal.error = {
        code: -32603,
        message: `Task TTL of ${internal.ttlMs}ms elapsed without completing.`,
      };
      internal.lastUpdatedAt = new Date().toISOString();
      internal.terminalAt = now;
      this._notify(internal);
    }
  }

  /**
   * Enforce the maxTasks cap before inserting a new task.
   *
   * Eviction order (spec is silent; justified in TaskStoreOptions.maxTasks):
   * 1. Terminal tasks, oldest-terminalAt first (already served their purpose).
   * 2. Non-terminal tasks, oldest-createdAt first (least likely to be polled
   *    soon), with abort signal sent to allow cooperative cleanup.
   */
  private _maybeEvict(): void {
    if (this._tasks.size < this._options.maxTasks) return;

    // Phase 1: evict terminal tasks by age.
    const terminal = [...this._tasks.values()]
      .filter((t) => isTerminal(t.status))
      .sort((a, b) => (a.terminalAt ?? 0) - (b.terminalAt ?? 0));

    for (const t of terminal) {
      if (this._tasks.size < this._options.maxTasks) return;
      this._tasks.delete(t.taskId);
    }

    // Phase 2: evict oldest non-terminal tasks.
    if (this._tasks.size >= this._options.maxTasks) {
      const nonTerminal = [...this._tasks.values()]
        .filter((t) => !isTerminal(t.status))
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

      for (const t of nonTerminal) {
        if (this._tasks.size < this._options.maxTasks) return;
        // Give the task a chance to shut down gracefully.
        t.abortController.abort();
        this._tasks.delete(t.taskId);
      }
    }
  }
}
