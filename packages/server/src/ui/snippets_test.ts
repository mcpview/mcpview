import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  createFileSnippetStore,
  createSnippetCatalog,
  SnippetCatalogError,
} from "../../snippets.ts";

const source = '  await erp.call("list", params);\r\nreturn null;\n';
const alice = JSON.stringify(["tenant-1", "alice"]);
const bob = JSON.stringify(["tenant-1", "bob"]);
const otherTenant = JSON.stringify(["tenant-2", "alice"]);

Deno.test("explicit save preserves exact source and looks it up by scoped name", async () => {
  const catalog = createSnippetCatalog();
  const ref = catalog.recordSuccess(alice, source);
  assertNotEquals(ref, source);
  assertEquals(await catalog.list(alice), []);
  for (const scope of [bob, otherTenant]) {
    await assertRejects(
      () => catalog.save(scope, ref, "Invoice Lookup"),
      SnippetCatalogError,
      "Successful execution not found",
    );
  }

  const saved = await catalog.save(alice, ref, "Invoice Lookup");
  assertEquals(saved, { id: "Invoice Lookup", name: "Invoice Lookup" });
  assertEquals(await catalog.list(alice), [saved]);
  assertEquals(await catalog.inspect(alice, saved.id), {
    name: saved.name,
    code: source,
  });
  for (const scope of [bob, otherTenant]) {
    assertEquals(await catalog.list(scope), []);
    await assertRejects(
      () => catalog.inspect(scope, saved.id),
      SnippetCatalogError,
      "Snippet not found",
    );
    await assertRejects(
      () =>
        catalog.run(scope, saved.id, null, {
          validate: String,
          execute: () => "unreachable",
        }),
      SnippetCatalogError,
      "Snippet not found",
    );
  }
  assertEquals(
    await catalog.run(alice, saved.id, " EUR ", {
      validate(input) {
        if (typeof input !== "string") {
          throw new TypeError("Expected a currency");
        }
        return { currency: input.trim() };
      },
      execute: (code, params) => ({ code, params }),
    }),
    { code: source, params: { currency: "EUR" } },
  );
});

Deno.test("inspecting a stored snippet only reads it", async () => {
  const catalog = createSnippetCatalog({
    store: {
      putIfAbsent: () => {
        throw new Error("Inspection must not write");
      },
      list: () => {
        throw new Error("Inspection must use the scoped name");
      },
      get: (scope, name) => {
        assertEquals(scope, alice);
        assertEquals(name, "lookup");
        return Promise.resolve({ name, code: source });
      },
    },
  });
  assertEquals(await catalog.inspect(alice, "lookup"), {
    name: "lookup",
    code: source,
  });
});

Deno.test("a runner rejects invalid input before dispatch", async () => {
  const catalog = createSnippetCatalog();
  await catalog.save(alice, catalog.recordSuccess(alice, source), "lookup");
  let executions = 0;
  await assertRejects(
    () =>
      catalog.run(alice, "lookup", { limit: -1 }, {
        validate() {
          throw new RangeError("Limit must be positive");
        },
        execute() {
          executions++;
        },
      }),
    RangeError,
  );
  assertEquals(executions, 0);
});

Deno.test("old references leave the bounded set without changing saved snippets", async () => {
  const catalog = createSnippetCatalog({ maxPendingReferences: 1 });
  const first = catalog.recordSuccess(alice, source);
  await catalog.save(alice, first, "retained");
  const second = catalog.recordSuccess(alice, "return 2;");
  await assertRejects(
    () => catalog.save(alice, first, "evicted"),
    SnippetCatalogError,
    "Successful execution not found",
  );
  await catalog.save(alice, second, "second");
  assertEquals((await catalog.list(alice)).map(({ name }) => name), [
    "retained",
    "second",
  ]);
});

Deno.test("an expired execution reference cannot be saved", async () => {
  const catalog = createSnippetCatalog({ referenceTtlMs: 1 });
  const ref = catalog.recordSuccess(alice, source);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assertRejects(
    () => catalog.save(alice, ref, "expired"),
    SnippetCatalogError,
    "Successful execution not found",
  );
});

