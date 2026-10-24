# MCP TypeScript SDK v2

The workspace uses the split official SDK packages:
`@modelcontextprotocol/server`, `@modelcontextprotocol/client`, and
`@modelcontextprotocol/core` (`^2.3.1`), plus `@modelcontextprotocol/ext-apps`
(`^2.0.3`). npm consumers require Node 20+; MCP Apps consumers using Zod need
Zod 4.2+.

## Server consumers

The framework API stays `McpApp` with `handler(args, ctx)`. Registration,
middleware, authentication, and stateless HTTP remain framework-owned:

```ts
import { McpApp } from "@mcpview/server";

const app = new McpApp({ name: "example", version: "1.0.0" });
app.registerTool(
  { name: "ping", description: "Ping", inputSchema: { type: "object" } },
  (_args, _ctx) => "pong",
);
await app.start();
```

Only consumers importing the official SDK directly need to change those imports:

```ts
// Before
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// After (use in place of the imports above)
import { Client } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/core";
```

Direct SDK client calls also drop the output-schema argument:

```ts
// Before
await client.callTool(params, undefined, options);
// After
await client.callTool(params, options);
```

Install the split packages you import directly. SDK v1 and v2 objects are not
interchangeable; review direct SDK handlers and error handling against the v2
API. HTTP remains `POST /mcp` without sessions; `GET /mcp` returns 405.

## OAuth client callbacks

`CallbackServer.start()` retains `codePromise: Promise<string>` and adds
`callbackPromise: Promise<OAuthCallbackResult>`, whose decoded fields are
`{ code, iss?, state? }`. Use the complete callback for SDK v2 authorization:
when the authorization server advertises
`authorization_response_iss_parameter_supported: true`, dropping `iss` makes the
SDK reject the code exchange. A different issuer is also rejected before any
token request. Servers that do not advertise this support can still omit `iss`.

`prepareOAuthProvider()` now returns `callbackPromise` and
`finishAuth(transport)` alongside `provider`, `callbackServer`, and
`callbackPort`. After the initial connection has initiated authorization, pass
the same SDK v2 transport to this helper to forward the captured response:

```ts
const result = await prepareOAuthProvider(serverUrl, config);
const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
  authProvider: result.provider,
});
// Initiate the connection/authorization using your existing client flow.
// If your flow uses state, compare (await result.callbackPromise).state with
// your stored expected state before completing authorization.
await result.finishAuth(transport);
// Reconnect the client using your existing retry flow.
```

The helper calls the SDK's `transport.finishAuth(URLSearchParams)` overload,
preserving `code`, `iss`, and `state`. Applications calling the SDK directly can
use `transport.finishAuth(callback.code, callback.iss)` or
`auth(provider, { serverUrl, authorizationCode: callback.code, iss: callback.iss })`.
Neither the helper nor the SDK validates `state`; that check belongs to the
caller. Continue to close `callbackServer` on error paths.

An OAuth `error` callback rejects both callback promises promptly with the
exported `OAuthCallbackError`. Its `error`, optional `errorDescription`, `iss`,
and `state` fields preserve the response; its message and the browser error page
stay generic. These fields are untrusted before issuer validation.
`finishAuth(transport)` forwards such error responses to the SDK too, allowing
it to validate the issuer before surfacing the denial details. Timeout errors
continue to reject the promises. Ignoring the compatibility `codePromise` does
not cause an unhandled rejection.

## View consumers

`@mcpview/view` keeps its capability-gated `ctx.callTool(name, args?)` wrapper.
The ext-apps `App.callServerTool(params, options?)` object form is preserved:

```ts
await app.callServerTool({ name: "search", arguments: { query: "hello" } });
```

For SDK result types used by views, update direct imports:

```ts
// Before
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
// After
import type { CallToolResult } from "@modelcontextprotocol/client";
```

View schemas already used Standard Schema objects. Keep the `z.object(...)`
shape, but use Zod 4.2+ to provide the now-required `~standard.jsonSchema`:

```ts
import { z } from "zod"; // zod ^4.2.0
const inputSchema = z.object({ query: z.string() });
```

The deprecated `@casys/*` packages remain thin aliases of their `@mcpview/*`
targets; they do not contain a separate SDK.

## Local npm validation

From the repository root, run `node scripts/check-npm-workspace.mjs`. It builds
the six canonical packages and seven aliases, packs local tarballs, installs
them in an isolated consumer, checks NodeNext declarations and alias export
identity, and exercises the Node HTTP adapter. `--skip-build` reuses existing
build output. This complements package tests and release preflight; it does not
publish packages.
