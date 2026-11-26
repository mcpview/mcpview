import { getQuickJS, type QuickJSHandle } from "npm:quickjs-emscripten@0.32.0";

export const maxCodeLength = 16_384;
export const maxValueLength = 128 * 1024;
export const maxOperations = 16;

export function encodeValue(value: unknown, limit = maxValueLength): string {
  const text = JSON.stringify(value);
  if (text === undefined || text.length > limit) {
    throw new Error("Expected a JSON value within the size limit.");
  }
  return text;
}

/** QuickJS execution pattern shared with the ERPNext declared-views example. */
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
  const deadline = AbortSignal.timeout(30_000);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  signal.throwIfAborted();
  using vm = wasm.newContext();
  let cpuDeadline = performance.now() + 2000;
  vm.runtime.setInterruptHandler(() => signal.aborted || performance.now() >= cpuDeadline);
  vm.runtime.setMemoryLimit(12 * 1024 * 1024);
  vm.runtime.setMaxStackSize(192 * 1024);
  using stringify = vm.unwrapResult(vm.evalCode("JSON.stringify.bind(JSON)"));
  using parse = vm.unwrapResult(vm.evalCode("JSON.parse.bind(JSON)"));
  using deferreds = new DisposableStack();
  const pending: Array<() => Promise<void>> = [];
  let calls = 0;
  const read = (handle: QuickJSHandle) => {
    using encoded = vm.unwrapResult(vm.callFunction(stringify, vm.undefined, handle));
    if (vm.typeof(encoded) !== "string") throw new Error("Expected a JSON value.");
    const text = vm.getString(encoded);
    if (text.length > maxValueLength) throw new Error("JSON value exceeds the size limit.");
    return JSON.parse(text);
  };
  const decode = (value: unknown) => {
    using encoded = vm.newString(encodeValue(value));
    return vm.unwrapResult(vm.callFunction(parse, vm.undefined, encoded));
  };
  using dispatch = vm.newFunction("dispatch", (name, args) => {
    if (++calls > maxOperations || vm.typeof(name) !== "string") {
      throw new Error("Snippet operation limit exceeded.");
    }
    const operation = vm.getString(name);
    const arguments_ = read(args);
    const deferred = deferreds.use(vm.newPromise());
    pending.push(async () => {
      try {
        signal.throwIfAborted();
        const result = await invoke(operation, arguments_, signal);
        signal.throwIfAborted();
        using value = decode(result);
        deferred.resolve(value);
      } catch (error) {
        using message = vm.newString(error instanceof Error ? error.message : "Snippet failed.");
        deferred.reject(message);
      }
    });
    return deferred.handle.dup();
  });
  using globals = decode(params);
  vm.setProp(vm.global, "dispatch", dispatch);
  vm.setProp(vm.global, "params", globals);
  using promise = vm.unwrapResult(vm.evalCode(
    `(() => {
      const call = globalThis.dispatch, params = globalThis.params;
      delete globalThis.dispatch;
      delete globalThis.params;
      const api = Object.freeze({
        params,
        listSnippets: (...args) => call("listSnippets", args),
        runSnippet: (...args) => call("runSnippet", args),
        panel: (...args) => call("panel", args),
      });
      return (async function(api) { "use strict";\n${code}\n})(api);
    })()`,
    "multi-mcp-snippets.js",
    { type: "global" },
  ));
  for (;;) {
    signal.throwIfAborted();
    const state = vm.getPromiseState(promise);
    if (state.type === "fulfilled") {
      using value = state.value;
      if (pending.length) throw new Error("Await every snippet operation, including api.panel().");
      return vm.typeof(value) === "undefined" ? null : read(value);
    }
    if (state.type === "rejected") {
      using reason = state.error;
      throw new Error(vm.typeof(reason) === "string" ? vm.getString(reason) : "JavaScript failed.");
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
}
