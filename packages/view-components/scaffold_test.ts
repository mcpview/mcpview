import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

import { parseScaffoldArguments, ScaffoldError, scaffoldResultViewer } from "./scaffold.ts";

Deno.test("result-viewer scaffold creates a standalone component project", async () => {
  const directory = await Deno.makeTempDir({ prefix: "mcp-view-scaffold-" });
  try {
    const target = join(directory, "result-viewer");
    const files = await scaffoldResultViewer(target);

    assertEquals(files.length, 8);
    for (
      const path of [
        "deno.json",
        "index.html",
        "build.ts",
        "src/main.ts",
        "src/model.ts",
        "src/render.ts",
        "src/styles.css",
        "src/model_test.ts",
      ]
    ) {
      assert((await Deno.stat(join(target, path))).isFile);
    }
    const main = await Deno.readTextFile(join(target, "src/main.ts"));
    assertStringIncludes(main, "startSurfaceApp");
    assertStringIncludes(main, "defineComponentRegistry");
    assertStringIncludes(main, '"result.metrics"');
    assertStringIncludes(main, "fromToolResult");
    assertStringIncludes(main, "before connect()");
    assertStringIncludes(main, "strict: true");
    assertStringIncludes(main, "documentLanguage: messages.locale");
    assertStringIncludes(main, "createTranslator");
    assertStringIncludes(main, 'from "@mcpview/components/surface"');
    assert(!main.includes("createMcpApp"), "the scaffold must not hand-roll the App lifecycle");
    const styles = await Deno.readTextFile(join(target, "src/styles.css"));
    assertStringIncludes(styles, "var(--color-background-primary");
    assertStringIncludes(styles, "prefers-reduced-motion");

    const configPath = join(target, "deno.json");
    const generatedConfig = await Deno.readTextFile(configPath);
    assertStringIncludes(generatedConfig, '"@mcpview/view": "jsr:@mcpview/view@0.10.1"');
    assertStringIncludes(
      generatedConfig,
      '"@mcpview/components": "jsr:@mcpview/components@0.11.0"',
    );
    assertStringIncludes(generatedConfig, '"minimumDependencyAge"');
    assertStringIncludes(generatedConfig, '"jsr:@mcpview/components"');
    const coreModule = new URL("../view/mod.ts", import.meta.url).href;
    const componentsModule = new URL("./mod.ts", import.meta.url).href;
    const surfaceModule = new URL("./surface.ts", import.meta.url).href;
    // A local checkout cannot expand subpaths the way a jsr: package does.
    await Deno.writeTextFile(
      configPath,
      generatedConfig
        .replace("jsr:@mcpview/view@0.10.1", coreModule)
        .replace("jsr:@mcpview/components@0.11.0/surface", surfaceModule)
        .replace("jsr:@mcpview/components@0.11.0", componentsModule),
    );

    // A bare path is accepted where the fleet passes file URLs; /surface is derived from it.
    const environment = {
      MCP_VIEW_MODULE: coreModule,
      MCP_VIEW_COMPONENTS_MODULE: fromFileUrl(componentsModule),
    };
    // The emitted sources are fmt-clean before the test appends its probe.
    await runGeneratedTask(target, "fmt", environment);

    await Deno.writeTextFile(
      join(target, "src", "main.ts"),
      '\n(globalThis as Record<string, unknown>).__mcpViewBundleReplacementProbe = "$& $` $\' $$";\n',
      { append: true },
    );

    await runGeneratedTask(target, "test", environment);
    await runGeneratedTask(target, "check", environment);
    await runGeneratedTask(target, "build", environment);
    const generatedHtml = await Deno.readTextFile(
      join(target, "dist", "result-viewer", "index.html"),
    );
    assertStringIncludes(generatedHtml, "__mcpViewBundleReplacementProbe");
    assertInlineScriptsParse(generatedHtml);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("result-viewer scaffold refuses a non-empty directory unless force is explicit", async () => {
  const directory = await Deno.makeTempDir({ prefix: "mcp-view-scaffold-" });
  try {
    await Deno.writeTextFile(join(directory, "keep.txt"), "keep");
    await assertRejects(
      () => scaffoldResultViewer(directory),
      ScaffoldError,
      "not empty",
    );
    await scaffoldResultViewer(directory, { force: true });
    assertEquals(await Deno.readTextFile(join(directory, "keep.txt")), "keep");
    assert((await Deno.stat(join(directory, "src", "main.ts"))).isFile);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("result-viewer scaffold exposes actionable CLI parsing errors", () => {
  assertEquals(parseScaffoldArguments(["result-viewer", "./viewer", "--force"]), {
    target: "./viewer",
    options: { force: true },
  });
  try {
    parseScaffoldArguments(["unknown", "./viewer"]);
    throw new Error("expected scaffold parsing to reject");
  } catch (error) {
    assert(error instanceof ScaffoldError);
    assertStringIncludes(error.message, "Usage:");
  }
});

Deno.test("result-viewer scaffold refuses protected targets even with force", async () => {
  const targets = ["/", Deno.cwd(), dirname(Deno.cwd()), Deno.env.get("HOME")]
    .filter((target): target is string => target !== undefined);
  for (const target of targets) {
    await assertRejects(
      () => scaffoldResultViewer(target, { force: true }),
      ScaffoldError,
      "Refusing to scaffold",
    );
  }
});

async function runGeneratedTask(
  cwd: string,
  task: string,
  environment: Record<string, string>,
): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    cwd,
    args: ["task", task],
    env: environment,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (result.success) return;
  throw new Error(
    `Generated result-viewer task ${task} failed:\n${new TextDecoder().decode(result.stderr)}`,
  );
}

function assertInlineScriptsParse(html: string): void {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) =>
    match[1]
  );
  assert(scripts.length > 0, "expected generated viewer HTML to include an inline script");
  for (const script of scripts) {
    new Function(script);
  }
}

Deno.test("the scaffold pins the @mcpview/view release it was built against", async () => {
  // The generated project and its build step both name the core package; a
  // core bump that skips the scaffold ships a viewer on the previous runtime.
  const version = JSON.parse(
    await Deno.readTextFile(new URL("../view/deno.json", import.meta.url)),
  ).version as string;
  const source = await Deno.readTextFile(
    new URL("./src/scaffold/result-viewer-templates.ts", import.meta.url),
  );
  const pins = [...source.matchAll(/@mcpview\/view@([0-9][A-Za-z0-9.-]*)/g)]
    .map((match) => match[1]);
  assert(pins.length > 0, "the scaffold pins no version of @mcpview/view");
  for (const pin of pins) {
    assertEquals(
      pin,
      version,
      `the scaffold emits mcp-view ${pin} while the core ships ${version}`,
    );
  }
});

Deno.test("the scaffold emits the version of the package that ships it", async () => {
  // The README said 0.5.0 while the generator still wrote 0.3.1, so
  // `jsr:…@0.5.0/scaffold` produced a project pinned to a release without the
  // components it had just advertised. Nothing caught it: the version lived in
  // three files and none of them was tied to deno.json.
  const version = JSON.parse(
    await Deno.readTextFile(new URL("./deno.json", import.meta.url)),
  ).version as string;

  for (const path of ["scaffold.ts", "src/scaffold/result-viewer-templates.ts"]) {
    const source = await Deno.readTextFile(new URL(`./${path}`, import.meta.url));
    const pins = [...source.matchAll(/@mcpview\/components@([0-9][A-Za-z0-9.-]*)/g)]
      .map((match) => match[1]);
    assert(pins.length > 0, `${path} pins no version of its own package`);
    for (const pin of pins) {
      assertEquals(pin, version, `${path} emits ${pin} while the package ships ${version}`);
    }
  }
});