Deno.test("file store reopens snippets, accepts repeated saves and rejects overwrite", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const first = createSnippetCatalog({
      store: createFileSnippetStore(directory),
    });
    const reopened = createSnippetCatalog({
      store: createFileSnippetStore(directory),
    });
    const ref = first.recordSuccess(alice, source);
    const same = reopened.recordSuccess(alice, source);
    const name = "../C:\\Invoice Lookup";
    const initial = await Promise.all([
      first.save(alice, ref, name),
      reopened.save(alice, same, name),
    ]);
    assertEquals(initial, [{ id: name, name }, { id: name, name }]);

    const conflicting = reopened.recordSuccess(alice, source.trim());
    await assertRejects(
      () => reopened.save(alice, conflicting, name),
      SnippetCatalogError,
      "Snippet name already in use",
    );
    await reopened.save(bob, reopened.recordSuccess(bob, "return 2;"), name);
    assertEquals(await reopened.list(alice), [{ id: name, name }]);
    assertEquals(await reopened.list(otherTenant), []);
    for await (const scope of Deno.readDir(directory)) {
      const entries = [];
      for await (const entry of Deno.readDir(`${directory}/${scope.name}`)) {
        entries.push(entry.name);
      }
      assertEquals(entries.length, 1);
      assertEquals(entries[0].endsWith(".json"), true);
    }
    assertEquals(
      await reopened.run(alice, name, undefined, {
        validate: () => null,
        execute: (code) => code,
      }),
      source,
    );
    assertEquals(
      await first.run(bob, name, undefined, {
        validate: () => null,
        execute: (code) => code,
      }),
      "return 2;",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("snippet names are limited to 256 UTF-8 bytes", async () => {
  const catalog = createSnippetCatalog();
  const reference = catalog.recordSuccess(alice, source);
  const longestName = "é".repeat(128);
  const saved = await catalog.save(alice, reference, longestName);
  assertEquals(saved.name, longestName);
  assertEquals((await catalog.inspect(alice, longestName)).code, source);

  for (const name of ["a".repeat(257), `${longestName}a`]) {
    await assertRejects(
      () => catalog.save(alice, reference, name),
      TypeError,
      "Snippet names must be at most 256 UTF-8 bytes",
    );
  }
  assertEquals(await catalog.list(alice), [saved]);
});

Deno.test("parameter contracts persist without the original input values", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const catalog = createSnippetCatalog({
      store: createFileSnippetStore(directory),
    });
    const code = "return params;";
    const original = {
      minimum: 17,
      currency: "private-input",
      includeClosed: false,
      fallback: null,
      companies: ["private-company"],
      filter: { customer: "private-customer" },
    };
    const parameters = {
      minimum: "number",
      currency: "string",
      includeClosed: "boolean",
      fallback: "null",
      companies: "array",
      filter: "object",
    } as const;
    const named = { id: "totals", name: "totals", parameters };
    const ref = catalog.recordSuccess(alice, code, original);
    assertEquals(await catalog.save(alice, ref, "totals"), named);

    const equivalent = catalog.recordSuccess(alice, code, {
      filter: {},
      companies: [],
      fallback: null,
      includeClosed: true,
      currency: "EUR",
      minimum: 25,
    });
    assertEquals(await catalog.save(alice, equivalent, "totals"), named);
    const conflicting = catalog.recordSuccess(alice, code, { minimum: "17" });
    await assertRejects(
      () => catalog.save(alice, conflicting, "totals"),
      SnippetCatalogError,
      "Snippet name already in use",
    );
    await catalog.save(alice, catalog.recordSuccess(alice, code, {}), "empty");
    await catalog.save(
      alice,
      catalog.recordSuccess(alice, code),
      "unspecified",
    );

    const reopened = createSnippetCatalog({
      store: createFileSnippetStore(directory),
    });
    assertEquals(await reopened.list(alice), [
      { id: "empty", name: "empty", parameters: {} },
      named,
      { id: "unspecified", name: "unspecified" },
    ]);
    assertEquals(
      await reopened.run(alice, "totals", { minimum: 88 }, {
        validate(input, contract) {
          assertEquals(contract, parameters);
          return input;
        },
        execute: (code, input) => ({ code, input }),
      }),
      { code, input: { minimum: 88 } },
    );

    const persistedSnippets = [];
    for await (const scope of Deno.readDir(directory)) {
      for await (const file of Deno.readDir(`${directory}/${scope.name}`)) {
        const persisted = JSON.parse(
          await Deno.readTextFile(`${directory}/${scope.name}/${file.name}`),
        );
        persistedSnippets.push(persisted);
      }
    }
    assertEquals(
      persistedSnippets.find((snippet) => snippet.name === "totals"),
      { name: "totals", code, parameters },
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ineligible recordings report a typed error without evicting valid references", async () => {
  const catalog = createSnippetCatalog({ maxPendingReferences: 1 });
  const boundaryKey = "é".repeat(64);
  const accepted = Object.fromEntries([
    [boundaryKey, 1],
    ...Array.from({ length: 31 }, (_, index) => [`key${index}`, 2]),
  ]);
  const boundaryCode = "é".repeat(32 * 1024);
  const valid = catalog.recordSuccess(alice, boundaryCode, accepted);
  for (
    const attempt of [
      () => catalog.recordSuccess(alice, boundaryCode + "x"),
      () => catalog.recordSuccess(alice, source, { ...accepted, extra: true }),
      () => catalog.recordSuccess(alice, source, { [boundaryKey + "x"]: 1 }),
      () => catalog.recordSuccess(alice, source, { minimum: Infinity }),
      () => catalog.recordSuccess(alice, source, { minimum: NaN }),
    ]
  ) {
    const { code } = await assertRejects(async () => {
      await Promise.resolve();
      attempt();
    }, SnippetCatalogError);
    assertEquals(code, "EXECUTION_NOT_ELIGIBLE");
  }
  assertEquals(
    (await catalog.save(alice, valid, "boundary")).parameters?.[boundaryKey],
    "number",
  );
});

Deno.test("the first bounded description survives a repeated save and restart", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const catalog = createSnippetCatalog({
      store: createFileSnippetStore(directory),
    });
    const description = "é".repeat(256);
    const ref = catalog.recordSuccess(alice, source);
    await assertRejects(
      () => catalog.save(alice, ref, "lookup", description + "x"),
      TypeError,
    );
    const saved = { id: "lookup", name: "lookup", description };
    assertEquals(await catalog.save(alice, ref, "lookup", description), saved);
    assertEquals(
      await catalog.save(alice, ref, "lookup", "A different description"),
      saved,
    );
    const reopened = createSnippetCatalog({
      store: createFileSnippetStore(directory),
    });
    assertEquals(await reopened.list(alice), [saved]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
