const [css, shell, bundle] = await Promise.all([
  Bun.file(new URL("./style.css", import.meta.url)).text(),
  Bun.file(new URL("./index.html", import.meta.url)).text(),
  Bun.build({
    entrypoints: [new URL("./main.ts", import.meta.url).pathname],
    target: "browser",
    minify: true,
  }),
]);
if (!bundle.success) {
  throw new AggregateError(bundle.logs, "MCP App bundling failed");
}
const [entry] = bundle.outputs;
if (bundle.outputs.length !== 1 || !entry) {
  throw new Error("Expected one browser bundle");
}
const script = (await entry.text()).replace(/<\/script/gi, "<\\/script");
const html = shell.replace("<!-- styles -->", () => `<style>${css}</style>`)
  .replace("<!-- script -->", () => `<script type="module">${script}</script>`);
const output = new URL("./dist/index.html", import.meta.url);
await Bun.write(output, html);
console.log(output.pathname);
