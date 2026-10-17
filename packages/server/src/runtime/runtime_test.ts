import { assertEquals } from "@std/assert";
import {
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "./runtime.ts";

Deno.test("runtime fs port - writeTextFile and readTextFile round-trip", async () => {
  const dir = await Deno.makeTempDir({ prefix: "runtime-port-" });
  const path = `${dir}/tokens.json`;

  await writeTextFile(path, "hello", { mode: 0o600 });

  assertEquals(await readTextFile(path), "hello");
});

Deno.test("runtime fs port - mkdir creates nested directories", async () => {
  const dir = await Deno.makeTempDir({ prefix: "runtime-port-" });
  const nested = `${dir}/a/b`;

  await mkdir(nested, { recursive: true, mode: 0o700 });
  await writeTextFile(`${nested}/file.txt`, "ok");

  assertEquals(await readTextFile(`${nested}/file.txt`), "ok");
});

Deno.test("runtime fs port - remove is a no-op when file is absent", async () => {
  const dir = await Deno.makeTempDir({ prefix: "runtime-port-" });

  await remove(`${dir}/missing.json`);
  await remove(`${dir}/missing.json`);
});

Deno.test("runtime fs port - readDir returns entry names and [] for absent directories", async () => {
  const dir = await Deno.makeTempDir({ prefix: "runtime-port-" });
  await writeTextFile(`${dir}/a.json`, "a");
  await writeTextFile(`${dir}/b.json`, "b");

  assertEquals((await readDir(dir)).sort(), ["a.json", "b.json"]);
  assertEquals(await readDir(`${dir}/missing`), []);
});
