import { getQuickJS, type QuickJSHandle } from "npm:quickjs-emscripten@0.32.0";

/** Only the host retains the native receipt. The guest receives its detached JSON data. */
export async function runReadProgram<T extends { data: unknown }>(
  code: string,
  call: (name: string, args: Record<string, unknown>) => Promise<T>,
): Promise<{ native: T } | { value: unknown }> {
  if (typeof code !== "string" || !code.trim() || code.length > 16_384) {
    throw new Error("Supply a JavaScript function body of at most 16 KiB.");
  }
  const quickJS = await getQuickJS();
  using vm = quickJS.newContext();
  const deadline = performance.now() + 4000;
  vm.runtime.setInterruptHandler(() => performance.now() >= deadline);
  vm.runtime.setMemoryLimit(12 * 1024 * 1024);
  vm.runtime.setMaxStackSize(192 * 1024);
  const captured = new Map<QuickJSHandle, T>();
  const pending: Array<() => Promise<void>> = [];
  const disposables = new DisposableStack();
  try {
    using stringify = vm.unwrapResult(vm.evalCode("JSON.stringify.bind(JSON)"));
    // Capture the intrinsics before evaluating the guest. The guest cannot replace the decoder.
    using decode = vm.unwrapResult(vm.evalCode(`(() => {
      const parse = JSON.parse, values = Object.values, freeze = Object.freeze;
      function freezeTree(value) {
        if (value && typeof value === 'object') {
          const children = values(value);
          for (let i = 0; i < children.length; i++) freezeTree(children[i]);
          freeze(value);
        }
        return value;
      }
      return text => freezeTree(parse(text));
    })()`));
    const json = (handle: QuickJSHandle) => {
      using encoded = vm.unwrapResult(vm.callFunction(stringify, vm.undefined, handle));
      if (vm.typeof(encoded) !== "string") throw new Error("Expected a JSON value.");
      const text = vm.getString(encoded);
      if (text.length > 128 * 1024) throw new Error("JSON value exceeds the size limit.");
      return JSON.parse(text);
    };
    let calls = 0;
    using callFunction = vm.newFunction("call", (nameHandle, argsHandle) => {
      if (++calls > 12 || vm.typeof(nameHandle) !== "string" || !argsHandle) {
        throw new Error("Expected an available read operation with an argument object.");
      }
      const name = vm.getString(nameHandle);
      const args = json(argsHandle);
      if (!args || Array.isArray(args) || typeof args !== "object") {
        throw new Error("Expected an argument object.");
      }
      const deferred = disposables.use(vm.newPromise());
      // Queue the request outside the VM. At most twelve reads may be outstanding.
      const result = call(name, args).then(
        (native) => ({ native }),
        (error: unknown) => ({ error }),
      );
      pending.push(async () => {
        const response = await result;
        if ("error" in response) {
          using rejected = vm.newString(String(response.error));
          deferred.reject(rejected);
        } else {
          const text = JSON.stringify(response.native.data);
          if (text === undefined || text.length > 128 * 1024) {
            throw new Error("ERP response exceeds the size limit.");
          }
          using wire = vm.newString(text);
          const data = disposables.use(
            vm.unwrapResult(vm.callFunction(decode, vm.undefined, wire)),
          );
          if (vm.typeof(data) === "object" && !vm.eq(data, vm.null)) {
            captured.set(data, response.native);
          }
          deferred.resolve(data);
        }
      });
      return deferred.handle.dup();
    });
    using erp = vm.newObject();
    vm.setProp(erp, "call", callFunction);
    vm.setProp(vm.global, "erp", erp);
    using promise = vm.unwrapResult(
      vm.evalCode(`(async () => { "use strict";\n${code}\n})()`, "invoice-query.js", {
        type: "global",
      }),
    );
    for (;;) {
      if (performance.now() >= deadline) throw new Error("JavaScript execution timed out.");
      const state = vm.getPromiseState(promise);
      if (state.type === "fulfilled") {
        using returned = state.value;
        for (const [handle, native] of captured) if (vm.eq(handle, returned)) return { native };
        return { value: json(returned) };
      }
      if (state.type === "rejected") {
        using reason = state.error;
        const detail = vm.dump(reason);
        throw new Error(
          typeof detail === "string" ? detail : String(detail?.message ?? "JavaScript failed."),
        );
      }
      if (vm.runtime.hasPendingJob()) vm.unwrapResult(vm.runtime.executePendingJobs(1));
      else if (pending.length) await pending.shift()!();
      else throw new Error("JavaScript is waiting on an unresolved promise.");
    }
  } finally {
    disposables.dispose();
  }
}
