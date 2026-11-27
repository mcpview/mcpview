import { getQuickJS, type QuickJSHandle, Scope } from "quickjs-emscripten";

/** Maximum source length accepted by the code-mode execute tool. */
export const maxCodeLength = 16_384;
const maxValueLength = 128 * 1024;
const maxOperations = 16;

/** Serialize data crossing the QuickJS boundary within the supplied limit. */
export function encodeValue(value: unknown, limit = maxValueLength): string {
  const text = JSON.stringify(value);
  if (text === undefined || text.length > limit) {
    throw new Error("Expected a JSON value within the size limit.");
  }
  return text;
}

/** Wait for host I/O without allowing a provider that ignores cancellation to hold the VM open. */
function waitForOperation(
  invoke: () => Promise<unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return invoke();
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * Run a function body in an isolated QuickJS context. Only JSON and explicit snippet
 * operations cross into the host. Execute host requests when the guest yields.
 */
export async function runProgram(
  code: string,
  params: Record<string, unknown>,
  invoke: (operation: string, args: unknown[], signal: AbortSignal) => Promise<unknown>,
  callerSignal?: AbortSignal,
): Promise<unknown> {
  if (typeof code !== "string" || !code.trim() || code.length > maxCodeLength) {
    throw new Error("Supply a JavaScript function body of at most 16 KiB.");
  }
  callerSignal?.throwIfAborted();
  const wasm = await getQuickJS();
  callerSignal?.throwIfAborted();
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("JavaScript exceeded its time limit.")),
    30_000,
  );
  try {
    return await Scope.withScopeAsync(async (scope) => {
      const vm = scope.manage(wasm.newContext());
      let cpuDeadline = performance.now() + 2000;
      vm.runtime.setMemoryLimit(12 * 1024 * 1024);
      vm.runtime.setMaxStackSize(192 * 1024);
      vm.runtime.setInterruptHandler(() => signal.aborted || performance.now() >= cpuDeadline);
      const stringify = scope.manage(vm.unwrapResult(vm.evalCode("JSON.stringify.bind(JSON)")));
      const parse = scope.manage(vm.unwrapResult(vm.evalCode("JSON.parse.bind(JSON)")));
      const pending: Array<() => Promise<void>> = [];
      let calls = 0;

      function read(handle: QuickJSHandle): unknown {
        const encoded = vm.unwrapResult(vm.callFunction(stringify, vm.undefined, handle));
        try {
          if (vm.typeof(encoded) !== "string") throw new Error("Expected a JSON value.");
          const text = vm.getString(encoded);
          if (text.length > maxValueLength) throw new Error("JSON value exceeds the size limit.");
          return JSON.parse(text);
        } finally {
          encoded.dispose();
        }
      }
      function decode(value: unknown): QuickJSHandle {
        const encoded = vm.newString(encodeValue(value));
        try {
          return scope.manage(vm.unwrapResult(vm.callFunction(parse, vm.undefined, encoded)));
        } finally {
          encoded.dispose();
        }
      }

      const dispatch = scope.manage(vm.newFunction("dispatch", (name, args) => {
        if (++calls > maxOperations || vm.typeof(name) !== "string") {
          throw new Error("Snippet operation limit exceeded.");
        }
        const operation = vm.getString(name);
        const arguments_ = read(args);
        if (!Array.isArray(arguments_)) throw new Error("Expected snippet arguments.");
        const deferred = scope.manage(vm.newPromise());
        pending.push(async () => {
          try {
            const result = await waitForOperation(
              () => invoke(operation, arguments_, signal),
              signal,
            );
            signal.throwIfAborted();
            deferred.resolve(decode(result));
          } catch (error) {
            const message = scope.manage(
              vm.newString(error instanceof Error ? error.message : "Snippet failed."),
            );
            deferred.reject(message);
          }
        });
        return deferred.handle.dup();
      }));
      vm.setProp(vm.global, "dispatch", dispatch);
      vm.setProp(vm.global, "params", decode(params));
      const promise = scope.manage(vm.unwrapResult(vm.evalCode(
        `(() => {
        const call = globalThis.dispatch, params = globalThis.params;
        delete globalThis.dispatch;
        delete globalThis.params;
        const api = Object.freeze({
          params,
          listSnippets: (...args) => call("listSnippets", args),
          runSnippet: (...args) => call("runSnippet", args),
          panel: (...args) => call("panel", args),
          sync: (...args) => call("sync", args),
        });
        return (async function(api) { "use strict";\n${code}\n})(api);
      })()`,
        "mcpview-code-mode.js",
        { type: "global" },
      )));
      for (;;) {
        signal.throwIfAborted();
        if (performance.now() >= cpuDeadline) {
          throw new Error("JavaScript exceeded its time limit.");
        }
        const state = vm.getPromiseState(promise);
        if (state.type === "fulfilled") {
          const value = scope.manage(state.value);
          if (pending.length) {
            throw new Error("Await every snippet operation, including api.panel() and api.sync().");
          }
          return vm.typeof(value) === "undefined" ? null : read(value);
        }
        if (state.type === "rejected") {
          const reason = scope.manage(state.error);
          throw new Error(
            vm.typeof(reason) === "string" ? vm.getString(reason) : "JavaScript failed.",
          );
        }
        if (vm.runtime.hasPendingJob()) {
          vm.unwrapResult(vm.runtime.executePendingJobs(1));
        } else if (pending.length) {
          const before = performance.now();
          await pending.shift()!();
          cpuDeadline += performance.now() - before;
        } else {
          throw new Error("JavaScript is waiting on an unresolved promise.");
        }
      }
    });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abort);
  }
}
