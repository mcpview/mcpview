# ERPNext declared views through one code tool

An MCP Apps host opens a single workspace for `execute`. JavaScript running on the server can read
ERPNext, compare invoices and return the native response it wants to show. Returning a list opens
ERPNext’s published list component. Returning a specific invoice opens its invoice component.
Returning a calculated number displays the number. The program needs the business operations and
their data shapes. The publisher provides the UI.

## Build the publisher modules

Run from the root of this mcpview checkout. The build needs Git, npm, Node 22.18+ on the 22.x line
or Node 24+, and Deno with `deno bundle` (tested with 2.9.2). Node imports ERPNext’s TypeScript
viewer declarations directly. [Node TypeScript support](https://nodejs.org/api/typescript.html)

In terminal A, build in a temporary directory and leave the shell open for the server step.

```sh
EX=packages/view/examples/erpnext-declared-views
BUILD_DIR=$(mktemp -d)
ASSETS="$BUILD_DIR/assets"
ERP_SOURCE="$BUILD_DIR/source"
git clone --quiet --depth=1 --branch v3.5.0 https://github.com/Casys-AI/mcp-erpnext.git "$ERP_SOURCE"
test "$(git -C "$ERP_SOURCE" rev-parse HEAD)" = 8de156fbb09adec1fb891b5cfd872d9b6c9dfbe4
(cd "$ERP_SOURCE/src/ui" && npm ci --workspaces=false --no-audit --no-fund)
npm pack @casys/mcp-erpnext@3.5.0 --pack-destination "$BUILD_DIR" --silent
tar -xzf "$BUILD_DIR/casys-mcp-erpnext-3.5.0.tgz" -C "$BUILD_DIR"
node "$EX/build.mjs" --source "$ERP_SOURCE" --published "$BUILD_DIR/package" --output "$ASSETS"
deno bundle --no-lock --platform=browser --minify "$EX/shell.ts" -o "$ASSETS/shell.js"
cat "$ASSETS/manifest.json"
```

The manifest lists eight mountable modules and one standalone resource for ERPNext 3.5.0. The
generated directory includes the original release's styles embedded in the modules, its license and
third-party notices. With a local Git clone containing the tag, `git archive v3.5.0` unpacked into
`$ERP_SOURCE` provides the same source files.
[ERPNext v3.5.0](https://github.com/Casys-AI/mcp-erpnext/tree/8de156fbb09adec1fb891b5cfd872d9b6c9dfbe4)

## Run the synthetic workspace

Start these processes from the mcpview root, each in its own terminal. Terminal B serves a small
Frappe-compatible HTTP fixture with two overdue invoices (€120 and €180), one settled invoice and
one invoice due in the future.

```sh
deno run --no-lock --allow-net=127.0.0.1 packages/view/examples/erpnext-declared-views/fixture.ts 45790
```

Terminal C runs the published ERPNext MCP server against that fixture. The sample values below are
the fixture’s credentials.

```sh
ERPNEXT_URL=http://127.0.0.1:45790 ERPNEXT_API_KEY=fixture ERPNEXT_API_SECRET=fixture \
  npx --yes @casys/mcp-erpnext@3.5.0 --http --hostname=127.0.0.1 --port=45791
```

Return to terminal A once the ERPNext server is listening. The workspace reads the upstream tool
descriptors at startup and serves `http://127.0.0.1:45289/mcp`.

```sh
ERP_MCP_URL=http://127.0.0.1:45791/mcp VIEW_ASSETS_DIR="$ASSETS" \
  deno run --no-lock --allow-read --allow-net=127.0.0.1 --allow-env "$EX/serve.ts"
```

In another terminal, exercise the complete JSON-RPC path.

```sh
ERP_MCP_URL=http://127.0.0.1:45791/mcp \
  deno run --no-lock --allow-env --allow-net=127.0.0.1 packages/view/examples/erpnext-declared-views/smoke.ts
```

The smoke checks list, invoice and KPI selection, returning an earlier result after another read, a
computed total of 300, copied objects, fabricated routing metadata and denied operations. It also
checks that the guest has no `fetch`, `Deno` or `process` binding. Press Ctrl+C in the three serving
terminals when finished.

For a remote MCP Apps host, point the connector at an HTTPS origin forwarding to the façade's `/mcp`
and set `PUBLIC_ORIGIN` to that origin before starting the façade. The browser must be able to fetch
the shell and modules from the same HTTPS origin. The ERPNext and Frappe services remain on
loopback. Override `PORT` to change the façade listener, and pass the resulting local endpoint as
the first argument to `smoke.ts`. The endpoints implement the stateless HTTP profile used by this
checkout, revision `2026-07-28`.

## Try a question

The optional [receivables skill](skills/erpnext-creances-clients/SKILL.md) teaches the business
operations available through `erp.call(name, args)`. It can be supplied separately in hosts that
support skills. The server supplies the routes even when the skill is absent.

Ask for the largest overdue invoice. A program may return the selected invoice in a single `execute`
call.

```js
const invoices = await erp.call("erpnext_doc_list", {
  doctype: "Sales Invoice",
  fields: ["name", "outstanding_amount"],
  filters: [["status", "=", "Overdue"]],
});
if (!invoices.data.length) return "No overdue invoices";
const largest = invoices.data.reduce((a, b) => a.outstanding_amount > b.outstanding_amount ? a : b);
return await erp.call("erpnext_sales_invoice_get", { name: largest.name });
```

The example fixture selects `SYN-INV-002` for €180. Returning `invoices` itself opens the list,
while returning the sum of its balances gives an ordinary JSON value. The fixture fits in a single
page. The skill outlines pagination for larger sets.

In a fresh ChatGPT Work conversation, the request to open the largest overdue invoice produced
one `execute` with two upstream reads. The generated code read the invoice list, compared the
balances, and fetched the selected invoice by name. The server selected the invoice module and
ChatGPT displayed `SYN-INV-002` with €180 outstanding. Separate requests displayed the list and
the overdue KPI. Selecting a list row updated its active context, and clicking the KPI opened the
two invoices behind its €300 total. Each request used the same outer tool and workspace resource.

## How a native response reaches a view

1. On startup, the façade intersects its invoice read permissions with the upstream tool
   descriptors. On each `execute`, [the sandbox](sandbox.ts) provides frozen JSON to a fresh QuickJS
   context. The server keeps each original MCP result and its associated object handle for that
   invocation.
2. When the program returns one of those objects, the server resolves its identity and preserves its
   native content and metadata. Selection uses the upstream tool’s `_meta.ui.resourceUri`, or a
   complete result’s explicit UI resource, subject to the publisher's exact list of mountable
   resources. An error, a returned copy, or a calculation has no mounted view.
3. The outer tool always declares the same MCP Apps resource. The server writes the chosen inner URI
   to the mcpview extension `_meta["dev.mcpview/declared-view"]` with `version: 1`. Hosts only need
   to open the declared shell and deliver its tool result using the MCP Apps protocol.
4. [The shell](shell.ts) owns the MCP Apps SDK connection. Its dispatcher looks up the exact URI in
   the generated imports, mounts the component in the shell's document and passes through the native
   result. Subsequent results for the same resource update the mounted tree. Switching resources
   aborts and disposes the previous tree. App callbacks reuse the shell's connected host.

## Publisher and workspace boundaries

[The build](build.mjs) traverses ERPNext's own `src/ui/viewers.ts`. It follows the module entry
declared by each resource's HTML and checks the Preact bootstrap and SDK result subscription. It
preserves the original component, JSX and theme setup, replaces the standalone render target with
the supplied element, and binds the component's SDK instance to the shell through
[one adapter](adapter.js). The module is instantiated separately for each mount. The publisher's
global stylesheet and document language and theme still apply to the shell document.

This adapter was exercised with upstream fixtures for invoice, stock, document list, document,
chart, KPI, funnel and kanban. Buy evidence expects a recorded viewer session and explicitly rejects
a raw tool result. Its different entry stays in the manifest's `unsupported` list. Another publisher
can export `mount(root, host, result, signal)` with its own framework and session contract. An
arbitrary standalone HTML resource does not by itself provide that mount contract.
[Buy session contract](https://github.com/Casys-AI/mcp-erpnext/blob/8de156fbb09adec1fb891b5cfd872d9b6c9dfbe4/src/ui/buy-evidence-viewer/src/app.ts)

The invoice workspace enables three read operations, for the invoice list, invoice detail and
overdue KPI. The same scope applies to interactive callbacks from the embedded UI. ERPNext's
navigation hints are preserved. In particular, the invoice's Payments action requests a different
document type and the façade denies it. The example binds only to loopback and carries sample data.
An application connecting live ERP data needs to enforce its own user identity and authorization in
the tool dispatcher.
