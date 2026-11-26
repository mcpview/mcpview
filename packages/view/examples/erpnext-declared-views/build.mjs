// Build against an immutable upstream checkout with `npm ci` run in src/ui,
// and the matching unpacked npm release (its single-file HTML holds the CSS).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    source: { type: "string" },
    published: { type: "string" },
    output: { type: "string" },
  },
});
if (!args.source || !args.published || !args.output) {
  throw new Error(
    "Usage: node build.mjs --source ERP_CHECKOUT --published NPM_PACKAGE --output ASSETS",
  );
}
const ui = resolve(args.source, "src/ui");
const output = resolve(args.output);
const requireFromUi = createRequire(join(ui, "package.json"));
const ts = requireFromUi("typescript");
const { build } = requireFromUi("esbuild");
const source = JSON.parse(await readFile(resolve(args.source, "deno.json"), "utf8"));
const published = JSON.parse(await readFile(resolve(args.published, "package.json"), "utf8"));
if (source.name !== published.name || source.version !== published.version) {
  throw new Error("ERPNext sources and npm assets must refer to the same release.");
}

// ERPNext's server.ts registers these entries as ui://mcp-erpnext/<folder>.
const { UI_VIEWERS } = await import(pathToFileURL(join(ui, "viewers.ts")).href);
const namespace = published.name.split("/").at(-1);
const views = [];
const unsupported = [];
await mkdir(output, { recursive: true });
await copyFile(new URL("./adapter.js", import.meta.url), join(output, "adapter.js"));

for (const folder of UI_VIEWERS) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folder)) {
    throw new Error("Invalid declared resource folder");
  }
  const resourceUri = `ui://${namespace}/${folder}`;
  const viewer = join(ui, folder);
  const html = await readFile(join(viewer, "index.html"), "utf8");
  const entries = [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/g)];
  if (entries.length !== 1) throw new Error(`Expected one module entry for ${resourceUri}`);
  const entry = resolve(viewer, entries[0][1]);
  if (!entry.startsWith(viewer + sep)) throw new Error(`Entry escapes its folder: ${resourceUri}`);
  const code = await readFile(entry, "utf8");
  const direct = adaptEntry(entry, code);
  const boot = direct ?? adaptSessionEntry(entry, code);
  const delivery = direct ? "tool-result" : "viewer.session.apply";
  if (!boot) {
    unsupported.push({
      resourceUri,
      reason: "The declared entry has no supported Preact result or session bootstrap.",
    });
    continue;
  }

  const builtHtml = await readFile(
    resolve(args.published, "ui-dist", folder, "index.html"),
    "utf8",
  );
  const styles = [...builtHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) =>
    match[1]
  );
  if (!styles.length) throw new Error(`Missing upstream stylesheet for ${resourceUri}`);
  const bundle = await build({
    absWorkingDir: ui,
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "viewEntry",
    target: "es2022",
    minify: true,
    write: false,
    jsx: "automatic",
    jsxImportSource: "preact",
    alias: {
      "react-dom/client": "preact/compat/client",
      "react-dom": "preact/compat",
      react: "preact/compat",
    },
    loader: { ".svg": "dataurl", ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    tsconfig: join(ui, "tsconfig.json"),
    stdin: {
      contents: boot,
      loader: "tsx",
      resolveDir: dirname(entry),
      sourcefile: basename(entry),
    },
    plugins: direct
      ? [{
        name: "mounted-erpnext-app",
        setup(builder) {
          builder.onResolve(
            { filter: /^@modelcontextprotocol\/ext-apps$/ },
            () => ({ path: "scoped-app", namespace: "erpnext" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "erpnext" }, () => ({
            contents: "export class App { constructor() { return __mcpviewMount.app; } }",
          }));
        },
      }]
      : [],
  });
  const module = "./" + folder + ".js";
  // Instantiate the whole upstream module (including its `new App()`) per
  // mount. Concurrent roots cannot overwrite each other's hooks or results.
  const contents = direct
    ? [
      'import { mountPreactResource } from "./adapter.js";',
      "export function mount(root, host, result, signal) {",
      `  return mountPreactResource(root, host, result, signal, ${
        JSON.stringify(styles.join("\n"))
      }, (__mcpviewMount) => {`,
      bundle.outputFiles[0].text,
      "    return viewEntry.unmount;",
      "  });",
      "}",
      "",
    ]
    : [
      'import { mountDeclaredSessionApp } from "./shell.js";',
      'import { scopedStyles } from "./adapter.js";',
      "export async function mountSession(root, host, session, signal) {",
      "  const __mcpviewMount = {root};",
      `  const removeStyle = scopedStyles(root, ${JSON.stringify(styles.join("\n"))}, signal);`,
      "  try {",
      bundle.outputFiles[0].text,
      "    const view = await mountDeclaredSessionApp(host, session, signal, viewEntry.start);",
      "    return { applySession: view.applySession, dispose() { try { view.dispose(); } finally { removeStyle(); } } };",
      "  } catch (error) { removeStyle(); throw error; }",
      "}",
      "",
    ];
  await writeFile(resolve(output, module), contents.join("\n"));
  views.push({ resourceUri, module, delivery });
}

if (!views.length) throw new Error("No compatible ERPNext resources found.");
await copyFile(resolve(args.published, "LICENSE"), join(output, "ERPNext-LICENSE"));
await copyFile(
  resolve(args.published, "THIRD_PARTY_NOTICES.txt"),
  join(output, "ERPNext-THIRD-PARTY-NOTICES.txt"),
);
const entries = views.map(({ resourceUri, module }) =>
  `  [${JSON.stringify(resourceUri)}, () => import(${JSON.stringify(module)})],`
);
await writeFile(
  join(output, "loaders.js"),
  ["export const loaders = new Map([", ...entries, "]);", ""].join("\n"),
);
await writeFile(
  join(output, "manifest.json"),
  JSON.stringify({ views, unsupported }, null, 2) + "\n",
);
console.log(
  `${published.name}@${published.version}: ${views.length} mounted views, ${unsupported.length} native-only resources`,
);

// Preserve the original entry, imports, JSX and theme setup. Substitute only
// the standalone document-root argument to Preact's top-level render call.
function adaptEntry(file, code) {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (ast.parseDiagnostics.length) throw new Error(`Invalid TSX in ${file}`);
  const preact = ast.statements.find((node) =>
    ts.isImportDeclaration(node) && node.moduleSpecifier.text === "preact"
  );
  const binding = preact?.importClause?.namedBindings?.elements?.find((item) =>
    (item.propertyName ?? item.name).text === "render"
  );
  if (!binding) return undefined;
  const renderer = binding.name.text;
  const calls = ast.statements.filter(ts.isExpressionStatement).map((node) => node.expression)
    .filter((call) =>
      ts.isCallExpression(call) && ts.isIdentifier(call.expression) &&
      call.expression.text === renderer
    );
  if (calls.length !== 1 || calls[0].arguments.length !== 2) return undefined;
  const [jsx, target] = calls[0].arguments;
  if (!ts.isJsxSelfClosingElement(jsx) && !ts.isJsxElement(jsx)) return undefined;
  const tag = ts.isJsxElement(jsx) ? jsx.openingElement.tagName : jsx.tagName;
  const componentImport = ast.statements.find((node) =>
    ts.isImportDeclaration(node) && node.moduleSpecifier.text.startsWith(".") &&
    node.importClause?.namedBindings?.elements?.some((item) => item.name.text === tag.getText(ast))
  );
  if (!componentImport) return undefined;
  const component = ts.resolveModuleName(componentImport.moduleSpecifier.text, file, {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
  }, ts.sys).resolvedModule;
  if (!component || !acceptsDirectResults(component.resolvedFileName)) return undefined;
  const element = ts.isNonNullExpression(target) ? target.expression : target;
  if (
    !ts.isCallExpression(element) ||
    element.expression.getText(ast) !== "document.getElementById" ||
    element.arguments.length !== 1 || !ts.isStringLiteral(element.arguments[0])
  ) return undefined;
  return code.slice(0, target.getStart(ast)) + "__mcpviewMount.root" + code.slice(target.end) +
    `\nexport function unmount() { ${renderer}(null, __mcpviewMount.root); }\n`;
}

// ERPNext's conventional root components each construct one SDK App and
// subscribe to complete results before connecting it. A different bootstrap
// needs a publisher-owned mount adapter, even when it renders Preact.
function acceptsDirectResults(file) {
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const sdk = ast.statements.find((node) =>
    ts.isImportDeclaration(node) && node.moduleSpecifier.text === "@modelcontextprotocol/ext-apps"
  );
  const appClass = sdk?.importClause?.namedBindings?.elements?.find((item) =>
    (item.propertyName ?? item.name).text === "App"
  )?.name.text;
  if (!appClass) return false;
  const apps = ast.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations]).filter((declaration) =>
      declaration.initializer && ts.isNewExpression(declaration.initializer) &&
      declaration.initializer.expression.getText(ast) === appClass &&
      ts.isIdentifier(declaration.name)
    );
  if (apps.length !== 1) return false;
  const name = apps[0].name.text;
  let subscribed = false;
  let connectsAfterSubscription = false;
  function visit(node) {
    if (
      ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(ast) === name + ".ontoolresult"
    ) subscribed = true;
    if (ts.isCallExpression(node) && node.expression.getText(ast) === name + ".connect") {
      connectsAfterSubscription ||= subscribed;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return connectsAfterSubscription;
}

// Surface Apps publish a bootstrap that accepts a SurfaceAppRuntime. Preserve the
// publisher's startup, validator and component registry; supply the shell runtime.
function adaptSessionEntry(file, code) {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations]);
  const root = declarations.find(({ name, initializer }) =>
    ts.isIdentifier(name) && initializer && ts.isCallExpression(initializer) &&
    initializer.expression.getText(ast) === "document.getElementById"
  );
  if (!root) return undefined;
  for (const statement of ast.statements.filter(ts.isExpressionStatement)) {
    const outer = statement.expression;
    if (!ts.isVoidExpression(outer) || !ts.isCallExpression(outer.expression)) continue;
    const chain = outer.expression.expression;
    if (!ts.isPropertyAccessExpression(chain) || chain.name.text !== "catch") continue;
    const start = chain.expression;
    if (
      !ts.isCallExpression(start) || !ts.isIdentifier(start.expression) ||
      start.arguments.length !== 2 || start.arguments[0].getText(ast) !== root.name.text
    ) continue;
    const dependency = ast.statements.find((node) =>
      ts.isImportDeclaration(node) && node.moduleSpecifier.text.startsWith(".") &&
      node.importClause?.namedBindings?.elements?.some((item) =>
        item.name.text === start.expression.text
      )
    );
    if (!dependency) continue;
    const owner = ts.resolveModuleName(dependency.moduleSpecifier.text, file, {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    }, ts.sys).resolvedModule;
    if (!owner) continue;
    const impl = ts.createSourceFile(
      owner.resolvedFileName,
      readFileSync(owner.resolvedFileName, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const kit = impl.statements.find((node) =>
      ts.isImportDeclaration(node) &&
      ["@mcpview/components", "@mcpview/components/preact"].includes(node.moduleSpecifier.text) &&
      node.importClause?.namedBindings?.elements?.some((binding) =>
        (binding.propertyName ?? binding.name).text === "SurfaceAppRuntime"
      )
    );
    const runtimeType = kit?.importClause.namedBindings.elements.find((binding) =>
      (binding.propertyName ?? binding.name).text === "SurfaceAppRuntime"
    )?.name.text;
    const fn = impl.statements.find((node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === start.expression.text
    );
    if (
      !runtimeType || !fn || fn.parameters.length !== 3 ||
      fn.parameters[2].type?.getText(impl) !== runtimeType
    ) continue;

    return code.slice(0, root.initializer.getStart(ast)) + "__mcpviewMount.root" +
      code.slice(root.initializer.end, statement.getStart(ast)) +
      `export function start(runtime) { return ${start.expression.text}(${
        start.arguments.map((a) => a.getText(ast)).join(", ")
      }, runtime); }` +
      code.slice(statement.end);
  }
}
