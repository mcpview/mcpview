# Changelog

All notable changes to `@casys/mcp-server` will be documented in this file.

## [Unreleased]

## [0.29.0] — 2026-10-17

### Changed

- **Package renamed back: the framework is again `@casys/mcp-server`.** Same
  code, same API — `packages/platform/` moved back to `packages/server/`
  following the repository rename to
  [superWorldSavior/mcp-platform](https://github.com/superWorldSavior/mcp-platform).
  The 0.28.x entries below were released as `@casys/mcp-platform`; that name
  continues as a deprecated alias (0.28.2) re-exporting this package, so 0.28.x
  imports keep working unchanged. Version 0.29.0 sits above both the last
  platform release (0.28.1) and the last release under this name (0.27.2, the
  alias interlude) so upgrade ordering stays unambiguous on JSR and npm, and the
  npm publication is no longer marked deprecated. Operational identifiers
  (`mcp-server.yaml`, `MCP_AUTH_*`, Prometheus `mcp_server_` prefix) are
  unchanged, as they were through the first rename. See ADR 0003
  (`docs/decision-records/0003-framework-name-mcp-server.md`).

## [0.28.1] — 2026-09-19

### Fixed

- The release pre-flight now type-checks and runs `api-surface_test.ts`. That
  test exercises the covered Tasks, MRTR, and subscription entry points through
  the public `mod.ts`, guarding those exports against becoming unreachable to
  published-package consumers.

### Documentation

- Clarified that `startHttp()` is stateless Streamable HTTP: it accepts MCP
  requests over `POST`, does not create session IDs, and does not expose the
  legacy SSE `GET` stream. The OpenTelemetry example now reflects the same
  contract instead of showing a session attribute the transport does not emit.
- Added a short guide to the companion packages and linked the complete
  `@casys/mcp-server` to `@casys/mcp-platform` migration. These are release and
  documentation corrections only; the framework API and runtime are unchanged.

## [0.28.0] — 2026-09-18

### Changed

- **Package renamed: the framework is now `@casys/mcp-platform`.** Same code,
  same API — `packages/server/` moved to `packages/platform/` following the
  repository rename. Earlier entries below preserve the history released as
  `@casys/mcp-server`.
- `@casys/mcp-server` continues as a deprecated alias re-exporting this package,
  so existing imports keep working unchanged. (`0.1.0` first published the
  platform name as a one-line umbrella; this release moves the framework itself
  here.)

## [0.1.0] — 2026-09-18

### Added

- First release of the `@casys/mcp-platform` name as an umbrella that
  re-exported `@casys/mcp-server@^0.27.0`. It introduced no API or runtime of
  its own, so existing framework imports and behavior remained unchanged. The
  framework itself moved under this package in `0.28.0`.

The `0.27.x` entries below cover the alias interlude (0.27.1–0.27.2, when this
name only re-exported the platform package) and the earlier framework history
released under the `@casys/mcp-server` package name.

## [0.27.2] — 2026-09-19

### Changed

- Both JSR and npm publications now depend on `@casys/mcp-platform@^0.28.0`,
  with the npm build deriving that range from the Deno package manifest so the
  two registries cannot drift apart. The package remains a pure re-export, and
  compatible Platform patches are adopted without another alias release.
- The npm publication smoke now type-checks a strict NodeNext consumer through
  the deprecated package name as well as importing it at runtime, against both
  the newest compatible Platform and the declared `0.28.0` lower bound. This
  protects value and type re-exports without silently raising the alias floor.

### Documentation

- Added explicit npm and Deno migration steps plus the full migration guide, so
  consumers can adopt `@casys/mcp-platform` without treating the rename as an
  API migration.

## [0.27.1] — 2026-09-18

### Changed

- **Deprecated alias:** the framework moved to `@casys/mcp-platform@^0.28.0`.
  This package now re-exports it unchanged. Framework history continues in the
  `@casys/mcp-platform` changelog.

## [0.27.0] — 2026-08-28

### Added

- Static bearer tokens can now opt into identity-aware credentials with a frozen
  `subject` and scope set per token. The existing `string[]` allowlist retains
  its shared-authority semantics, while credential mode rejects unusable
  subjects, ambiguous mixed or duplicate mappings, and metadata that omits a
  granted scope without exposing raw bearer tokens.

### Security

- HTTP scope authorization now follows live tool registration. A tool added or
  replaced with `registerToolLive()` is checked against its current
  `requiredScopes` even when the server started with no scoped tools. Each call
  binds one tool definition for authorization, input validation, handler
  dispatch, and result metadata, so a concurrent replacement cannot mix old
  scopes or schemas with a new handler. Scoped HTTP tools also fail closed when
  no auth provider is configured; stdio remains the trusted local transport.

### Fixed

- Live registration now copies the caller's scope array and validates schemas
  before replacing registry state. Unregistering a tool also removes its cached
  schema, allowing a later tool with the same name to start cleanly.
- The npm package now contains native ESM JavaScript and TypeScript declarations
  generated by `dnt`, and includes its MIT license. The previous build rewrote
  relative imports to `.js` but published only `.ts` files, so its `tsx`-based
  smoke test passed while a normal Node import failed. Publication now tests a
  freshly installed tarball with Node itself, and the public MCP Apps metadata
  type no longer leaks an upstream declaration-layout incompatibility into
  NodeNext consumers.

### Documentation

- Added a test-only native stdio adoption kit for provider repositories. It
  covers real-command launch, HTTP/stdio flag contracts, modern and legacy
  protocol probes, JSON-only stdout, bounded EOF cleanup, and dynamic resource
  lifecycle checks without adding a runtime API or shared CLI parser.

## [0.26.1] — 2026-08-21

### Fixed

- **MCP 2026-07-28 over stdio now uses the official era-aware serving path.**
  Modern clients receive the required `resultType: "complete"` envelope on
  `server/discover`, `tools/list`, and other completed results, while clients
  that begin with legacy `initialize` retain their 2025-11-25 wire shape. The
  server factory creates a fresh protocol instance for a modern probe and a
  possible legacy fallback, so the fallback never reuses a discarded instance.
  This restores all ERPNext tools in Claude Code and fixes
  [mcp-erpnext#22](https://github.com/Casys-AI/mcp-erpnext/issues/22).

- **MRTR retries now have one transport-neutral admission policy.** stdio and
  HTTP share the same signed-state bindings and atomic replay check before
  application dispatch. Modern stdio consumes the v2 retry fields directly;
  legacy stdio uses the SDK compatibility shim and re-enters the same verified
  handler. Malformed lifted responses are rejected before their nonce can be
  spent.

- stdio discovery no longer advertises the HTTP-only Tasks extension or
  `tools.listChanged` until those operations are actually served. Resource
  list-change notifications continue to be emitted when resources are enabled.

- The npm build now declares `@modelcontextprotocol/server` and excludes stdio
  test fixtures, so the published Node distribution resolves the v2 runtime it
  imports.

## [0.26.0] — 2026-08-11

### Added

- **Full resource content and lifecycle support.** `ResourceContent` is now a
  discriminated union: return either `{ text }` or `{ blob }`, never both.
  `blob` is standard padded base64, so binary resources such as images,
  archives, and generated files travel without lossy text coercion. The public
  `TextResourceContent` and `BlobResourceContent` types are exported alongside
  `ResourceContent` and `ResourceHandler`.

  The framework enforces the same boundary at runtime for JavaScript consumers
  and unchecked TypeScript: a handler response must contain exactly one payload
  form, echo the requested URI exactly, have a non-empty MIME type, and use
  canonical base64 for blobs. Resource-content `_meta` is preserved; resource
  `annotations`, `icons`, `title`, and `_meta` belong to the `resources/list`
  metadata where the MCP schema defines them. Existing text handlers that
  already return their requested URI and a MIME type continue to work unchanged.

- `MCPResource.size?: number` publishes a known byte size in `resources/list`
  and attests it on every read: the response must contain exactly that many
  UTF-8 text bytes or decoded blob bytes. The package rejects fractional,
  unsafe, or negative values at registration, rather than emitting metadata a
  client has to disregard. When a resource explicitly registers `mimeType`, a
  read response must use the same value; an omitted resource MIME type is also
  omitted from the listing rather than guessed.

- `unregisterResource(uri): boolean` removes a registered resource safely before
  or after transport startup once resource handlers are installed. The framework
  owns one resource registry and exposes it through low-level MCP list/read/
  templates handlers, so a failed SDK-side rollback cannot leave a ghost
  resource. A missing URI returns `false`, enabling idempotent cleanup.

- `registerResources()` validates handlers, canonical URIs, metadata, existing
  duplicates, and intra-batch duplicates before committing the complete batch.
  It emits exactly one best-effort `notifications/resources/list_changed` after
  a successful started-server mutation, and none on validation failure.

- `expectResources: true` predeclares `resources: { listChanged: true }`,
  including while the registry is empty. `resources/list`, `resources/read`, and
  `resources/templates/list` are then available from startup; the template list
  is explicitly empty until template support is added.

### Changed

- `resourceCsp` only injects into the text branch of an HTML resource. Binary
  blobs are returned byte-for-byte as their base64 payload, even when their MIME
  type is `text/html`.

## [0.25.0] — 2026-08-08

### Security

- **Client credentials are now bound to the authorization server that minted
  them** (spec 2026-07-28, SEP-2352). Previously `tokens()` returned stored
  credentials to any caller. The SDK's `auth()` discovers the authorization
  server from the **MCP server's own** protected-resource metadata and then
  hands those tokens to `refreshAuthorization(authorizationServerUrl, …)` — so
  an MCP server that changed, or was made to advertise, a different
  authorization server received a refresh token minted by the previous one. A
  client must not let a resource server choose who sees its credentials.

  The binding is recorded from `saveDiscoveryState()`, which `auth()` calls
  after discovery and before asking for tokens. Two details matter:

  - It binds to the **discovered URL**, not to `metadata.issuer`. `issuer` is
    published by the authorization server about itself, and SDK 1.29 validates
    the metadata's shape without checking it against the URL it was fetched from
    — so binding to the claim would let an attacker's server unlock another
    server's credentials by claiming its name. A mismatch is logged (RFC 8414
    requires them to match) but nothing depends on the claim.
  - The `refresh_token` carry-over in `saveTokens()` is now scoped to the same
    authorization server. `auth({ authorizationCode })` reaches `saveTokens()`
    without passing through `tokens()`, so an exchange returning no refresh
    token would otherwise have re-labelled the previous server's secret with the
    new issuer.

  **On upgrade:** existing stored credentials carry no recorded issuer, so they
  are discarded once and re-authorization is required. A genuine authorization
  server migration behaves the same way — old credentials dropped, new
  authorization performed — and both are reported through the new optional
  `logger` on the client config.

### Added

- `logger?: (message: string) => void` on the OAuth client config. Credential
  lifecycle events — an authorization server change, a discarded legacy record —
  are otherwise invisible, and an operator seeing an unexpected login prompt has
  no way to find out why. URLs are redacted to origin and path before being
  logged.

- **W3C trace context propagation** (spec 2026-07-28, SEP-414). A tool-call span
  now joins the caller's trace instead of starting a detached one. `traceparent`
  and `tracestate` are read from `params._meta` — bare, not namespaced, which
  the revision spells out as an explicit exception to the `_meta` prefix rule so
  the values match what a caller would put in an HTTP header — and become the
  span's remote parent.

  Both are validated against the W3C grammar rather than passed through:
  `traceparent` follows the forward-compatibility rule (version `00` is a fixed
  55 characters, a higher version may carry unknown trailing fields), and
  `tracestate` members are checked against the ABNF, with invalid or duplicate
  members dropped. The list is re-serialised onto the next hop, so accepting a
  malformed member would turn one peer's bug into ours. `tracestate` is carried
  through a minimal `TraceState` implementation because `@opentelemetry/api`
  declares the interface but ships no implementation.

  **`baggage` is deliberately not read.** It is an unbounded, caller-controlled
  key/value list that routinely carries tenant, user and session identifiers,
  and the only thing this server could do with it is copy it into spans —
  exporting whatever a caller put there to the trace backend, with no way to
  know whether it holds PII or a secret. Propagating it safely needs the OTel
  baggage API and an explicit key allowlist; until a use case asks for that,
  reading it at all is a liability.

  Wired on both transports — a local stdio server is where a detached span is
  hardest to trace back to the host that caused it. stdio now also reads
  `io.modelcontextprotocol/logLevel`, which it previously ignored. A malformed
  header degrades to an unparented span and never fails the call.

### Fixed

- **`server/discover` now answers on stdio.** The spec makes the RPC a MUST for
  every server and names stdio as a primary use — a client probes it for
  backward compatibility. Only the HTTP path implemented it, so a stdio peer got
  `-32601` and concluded this was not a 2026-07-28 server. That conclusion was
  wrong in exactly the case the probe exists for: the SDK's stdio handshake
  negotiates `2025-11-25`, so `server/discover` is the only way a peer learns
  the server also speaks `2026-07-28` over HTTP.

  Routed through the SDK's `fallbackRequestHandler` — `setRequestHandler` takes
  a Zod schema and the method is absent from the SDK's type surface; declaring
  one schema is not worth a Zod peer dependency in the public API. Unknown
  methods still answer `MethodNotFound`. Both transports now build the payload
  from one `buildDiscoverResult()`, so `instructions` or a new capability cannot
  land on one path only.

- **Tool argument validation now runs on JSON Schema 2020-12.** The validator
  imported ajv's default export, which is **draft-07**. Spec 2026-07-28
  (SEP-2106) allows any 2020-12 keyword in `inputSchema` / `outputSchema`, and
  the draft-07 build treats the keywords added in 2020-12 — `prefixItems`,
  `unevaluatedProperties`, `unevaluatedItems`, `$dynamicRef` — as unknown.
  Combined with `strict: false` the failure was **silent**: the schema compiled,
  the constraint never ran, and a violating payload validated clean. A tool
  declaring `prefixItems: [{type:"string"}, {type:"number"}]` accepted
  `[42, "nope"]`.

  **Two breaking consequences**, both worth checking before upgrading:

  1. A deployment already shipping a 2020-12 schema will see payloads that used
     to pass now correctly fail.
  2. A schema using the **draft-07 tuple form** — `items: [...]` with an array —
     is now rejected by ajv at compile time, so `registerTool` throws and the
     tool never registers. 2020-12 replaced that form with `prefixItems` and
     requires `items` to be a single subschema. The failure is at startup, not
     on first call, and it is deliberate: a tool whose declared boundary cannot
     be enforced should not come up pretending it can. Migration is mechanical —
     rename `items` to `prefixItems`.

  Everything draft-07 and 2020-12 share is unaffected, including
  `items`-as-a-single-subschema, which is the form used throughout this repo.
  Both cases are pinned by tests.

- **`fallbackRequestHandler` changes the message on unrouted methods.** The code
  is unchanged (`-32601`), but the string a stdio peer receives goes from
  `"Method not found"` to `"MCP error -32601: Method not found"`: an error
  raised from a handler travels as `McpError`, whose constructor adds that
  prefix, and there is no way to raise the code from a handler without it. Only
  a peer matching on the message text rather than the code is affected.

## [0.24.1] — 2026-07-31

### Fixed

- Signed MRTR `requestState` tokens are now consumed before handler dispatch, so
  a second use of the same nonce is rejected with `reason: "replayed"` without
  re-running business logic. The default `MemoryMrtrReplayStore` protects one
  continuously running process and fails closed at bounded capacity.
- `MrtrOptions.replayStore` accepts an atomic shared implementation for
  load-balanced and restart-safe deployments. Store errors fail closed with
  `mrtr_replay_store_unavailable`; they never degrade silently to an unverified
  retry.

This is at-most-once admission, not exactly-once completion. A deployment that
must return the outcome after a lost response still needs an idempotency/result
ledger coordinated with its downstream mutation.

## [0.24.0] — 2026-07-30

### Removed — BREAKING

The stateful transport is gone. `transport` now accepts only `"stateless"`;
consumers that passed `"stateful"` explicitly must drop it, and those that
omitted the option are unaffected because omission already selected the only
remaining behaviour.

Removed with it: protocol-level sessions and `Mcp-Session-Id`, the `GET /mcp`
SSE stream, `Last-Event-ID` resumption, `sendToSession`,
`broadcastNotification`, `getSSEClientCount`, and the deprecated
`SamplingBridge` — superseded by MRTR, which carries server→client interactions
inside results instead of as separate requests.

Also removed: tolerance for pre-2026 protocol revisions.
`STATELESS_SUPPORTED_VERSIONS` is `["2026-07-28"]` alone; a request declaring
`2025-06-18` or `2025-11-25` now receives `-32022` with `data.supported`. That
tolerance never served a real client — pre-2026 revisions used `initialize` plus
the `MCP-Protocol-Version` header, never the per-request `_meta` envelope this
transport requires before dispatch. What it accepted was a hybrid that only our
own tests constructed.

### Fixed

- A missing `MCP-Protocol-Version` header now returns `-32020`
  (`HeaderMismatch`) rather than `-32602`. The spec lists a missing required
  standard header as a header-validation failure; answering `-32602` pointed a
  legacy client at the wrong fix — its body field — when the header was the
  primary violation.
- `DELETE /mcp` returns `405` rather than `404`, alongside `GET`. DELETE was the
  session-termination verb in earlier revisions, and `404` reads to an older
  client as "no MCP endpoint here", triggering a fallback to the deprecated
  HTTP+SSE transport.

### Changed

- `minItems`, `maxItems`, `uniqueItems`, `minProperties` and `maxProperties`
  validation errors now carry a formatted message and a structured `expected`,
  like every other keyword. They were always enforced — ajv compiles the whole
  schema — but fell through to the default branch with `expected` undefined,
  which is the field an agent reads to build a recovery.
- Internal: `src/http/{body,request-guards,wire}.ts` extracted from `mcp-app.ts`
  (4640 → 3867 lines). None is re-exported; no public API change.

## [0.23.0] — 2026-07-30

MCP **2026-07-28 is Final** (shipped 2026-07-28). Tracks A–F were built against
the May 2026 Release Candidate, which the final revision changed in ways that
made part of 0.21.0 non-conformant. This release covers **Track H** (result
envelope + removals), the **Track F fix** (error-code renumbering), **Track C**
(request-metadata headers + cache fields), **Track G** (`subscriptions/listen`),
**Track B** (Multi Round-Trip Requests) and **Track I** (the Tasks extension).

All changes are confined to peers that negotiate `2026-07-28`. The default
**stateful** transport is byte-identical to 0.22.0, and a peer negotiating an
earlier revision over the stateless transport also sees the 0.22.0 shape. (Both
of those statements ceased to hold in 0.24.0, which removed the stateful
transport and pre-2026 tolerance entirely.)

### Changed — BREAKING on the stateless transport

- **Error codes renumbered** to match the final allocation policy, which
  partitions the JSON-RPC server-error range: `-32000`..`-32019` stays
  implementation-defined (existing SDK usage grandfathered), `-32020`..`-32099`
  is reserved for the specification.

  | Condition                            | 0.21.0 (RC) | Now      |
  | ------------------------------------ | ----------- | -------- |
  | Unsupported `protocolVersion`        | `-32004`    | `-32022` |
  | `MCP-Protocol-Version` header ≠ body | `-32602`    | `-32020` |

  The 403-forbidden code stays `-32002`: it sits in the grandfathered range, so
  a server-specific meaning is legitimate there. Its original justification —
  "SEP-2575 reserves `-32003`" — no longer holds, since that reservation moved
  to `-32021`; only the inline rationale changed.

- **`ping` and `logging/setLevel` now return HTTP 404 + `-32601`.** The final
  spec **removes** both methods rather than deprecating them. 0.21.0
  deliberately kept answering `ping` with `{}` for backward compatibility; that
  turned out to be actively harmful — a client probing for a modern server
  distinguishes it from a legacy HTTP+SSE server precisely by the 404 + `-32601`
  response, so answering `{}` defeated the probe. Both methods still work on the
  stateful path, whose peers negotiate `2025-06-18`.

  The 404 applies to **any** unimplemented stateless RPC, not just these two —
  including `subscriptions/listen` until Track G lands. Special-casing the two
  removed methods would have left every other unknown method answering 200.

### Fixed — four rounds of adversarial review

Four review rounds found 11, then 8, then 5, then 2 blocking defects. The trend
matters: after round 1, most findings were regressions in the _repair paths_,
not in the original work — so each round was pointed at the previous round's
fixes first.

The ones worth knowing about as a consumer:

- **A serialisation-boundary bypass.** The MRTR sub-capability gate inspected
  live JS values while the response serialised the original object later — two
  different checks over one payload. `mode: new String("url")` is not
  `=== "url"` but serialises to `"url"`; a `toJSON()` can introduce `tools` only
  at serialisation time. The gate canonicalises the whole `inputRequests` map
  once and the transport emits **that clone**, so the value checked and the
  value sent are the same object. An earlier attempt canonicalised only for the
  check and let the transport serialise the original again — which a stateful
  `toJSON()` walks straight through.
- **`requiredCapabilities` was flat** (`{"elicitation.url": {}}`), which a typed
  client deserialises as `{}` — reading as "nothing missing", the opposite of
  the message. Now nested per `ClientCapabilities`.
- **A rejected HMAC key import was cached forever**, so every later MRTR retry
  surfaced as `-32700 Parse error` and no second import was attempted.
- **Task authorization.** Tasks are bound to an owner key;
  `McpAppOptions.taskOwnerKey` is the hook for deployments authorizing on more
  than identity. It must derive everything from its arguments — `tasks/*` does
  not run the middleware pipeline, so pipeline-injected state such as a tenant
  id is not visible there. An empty or non-string key is refused rather than
  collapsing every caller onto one owner.
- **Shutdown behaviour.** No task is accepted once `stop()` begins, and a
  restarted server accepts them again. Tasks are reachable only over the
  stateless HTTP transport — stdio has no per-request capability negotiation —
  but its `start()` shares the same reset, so a stopped stdio server no longer
  keeps a disposed store.

### Fixed — conformance and security, from adversarial review

A final review round found eleven blocking defects in the newly wired tracks.
All are fixed; each is listed because several were only visible on the wire, not
in the modules.

**Security**

- **`inputResponses` without a `requestState` bypassed verification entirely.**
  The two fields were read independently, so a caller could supply answers with
  no token and the handler received them unverified. Refused now, before
  dispatch.
- **Tasks had no owner.** Any authenticated caller who learned another caller's
  task id could read, answer or cancel it. The spec makes this a MUST: "Servers
  MUST perform authentication and authorization checks on each task-related
  request." Tasks are bound to their creating principal, and a foreign id is
  reported exactly like an unknown one — telling a caller that a task exists but
  is not theirs would confirm the id an unguessable handle is meant to withhold.
- **An authenticated token with no `sub` collapsed every caller onto one
  identity.** `AuthInfo.subject` falls back to `"unknown"`, and sealing against
  that made the principal binding look enforced while separating nothing. Now
  throws: worse than no auth, because it is invisible.
- **Unknown MRTR methods could be "satisfied".** An unrecognised
  `inputRequests[*].method` was mapped to its own name, so a client declaring a
  capability of that name passed the check. MRTR permits exactly elicitation,
  sampling and roots; anything else now fails unconditionally.

**Conformance**

- `tasks/update` and `tasks/cancel` return **empty acknowledgements**. Returning
  task state was non-conformant and, since the spec calls these acks eventually
  consistent, potentially stale.
- A completed task now carries the **result shape the original request would
  have returned** (a `CallToolResult`), not the handler's raw return value. The
  store stays MCP-agnostic: the transport injects the same conversion the
  synchronous path uses, so both produce identical output for the same handler.
- Tasks and `subscriptions/listen` are **gated on the negotiated version**, not
  just the capability. A `2025-11-25` peer could previously use a 2026-only
  extension, which the spec forbids outright.
- `requiredCapabilities` is a **`ClientCapabilities` object**, not an array of
  names, on both the Tasks and MRTR errors — and the MRTR one now carries `data`
  at all.
- An absent or non-object `notifications` filter on `subscriptions/listen` is
  **rejected** rather than read as `{}`, which had produced a 200 stream that
  stayed silent forever with no way to tell why.
- An unknown `taskId` is an error on all three task methods, not a successful
  no-op.

**Robustness**

- The MRTR argument digest is **snapshotted at ingress**. It was re-derived at
  seal time from the same mutable `args` the middleware pipeline had already
  touched, so a client replaying its request byte-for-byte could fail
  `wrong_params` through no fault of its own.
- The task sweep timer is **unref'd**, and `stop()` disposes the task store and
  subscription registry **before** its `started` guard — a server that failed
  during startup previously left both armed with no way to reach them.
  Notifications are suppressed after disposal, since a drained task's work can
  still settle afterwards (abort is cooperative).

### Added — Tracks G, B and I: subscriptions, MRTR and Tasks

All three are now reachable from the transport, not just present as modules.

- **`subscriptions/listen`** replaces the removed GET stream and
  `resources/subscribe`. The response is the SSE stream; the acknowledgement is
  guaranteed first; `X-Accel-Buffering: no` keeps proxies from buffering events.
  `sendNotification()` now fans out through the registry on the stateless
  transport — previously it walked the session-keyed SSE map, which is always
  empty there, so notifications vanished with no error.
- **MRTR** (`resultType: "input_required"`): a handler asks the client for
  input, and the framework seals the `requestState` binding principal, method,
  argument digest and expiry. A tampered, expired or cross-request token is
  rejected before the handler runs. Confined to a negotiated `2026-07-28`.
- **Tasks extension**, switched on by declaring
  `extensions["io.modelcontextprotocol/tasks"]`. `createTask()` in a handler
  returns a task handle; `tasks/get`, `tasks/update` and `tasks/cancel` are each
  capability-guarded.

New options: `McpAppOptions.mrtr` and the `extensions` declaration for Tasks.
`ToolHandlerContext` gains `inputResponses` and `retryVerified`.

Not covered: MRTR on `resources/read` (needs a breaking `ResourceHandler` return
type) and `prompts/get` (needs a prompts API), and single-use `requestState` —
the spec states plainly that its measures do not guarantee at-most-once.

### Changed — errors carry structured recovery data

Every `-32020` (HeaderMismatch) now ships a JSON-RPC `data` payload instead of
leaving the caller to parse an English sentence:

```json
{
  "code": -32020,
  "message": "Mcp-Name header \"wrong_tool\" does not match body value \"echo\"",
  "data": {
    "problem": "header_body_mismatch",
    "header": "Mcp-Name",
    "expected": "echo",
    "received": "wrong_tool",
    "bodyField": "params.name",
    "recovery": "Set the header to mirror the body: 'Mcp-Name: echo'."
  }
}
```

`problem` is an enum — `missing_header`, `header_body_mismatch`,
`malformed_encoding`, `unmirrorable_body` — meant to be switched on. `recovery`
is one concrete action. A client that gets a header wrong can correct itself
without natural-language processing, which matters because these are the errors
an automated caller hits most often. Applies to all fourteen rejection paths in
the validator plus the two the transport builds directly.

### Changed — fail at the boundary, and one verb per job

- `mrtr.signingKey` is validated in the constructor. A typo in a 64-hex secret
  used to surface on the first request that needed it — a production runtime
  failure rather than a boot failure.
- `sendToSession` and `broadcastNotification` are `@deprecated`. Three public
  verbs meant "notify", and two of them silently reach nobody on the stateless
  transport. `sendNotification` is the one that works everywhere; the others die
  with the stateful path.

### Fixed

- `createTask` and the MRTR / subscription types were absent from the package
  barrel, so the Tasks extension was fully wired, fully tested and **unusable by
  any consumer**. Added, along with `packages/server/api-surface_test.ts`, which
  imports through `mod.ts` the way a consumer does — internal tests reach into
  `src/` and prove nothing about reachability.
- `enableSampling` now warns that it has no effect on the stateless transport.
  Spec 2026-07-28 removed server-initiated requests, so the bridge has no
  channel there; without the warning the failure looks like a request that never
  returns.

### Changed — BREAKING: auth and session error codes moved out of the reserved range

- `401` unauthorized `-32001` → **`-31401`**, `403` forbidden `-32002` →
  **`-31403`**, stateful session-expired `-32001` → **`-31404`**.

  Not cosmetic. The final spec states that implementations of this revision
  **MUST NOT** emit `-32002` (2025-11-25 used it for resource-not-found, now
  `-32602`), and that new implementations **SHOULD NOT** use `-32000`..`-32019`
  at all — receivers "MUST NOT assume any specific meaning" for that sub-range.
  Earlier readings of the allocation policy, including a review of this very
  file, treated the low range as a grandfathered sandbox. It is not.

  The spec's guidance for codes it does not define is to allocate outside the
  JSON-RPC reserved range entirely, hence `-314xx` — mnemonic for the HTTP
  status each accompanies. Anything matching on the old numbers must be updated.

### Added — Track C: request-metadata headers and cache fields

- **Required request headers are now validated** (SEP-2243). Every POST from a
  peer negotiating `2026-07-28` must carry `MCP-Protocol-Version` and
  `Mcp-Method`, plus `Mcp-Name` on `tools/call`, `prompts/get` and
  `resources/read`. A missing or disagreeing header is rejected with HTTP 400
  and `-32020`.

  This closes a real hole rather than ticking a box: intermediaries route, meter
  and rate-limit on the headers while the server executes the body. Letting the
  two disagree is what the spec's mandatory validation exists to prevent.

  `MCP-Protocol-Version` was previously checked "tolerantly" — only when
  present. It is now required.

- **`x-mcp-header` parameter mirroring.** A tool may annotate primitive,
  statically-reachable `inputSchema` properties so clients mirror them into
  `Mcp-Param-{Name}` headers; the server validates each against the argument at
  that exact property path. Annotations are validated **at registration**, not
  per call: a conforming client drops the whole tool from `tools/list` over a
  malformed annotation, so a typo would otherwise present as a tool that
  silently does not exist.

  The `=?base64?…?=` sentinel is decoded before comparison, integers compare
  numerically (`42.0` equals `42`), and header names compare case-insensitively
  per RFC 9110.

- **`ttlMs` / `cacheScope` on list and read results** (SEP-2549), required
  fields of `CacheableResult`. Configured via `McpAppOptions.cache`, with
  deliberately inert defaults — `ttlMs: 0` and `cacheScope: "private"`. A
  framework has no business choosing a staleness window for a tool list built
  from a live database, nor permitting shared caches to store results that may
  be scoped to the authenticated principal.

- **`tools/list` is ordered deterministically.** Map iteration was already
  insertion-ordered, so this only matters where registration order is not stable
  — which it is not in relay/proxy mode, where tools are registered as child
  servers are discovered asynchronously.

- Legacy peers and notifications are exempt from the header contract: the
  headers do not exist before `2026-07-28`, and the revision leaves requirements
  for notification POSTs undefined.

### Added

- **`resultType: "complete"` on every stateless result** (SEP-2322), plus the
  server's identity under `_meta["io.modelcontextprotocol/serverInfo"]`
  (SEP-2575). A tool's own `_meta` is merged, never replaced — MCP Apps viewers
  carry their UI hints there.

  Gated on the **negotiated version**, not on the transport. The distinction
  matters: the stateless transport also accepts `2025-06-18` and `2025-11-25`,
  so gating on the transport would have stamped a 2026 envelope onto responses
  to peers on an earlier revision. Omitting it for them is safe — the spec
  instructs clients to read a missing `resultType` as `"complete"`.

- **`extensions` option** on `McpAppOptions`, surfaced under
  `capabilities.extensions` on `server/discover` and `initialize`. Keyed by
  reverse-DNS identifier (e.g. `{ "io.modelcontextprotocol/tasks": {} }`) and
  emitted **only when non-empty**: an empty `extensions: {}` would assert "this
  server supports no extensions", a stronger claim than the framework can make
  on a consumer's behalf. Prerequisite for declaring the Tasks extension.

- **Per-request log level.** `ToolHandlerContext.logLevel` exposes
  `params._meta["io.modelcontextprotocol/logLevel"]`, replacing the removed
  `logging/setLevel` RPC. `undefined` means the client opted out of logging, and
  the spec is explicit that a server **MUST NOT** emit `notifications/message`
  in that case. Unrecognized severities are dropped rather than rejected —
  failing a whole tool call over a bad hint would be the worse outcome.

- `packages/server/src/result-envelope_test.ts`: walks the method table instead
  of asserting a single endpoint, so a new handler that forgets the envelope
  fails here rather than in a consumer.

## [0.22.0] - 2026-07-21

### Added

- `createStaticTokenAuthProvider` / `StaticTokenAuthProvider`: a static (opaque)
  bearer-token `AuthProvider` for same-network deployments, service-to-service,
  and CI — validate a fixed set of pre-shared tokens with no OIDC/JWT
  infrastructure (no issuer, no JWKS, no key management). All valid tokens share
  one `AuthInfo` (frozen); RFC 9728 metadata is emitted with an empty
  `authorization_servers` (tokens are provisioned out of band).
- `docs/guides/securing-your-http-server.md`: task-oriented guide for choosing
  between static tokens and OAuth/OIDC, plus `requireAuth` and per-tool scopes.

## [0.21.1] - 2026-07-16

Runtime-portability fix: consumers that bundle the JSR source for Node.js (e.g.
`@casys/mcp-erpnext`'s npm build) no longer crash with
`ReferenceError: Deno is not defined` in HTTP mode.

Thanks to **Denny Pradipta**
([@dennypradipta](https://github.com/dennypradipta)) for reporting and
documenting the bug in
[Casys-AI/mcp-erpnext#4](https://github.com/Casys-AI/mcp-erpnext/pull/4).

### Fixed

- **Runtime adapter selected at load time instead of a build-time file swap.**
  `src/runtime/runtime.ts` is now a selector that probes the host runtime
  (`Deno.version.deno`) and dynamically imports `runtime.deno.ts` or
  `runtime.node.ts`. The previous `build-node.sh` swap only applied to our own
  npm build — JSR consumers bundling for Node shipped `Deno.readTextFile` /
  `Deno.serve` and crashed in `startHttp()`. The inactive adapter is never
  evaluated, so Deno Deploy stays clear of `node:http` at load time and Node
  stays clear of `Deno.*`.
- **`launchInspector` now works under Node.** The inspector launcher was the
  last module calling `Deno.*` directly (`Deno.Command`, `Deno.env.toObject`,
  `Deno.exit`, `Deno.build.os`); it now uses `node:child_process` /
  `node:process` — supported by both runtimes — imported lazily inside the
  function bodies.

### Changed

- `build-node.sh` no longer swaps runtime files; the npm dist ships all three
  (`runtime.ts` selector + both adapters), identical to the JSR source.
- The npm publish smoke test now covers `McpApp.startHttp()` + an MCP
  `initialize` round-trip under Node, guarding the runtime selector against
  regressions.

## [0.21.0] - 2026-06-30

Stateless transport brought in line with the finalized **SEP-2575**, plus
auth/OAuth conformance fixes. All changes are confined to the stateless
transport and the auth/client-auth layers — the default **stateful** transport
is unchanged.

### Added

- **`server/discover` RPC in the stateless transport (SEP-2575).** A stateless
  server now answers `server/discover` with its `supportedVersions`,
  `capabilities`, `serverInfo`, and (when configured) `instructions`, letting
  clients negotiate without an `initialize` handshake. Stateful mode is
  unaffected.
- **Per-request `clientInfo` / `clientCapabilities` exposed to tool handlers.**
  In stateless mode, tool handlers can read the client's identity and
  capabilities from the SEP-2575 namespaced `_meta` keys via
  `ToolHandlerContext`. Both fields are optional — a request without them still
  succeeds.

### Changed

- **Stateless error codes aligned with the finalized SEP-2575.** A missing
  per-request protocol version now returns `-32602` (INVALID_PARAMS) instead of
  `-32020`, and an unsupported version returns `-32004`
  (UNSUPPORTED_PROTOCOL_VERSION) instead of `-32022`. Stateless transport only.
- **`MCP-Protocol-Version` header validated in stateless mode (tolerant).** When
  the header is present it must match the `_meta` protocol version, otherwise
  the request is rejected with `400` / `-32602`. The header stays optional for
  backward compatibility with existing `_meta`-only clients.
- **403 responses are now distinct from 401.** Insufficient-scope responses use
  a dedicated JSON-RPC code (`-32002`, chosen to avoid the SEP-2575 reserved
  `-32003`) and emit `WWW-Authenticate: Bearer ..., error="insufficient_scope"`
  per RFC 6750/9728, so clients can tell an authorization failure from an
  authentication one.
- **The OAuth client now declares the `refresh_token` grant.** `grant_types`
  includes `"refresh_token"` (provider metadata and CIMD document), and
  `saveTokens` preserves an existing refresh token when a later save omits one.

### Notes

- `initialize` and `ping` are intentionally retained in stateless mode for
  backward compatibility, even though SEP-2575 removes them.
- The stateless transport is not yet interoperable with the stock
  `@modelcontextprotocol/sdk` 1.29 client (which does not emit the SEP-2575 wire
  format); the acceptance suite uses a conformant in-house client and verifies
  round-robin across two instances with no sticky session.

## [0.20.0] - 2026-06-29

MCP 2026-07-28 groundwork: an experimental stateless transport (Track A) plus
the Track D and Track E deprecations and additions.

### Added

- **Experimental stateless HTTP transport (`transport: "stateless"`, MCP
  2026-07-28 Track A).** The server can serve requests without a session (no
  `Mcp-Session-Id`); the protocol version is carried per-request in
  `params._meta` (`io.modelcontextprotocol/protocolVersion`). Opt-in via the new
  `transport` option (`"stateful"` default, `"stateless"`), which replaces the
  earlier `enableStatelessV2` flag.
- **`application_type: "native"` in DCR client metadata (Track E, MCP
  2026-07-28).** Loopback CLI/desktop clients advertise the native application
  type so strict authorization servers don't reject `http://127.0.0.1` redirect
  URIs.

### Deprecated

- **Sampling and `logging/setLevel` (Track D, MCP 2026-07-28).** Marked
  deprecated ahead of their removal in the stateless model.

### Changed

- Bump `@modelcontextprotocol/ext-apps` to `^1.7.4`.

## [0.19.0] - 2026-06-29

### Added

- **Client-side Client ID Metadata Document (CIMD) support is now public and
  opt-in.** OAuth clients can configure
  `clientRegistration.method = "client_id_metadata"` and use
  `buildClientIdMetadataDocument()` to publish a spec-shaped client metadata
  document where `client_id` is the metadata URL.
- **The OAuth client-auth surface is now exported from the package root.**
  `prepareOAuthProvider`, `OAuthClientProviderImpl`, `CallbackServer`, token
  stores, client-auth config types, and CIMD helpers are available from
  `@casys/mcp-server` alongside the server auth APIs.

### Changed

- **The OAuth callback server now binds to `127.0.0.1` by default.** This keeps
  local authorization-code callbacks on loopback instead of listening on all
  interfaces, while preserving explicit hostname configuration for callers that
  need it.
- **The public client-auth runtime now uses the shared runtime port.**
  `CallbackServer` and `FileTokenStore` no longer depend on Deno-only globals in
  the Node/npm build, while static client registrations keep the historical
  `http://localhost:<port>/callback` redirect URI.
- **Callback bind failures now reject cleanly across Deno and Node.** The
  runtime port exposes an optional bind-error channel, so a fixed CIMD callback
  port collision fails `CallbackServer.start()` instead of crashing the Node
  process with an unhandled server `error` event.
- **The npm publish path now runs a client-auth smoke test before publish.** The
  generated `dist-node` package imports the public API and exercises CIMD
  document building, `FileTokenStore`, `CallbackServer`, and occupied-port
  rejection.
- **CIMD config validation is stricter before runtime work begins.** Invalid or
  incomplete `clientRegistration` objects now fail with structured
  `CimdConfigError` codes, and `metadata.extra` rejects all reserved OAuth
  client metadata keys instead of silently shadowing derived fields.
- **The MCP 2026-07-28 migration plan now treats CIMD as the modern Track E
  registration path.** The AS metadata proxy remains documented as a DCR
  compatibility/legacy interop path, and the erroneous note about injecting DCR
  `application_type` from the proxy has been removed.

## [0.18.0] - 2026-06-03

### Removed (breaking)

- **Dropped the `@casys/mcp-compose` dependency entirely.** `mod.ts` no longer
  re-exports the UI composition helpers `composeEvents`, `uiMeta`,
  `COMPOSE_EVENT_METHOD` (nor their types `ComposeEventHandler`,
  `ComposeEventPayload`, `ComposeEvents`, `ComposeSource`, `ComposeTarget`,
  `UiMetaOptions`, `UiMetaResult`, `UiMetaUi`). These were a convenience
  pass-through that forced every `@casys/mcp-server` consumer to install
  `@casys/mcp-compose`. **Migration:** import them directly from
  `@casys/mcp-compose/sdk` instead. With the base `McpUiToolMeta` type now
  sourced from `@modelcontextprotocol/ext-apps` (0.17.7), server depends only on
  the official protocol packages (`@modelcontextprotocol/sdk` + `ext-apps`) and
  is a lean MCP framework again.

## [0.17.7] - 2026-06-03

### Changed

- **`McpUiToolMeta` base type now imported from `@modelcontextprotocol/ext-apps`
  instead of `@casys/mcp-compose/core`.** The base type was never owned by
  compose — `compose/core` merely re-exported it verbatim from the official
  ext-apps package. Server already wraps `@modelcontextprotocol/sdk` throughout,
  so consuming the MCP Apps contract from its real upstream source (the same
  official `@modelcontextprotocol/*` family) removes a needless detour through
  compose for a type that lives in the spec. Type-only import — erased at
  runtime, no behaviour change. `@modelcontextprotocol/ext-apps` is now a
  declared dependency of the npm build. The `@casys/mcp-compose` dependency
  stays (still used for the `composeEvents`/`uiMeta` value re-exports in
  `mod.ts`).

## [0.17.6] - 2026-06-03

### Fixed

- **npm package now declares its `@casys/mcp-compose` dependency.** `mod.ts`
  re-exports `@casys/mcp-compose/sdk` and `src/types.ts` imports
  `@casys/mcp-compose/core`, but the generated npm `package.json` never listed
  the dependency — it only resolved through the Deno workspace. As a result
  `npm install @casys/mcp-server` left the bare `@casys/mcp-compose/*` imports
  unresolvable (`Cannot find module`). `build-node.sh` now reads the compose
  version from `../compose/deno.json` and adds `@casys/mcp-compose` to the
  generated dependencies, and `deno.json` declares the import explicitly
  (`jsr:@casys/mcp-compose@^0.5.2`) so JSR records the same coupling. The build
  script's in-place `sed` calls were also made portable (GNU + BSD/macOS).

## [0.17.5] - 2026-04-16

### Fixed

- **JWT rejection now logs the reason instead of swallowing it.** The bare
  `catch {}` in `verifyToken` (jwt-provider.ts) returned `null` for _all_
  errors, so JWKS fetch failures, audience mismatches, signature errors, and
  token expiration were indistinguishable in production logs. Operators looking
  at a 401 had no signal to differentiate "wrong audience" from "JWKS
  unreachable" from "token genuinely invalid". The actual error message is now
  written to `console.error` before mapping back to the `401` response,
  preserving the existing external behaviour while making the failure mode
  diagnosable.

## [0.17.4] - 2026-04-16

### Fixed

- **Eliminated redundant `verifyToken` call on `tools/call`.** The HTTP-level
  auth gate (`verifyHttpAuth`) and the middleware pipeline
  (`createAuthMiddleware`) both called `provider.verifyToken()`, causing two
  independent JWKS lookups per tool call. On cold cache (after server restart),
  concurrent requests could race against the JWKS fetch — one call succeeds
  while the other gets a transient failure swallowed by `catch {} → null → 401`.
  Fix: `verifyHttpAuth` now returns the verified `AuthInfo`, which is passed to
  the middleware context. `createAuthMiddleware` skips re-verification when
  `ctx.authInfo` is already set.

## [0.17.3] - 2026-04-16

### Fixed

- **`resolveViewerDistPath` now handles HTTPS module URLs (JSR / remote
  modules).** When a package is consumed from JSR, `import.meta.url` is an
  `https://jsr.io/...` URL, not a `file://` URL. The previous code passed it to
  `fileUrlToPath()`, which only handles `file://` URLs, producing a broken
  UNC-like path (`//jsr.io/...`) and making every candidate `exists` check fail.
  The fix adds an early HTTPS branch that returns the raw resolved URL string
  (via `new URL(...).href`) instead of calling `fileUrlToPath`. The `exists` and
  `readFile` callbacks receive the HTTPS URL string and are responsible for
  handling it (e.g., via `fetch()`). The existing `file://` path is unchanged.

## [0.17.2] - 2026-04-16

### Fixed

- **Auth gate now covers `initialize` method** when `requireAuth: true`.
  Previously, `initialize` was excluded from auth checking, which prevented MCP
  clients (Claude.ai, Cursor) from discovering the OAuth flow — they received a
  200 response instead of the 401 needed to trigger WWW-Authenticate → PRM → AS
  metadata → DCR discovery.

- **Protocol version bumped to `2025-06-18`** (was `2025-03-26`). The 2025-06-18
  spec introduced mandatory auth support; clients seeing the old version skip
  the auth flow entirely.

## [0.17.1] - 2026-04-16

### Added

- **`createAsMetadataHandler`** — framework-agnostic Web Standard handler that
  serves an RFC 8414 Authorization Server Metadata document enriched with
  `registration_endpoint` (RFC 7591). Enables MCP servers behind IdPs without
  native Dynamic Client Registration (e.g., Zitadel, unconfigured Keycloak, Okta
  free tier) to advertise a DCR proxy so clients like Claude.ai can
  auto-register. See `AsMetadataProxyOptions` for configuration.
  - Two input forms: `upstreamMetadataUrl` (any AS) or `upstreamIssuer` (OIDC
    shorthand) — mutually exclusive, validated at construction time
  - Built-in stale-while-revalidate caching (default 24h TTL) with
    thundering-herd guard on background refreshes
  - Upstream response shape validation (requires JSON object with `issuer`)
  - Injectable `fetch` for testing and advanced use cases (mTLS, retries)
  - Fail-fast validation at construction: URLs, mutual exclusivity, `cacheTtlMs`
  - 405 Method Not Allowed on non-GET/HEAD requests
  - `extraFields` for overriding upstream metadata — `registration_endpoint` is
    always preserved regardless of `extraFields` content

## [0.17.0] - 2026-04-11

This release bundles the four deferred items from the 0.16.0 type-design review
(issues [#11](https://github.com/Casys-AI/mcp-server/issues/11),
[#12](https://github.com/Casys-AI/mcp-server/issues/12),
[#13](https://github.com/Casys-AI/mcp-server/issues/13),
[#14](https://github.com/Casys-AI/mcp-server/issues/14)) into one breaking minor
bump. Three of four are BREAKING; one is additive. All four live in `src/auth/`,
so a single migration pass covers the whole auth module. Preset users (the 90%
case) need **zero changes**; only direct `new JwtAuthProvider(...)` callers,
custom `AuthProvider` subclasses, and app-code constructing `AuthConfig` /
`AuthOptions` literals need updates.

### BREAKING

**(1) [#12](https://github.com/Casys-AI/mcp-server/issues/12) —
`JwtAuthProviderOptions` now requires a `kind: "url" | "opaque"` discriminant
tag.**

The 0.16.0 DU lacked a discriminant, which made:

- TypeScript narrowing unsound (finding C1 from the 0.16.0 review). After
  `if (options.resourceMetadataUrl !== undefined)`, TS could not narrow
  `options.resource` from `HttpsUrl | string` to `HttpsUrl` because the union
  collapsed to `string`. The constructor comment documented this honestly as
  "defense-in-depth via re-validation" but the type system wasn't doing the work
  it claimed.
- Branches not strictly disjoint (finding C2). A caller annotating their
  constant as `JwtAuthProviderOptionsOpaqueResource` with an `HttpsUrl`-branded
  `resource` type-checked anyway because `HttpsUrl
  extends string`.
  Semantically misleading, no runtime bug.

0.17.0 adds an explicit `kind` tag to both branches:

```typescript
// Before (0.16.x)
new JwtAuthProvider({
  issuer: "https://idp.example.com",
  audience: "https://api.example.com",
  resource: httpsUrl("https://api.example.com"),
  authorizationServers: [httpsUrl("https://idp.example.com")],
});

// After (0.17.0)
new JwtAuthProvider({
  kind: "url", // ← NEW: required
  issuer: "https://idp.example.com",
  audience: "https://api.example.com",
  resource: httpsUrl("https://api.example.com"),
  authorizationServers: [httpsUrl("https://idp.example.com")],
});
```

The constructor now narrows soundly on `options.kind === "opaque"`: after the
check, TS knows `resource` is `string` with required `resourceMetadataUrl`; in
the else branch, TS knows `resource` is `HttpsUrl`. No more honest-but-unsound
comments.

**(2) [#11](https://github.com/Casys-AI/mcp-server/issues/11) — `AuthConfig` is
now a discriminated union on `provider` tag.**

The flat 0.16.x interface used optional `domain?` / `issuer?` fields guarded by
runtime checks in `loadAuthConfig()`. A TS caller could construct an invalid
`AuthConfig` literal (e.g., `provider: "auth0"` without `domain`) and the
compiler wouldn't complain — the failure only surfaced at boot.

0.17.0 lifts the invariant to the type level via 4 exported variants:

```typescript
export interface GitHubAuthConfig extends AuthConfigBase {
  provider: "github";
}
export interface GoogleAuthConfig extends AuthConfigBase {
  provider: "google";
}
export interface Auth0AuthConfig extends AuthConfigBase {
  provider: "auth0";
  domain: string; // required
}
export interface OIDCAuthConfig extends AuthConfigBase {
  provider: "oidc";
  issuer: string; // required
  jwksUri?: string;
}
export type AuthConfig =
  | GitHubAuthConfig
  | GoogleAuthConfig
  | Auth0AuthConfig
  | OIDCAuthConfig;
```

`createAuthProviderFromConfig()` no longer needs non-null assertions
(`config.domain!`) — TypeScript narrowing on `config.provider` types the
required fields correctly in each branch.

`loadAuthConfig()` still runtime-validates YAML/env input (untyped at the
file-system boundary) and throws with the same error messages as 0.16.x — the
failure mode is unchanged for config-file users. The DU benefits TS callers who
construct `AuthConfig` literals directly in application code (typically test
fixtures or programmatic wiring).

Migration: literals that already pass `domain` / `issuer` where needed satisfy
the DU unchanged. The break bites only when the literal was missing a required
field and relying on runtime validation (a latent bug).

**(3) [#13](https://github.com/Casys-AI/mcp-server/issues/13) — `AuthOptions`
slimmed; dead `resource` / `authorizationServers` / `scopesSupported` fields
removed.**

The pre-0.17 `AuthOptions` exposed `authorizationServers: string[]`,
`resource: string`, and `scopesSupported?: string[]` alongside
`provider: AuthProvider`. **Only `provider` was ever read by `McpApp` at
runtime** (at `mcp-app.ts:1061`, where
`this.authProvider =
this.options.auth.provider`). The three other fields were
vestigial from a pre-0.15 design where `McpApp` could auto-construct a
`JwtAuthProvider` from its own `auth:` option — that auto-construction path was
removed when `createAuthProviderFromConfig` took over YAML/env provider
construction, but the dead fields stayed in the interface.

```typescript
// Before (0.16.x) — the 3 extra fields were SILENTLY IGNORED
new McpApp({
  name: "my-server",
  version: "1.0.0",
  auth: {
    provider: myProvider,
    authorizationServers: ["https://idp.example.com"], // silently ignored
    resource: "https://my-mcp.example.com", // silently ignored
  },
});

// After (0.17.0)
new McpApp({
  name: "my-server",
  version: "1.0.0",
  auth: {
    provider: myProvider,
  },
});
```

Callers who passed the vestigial fields now get a TS error
(`Object literal may only specify known properties`). The fix is to remove them
— they had no effect before, they have no effect now, the type system is just
honest about it.

### Added

**(4) [#14](https://github.com/Casys-AI/mcp-server/issues/14) —
`buildJwtAuthProvider` exported as public API** _(non-breaking addition)_.

The bridge helper previously named `buildJwtProvider` (private in `presets.ts`)
is now exported from `mod.ts` as `buildJwtAuthProvider`, alongside its
`BuildJwtAuthProviderOptions` interface. 3rd-party OIDC provider implementations
(Keycloak, Zitadel custom, Okta, …) can now build factory functions that
delegate URL-vs-opaque detection, `HttpsUrl` validation, and `kind`-tag
selection to the shared bridge instead of reimplementing it:

```typescript
import { buildJwtAuthProvider, type JwtAuthProvider } from "@casys/mcp-server";

export function createKeycloakAuthProvider(
  options: KeycloakPresetOptions,
): JwtAuthProvider {
  const issuer = `https://${options.keycloakHost}/realms/${options.realm}`;
  return buildJwtAuthProvider(
    {
      issuer,
      audience: options.audience,
      authorizationServers: [issuer],
      jwksUri: `${issuer}/protocol/openid-connect/certs`,
      resource: options.resource,
      resourceMetadataUrl: options.resourceMetadataUrl,
    },
    "createKeycloakAuthProvider",
  );
}
```

The `label` second argument is optional (defaults to `"buildJwtAuthProvider"`)
and threads through to error messages for preset-level diagnostics.

### Changed

- **`JwtAuthProvider` constructor narrows on the `kind` tag.** The 0.16.0
  comment documenting the narrowing's unsoundness is replaced with an honest
  comment explaining the now-sound behavior. The RFC 9728 § 3.1 derivation logic
  is unchanged.

- **`loadAuthConfig()` constructs DU variants explicitly.** Instead of building
  a flat object with `domain?` / `issuer?` fields, it switches on the provider
  and returns the correctly-shaped variant. Runtime checks for `domain` /
  `issuer` stay — the YAML/env boundary is untyped.

- **`createAuthProviderFromConfig()` drops non-null assertions.** The DU
  narrowing on `config.provider` makes `config.domain` / `config.issuer` typed
  as required in their respective branches.

- **Preset bridge sets the `kind` tag explicitly.** `buildJwtAuthProvider` (née
  `buildJwtProvider`) passes `kind: "url"` or `kind: "opaque"` to the
  `JwtAuthProvider` constructor based on the detected case. Preset callers never
  see the tag — it's encapsulated in the bridge.

### Removed

- **`AuthOptions.resource`, `AuthOptions.authorizationServers`,
  `AuthOptions.scopesSupported`.** Vestigial from pre-0.15 auto-construction
  path — never read by `McpApp`. See BREAKING (3) above for migration.

- **Non-null assertions in `createAuthProviderFromConfig`.** Were
  `config.domain!` / `config.issuer!`, now typed as required by the DU.

## [0.16.1] - 2026-04-11

### Added

- **`McpApp.name` public readonly field.** The server name (identifier reported
  to MCP clients in `InitializeResult.serverInfo.name`) is now exposed as
  `app.name` on every `McpApp` instance. Previously it was only stored in
  `this.options.name` (private), forcing consumers to either reach into the
  private field, keep a separate reference, or re-construct the value from their
  own config. The compose integration test stubs
  (`packages/compose/stubs/shared.ts`) had been doing `server.name` in a log
  prefix since inception — a latent type error that was never caught because
  `deno task check` on `packages/compose` only type-checked `mod.ts`, not the
  stubs. 0.16.1 fixes the underlying type gap by making the field a first-class
  part of the public API.

  This completes the `ConcurrentMCPServer` → `McpApp` hard rename started in
  `b155f7c` (source class) and `def49b2` (tests + stubs) — the final piece was
  exposing what the old consumers implicitly expected.

### Changed

- **`packages/compose` `check` task now type-checks the stubs.** Previously
  `"check": "deno check mod.ts"` covered only the public API surface. The new
  task also type-checks `stubs/stub-*/server.ts` and `stubs/shared.ts` so drift
  like the pre-0.16.1 `server.name` silent bug is caught in CI before shipping.

## [0.16.0] - 2026-04-11

### Fixed

- **RFC 9728 § 3.1 compliance: metadata URL derivation for non-root paths.**
  When a caller's `resource` had a path or query component (e.g.,
  `"https://api.example.com/v1/mcp"`), the naive 0.15.x derivation appended
  `/.well-known/oauth-protected-resource` AFTER the full path, producing
  `"https://api.example.com/v1/mcp/.well-known/oauth-protected-resource"` — a
  404 for any client following RFC 9728 discovery. The correct output inserts
  the well-known suffix BETWEEN the host and the path:
  `"https://api.example.com/.well-known/oauth-protected-resource/v1/mcp"`. The
  bug survived 0.15.x because all existing tests exercised root-path resources
  (where both approaches produce identical output); it was caught during the
  0.16.0 code review. Query strings and deeply nested paths are now covered by 5
  new regression tests in `auth_test.ts`. Fragments are dropped per RFC 3986 §
  3.5.

### Added

- **`HttpsUrl` branded type.** New nominal type in `src/auth/types.ts`
  representing a string validated as an absolute HTTP(S) URL. Constructed
  exclusively via the new `httpsUrl(raw)` factory, which:
  1. Trims leading/trailing whitespace
  2. Parses via `new URL()` (lowercases the scheme — accepts `HTTPS://...`)
  3. Rejects non-HTTP(S) schemes (`javascript:`, `ftp:`, relative paths, …)
  4. Throws on empty / whitespace-only input
  5. Returns the normalized URL string with the brand applied

  Also exports `tryHttpsUrl(raw): HttpsUrl | null` — the non-throwing variant
  used by the preset bridge layer to distinguish URL resources from opaque URIs
  without exception handling.

- **`JwtAuthProviderOptions` discriminated union.** Replaces the flat interface
  with two branches enforcing metadata-URL presence at compile time:
  - `JwtAuthProviderOptionsUrlResource`: `resource: HttpsUrl`,
    `resourceMetadataUrl?: HttpsUrl` (optional, auto-derived).
  - `JwtAuthProviderOptionsOpaqueResource`: `resource: string` (opaque),
    `resourceMetadataUrl: HttpsUrl` (REQUIRED).

  TypeScript narrows based on which branch accepts the call-site fields. A
  caller that passes a raw string for `resource` without `resourceMetadataUrl`
  gets a compile error telling them to either wrap via `httpsUrl()` or supply
  the metadata URL explicitly.

- **`OIDCPresetOptions` type.** Preset-style interface for
  `createOIDCAuthProvider` that accepts raw `string` fields (like the other
  three presets). The bridge helper inside `presets.ts` wraps them through
  `httpsUrl()` before reaching the `JwtAuthProvider` constructor.

- **`httpsUrl()` / `tryHttpsUrl()` test coverage.** 14 new unit tests in
  `src/auth/auth_test.ts` covering the factory's validation matrix (valid HTTPS,
  valid HTTP, uppercase scheme normalization, whitespace trimming, empty /
  whitespace-only rejection, non-URL rejection, relative-path rejection,
  `javascript:` / `ftp:` scheme rejection, error message formatting,
  `tryHttpsUrl` success / opaque / empty handling).

### Changed

- **`ProtectedResourceMetadata.resource_metadata_url`** now typed as `HttpsUrl`
  (was `string`). The invariant is structurally enforced — producers construct
  the value via `httpsUrl()` instead of relying on a runtime validator in
  `JwtAuthProvider`'s constructor.

- **`ProtectedResourceMetadata.authorization_servers`** now typed as
  `HttpsUrl[]` (was `string[]`). Downstream consumers can rely on each entry
  being parseable without re-validation.

- **`AuthProvider` subclasses** must now return `HttpsUrl`-branded values from
  `getResourceMetadata()`. Construct via `httpsUrl()` or import the brand type
  from `@casys/mcp-server`.

- **`JwtAuthProvider` constructor simplified.** All URL validation has been
  lifted to the `httpsUrl()` factory call sites. The constructor no longer
  performs runtime URL parsing, whitespace trimming, or scheme checking — the
  type system guarantees that any field requiring those properties is already
  validated. The 0.15.1 `validateAbsoluteHttpUrl` helper has been removed (dead
  code).

- **Preset factories bridge raw strings → branded DU.** Each preset
  (`createGitHubAuthProvider`, `createGoogleAuthProvider`,
  `createAuth0AuthProvider`, `createOIDCAuthProvider`) centralizes
  raw-to-branded translation through a private `buildJwtProvider` helper that
  handles the URL-vs-opaque resource detection, auth server validation, and
  empty-metadata-URL fall-through in one place.

- **`authorization_servers` values are now normalized.** `httpsUrl()` delegates
  parsing to `new URL().toString()`, which appends a trailing slash to host-only
  URLs (`"https://foo.com"` → `"https://foo.com/"`). Tests comparing these
  values as raw strings must adjust their expectations.

### Removed

- **`JwtAuthProvider`'s private `validateAbsoluteHttpUrl` helper.** The logic
  has been moved to the public `httpsUrl()` factory in `types.ts`, where it
  belongs on the brand constructor instead of a runtime guard.

- **0.15.1 runtime validation tests for constructor-level URL checks.** These
  tests (empty-string `resourceMetadataUrl`, whitespace-only, invalid URL,
  non-HTTP(S) scheme, trailing whitespace in `resource`, uppercase scheme) have
  been re-homed:
  - Factory-level validation → `httpsUrl()` tests in `auth_test.ts`
  - Fall-through behavior (YAML empty key) → preset bridge tests in
    `auth_test.ts`

### BREAKING

This is a **minor version bump with breaking changes** — semver-permitted before
1.0, but migration is required.

1. **Direct `new JwtAuthProvider(...)` callers must wrap URL fields.** Every
   `resource`, `authorizationServers[i]`, and `resourceMetadataUrl` that was a
   raw string in 0.15.x must now be wrapped in `httpsUrl()`:

   ```typescript
   // Before (0.15.x)
   new JwtAuthProvider({
     issuer: "https://idp.example.com",
     audience: "https://api.example.com",
     resource: "https://api.example.com",
     authorizationServers: ["https://idp.example.com"],
   });

   // After (0.16.0)
   import { httpsUrl, JwtAuthProvider } from "@casys/mcp-server";
   new JwtAuthProvider({
     issuer: "https://idp.example.com",
     audience: "https://api.example.com",
     resource: httpsUrl("https://api.example.com"),
     authorizationServers: [httpsUrl("https://idp.example.com")],
   });
   ```

2. **`createOIDCAuthProvider` signature changed.** Previously accepted
   `JwtAuthProviderOptions` directly; now accepts the new `OIDCPresetOptions`
   with raw `string` fields. Migration: drop any `httpsUrl()` wrappers — the
   preset handles it internally.

   ```typescript
   // Before (0.15.x) — JwtAuthProviderOptions direct
   createOIDCAuthProvider({
     issuer: "https://idp.example.com",
     audience: "https://api.example.com",
     resource: "https://api.example.com",
     authorizationServers: ["https://idp.example.com"],
   });

   // After (0.16.0) — same call-site, still works with raw strings
   createOIDCAuthProvider({
     issuer: "https://idp.example.com",
     audience: "https://api.example.com",
     resource: "https://api.example.com",
     // authorizationServers optional, defaults to [issuer]
   });
   ```

3. **Custom `AuthProvider` subclasses must return `HttpsUrl`-branded values**
   from `getResourceMetadata()`. Previously `string` / `string[]`:

   ```typescript
   // Before (0.15.x)
   getResourceMetadata(): ProtectedResourceMetadata {
     return {
       resource: "https://foo.com",
       resource_metadata_url: "https://foo.com/.well-known/oauth-protected-resource",
       authorization_servers: ["https://idp.example.com"],
       bearer_methods_supported: ["header"],
     };
   }

   // After (0.16.0)
   getResourceMetadata(): ProtectedResourceMetadata {
     return {
       resource: "https://foo.com",  // stays string — RFC 9728 § 2 allows opaque
       resource_metadata_url: httpsUrl(
         "https://foo.com/.well-known/oauth-protected-resource",
       ),
       authorization_servers: [httpsUrl("https://idp.example.com")],
       bearer_methods_supported: ["header"],
     };
   }
   ```

4. **`ProtectedResourceMetadata.authorization_servers` values now include
   trailing slashes** for host-only URLs due to `new URL().toString()`
   normalization. Downstream code comparing these values as raw strings must
   adjust: `"https://foo.com"` becomes `"https://foo.com/"`. The JSON payload
   served at `/.well-known/oauth-protected-resource` contains the normalized
   form — OIDC clients that trim trailing slashes are unaffected, but strict
   string matchers should update.

### Migration path

Most callers go through `createAuthProviderFromConfig()` or one of the presets
(`createGitHubAuthProvider`, `createGoogleAuthProvider`,
`createAuth0AuthProvider`, `createOIDCAuthProvider`) and will not need any
changes — the preset bridge layer accepts raw strings and wraps them internally.
Only direct `new JwtAuthProvider(...)` callers and custom `AuthProvider`
subclasses need the updates above.

### Why

0.14.x had a class of bugs where `WWW-Authenticate` headers could be produced
with `"://host/.well-known/..."` when the caller mis-set `resource`. 0.15.0
closed it with a required `resource_metadata_url` field on the metadata type.
0.15.1 added runtime validation in the `JwtAuthProvider` constructor. 0.16.0
lifts the invariant to the type layer: raw strings for URL fields are now a
compile error, and the runtime validator is removed as dead code. The bug is
closed three times: structurally (type), behaviorally (runtime at factory), and
by the 14 new `httpsUrl()` unit tests covering every validation path.

## [0.15.1] - 2026-04-11

### Fixed

- **`JwtAuthProvider` constructor now runtime-validates `resourceMetadataUrl`**
  — both the explicit-value branch and the auto-derive-from-`resource` branch
  call `new URL()` on the resulting string and reject non-HTTP(S) schemes with a
  clear error message. Previously the constructor stored the value verbatim and
  trusted the type system; a caller passing `"not a url"`, a relative path, a
  `javascript:` scheme, or a value with trailing whitespace would silently
  produce a broken `WWW-Authenticate` header at runtime — the exact class of bug
  that 0.15.0 was meant to eliminate, just transferred to the constructor layer.
  0.15.1 closes that hole with a `validateAbsoluteHttpUrl` helper.

- **Empty-string and whitespace-only `resourceMetadataUrl` are now treated as
  absent.** Previously `if (options.resourceMetadataUrl)` accepted `""` as falsy
  and silently fell through to derivation. Now the code trims the value and
  checks for non-empty explicitly — a YAML key with no value or an env var
  expanded to empty gets the same behavior as omitting the key entirely (instead
  of producing `"://host"`).

- **Trailing whitespace in `resource` is now trimmed before derivation.**
  Previously `"https://foo.com   "` produced
  `"https://foo.com   /.well-known/oauth-protected-resource"` — unparseable.
  0.15.1 trims before the path append AND runs the result through
  `validateAbsoluteHttpUrl` as a belt-and-suspenders check.

- **`resource` URL detection is now case-insensitive.** `"HTTPS://foo.com"` is a
  valid URL per RFC 3986 (scheme comparison is case-insensitive) and 0.15.1
  accepts it, normalizing to lowercase via `new URL().toString()`. Previously
  the `/^https?:\/\//` regex was case-sensitive and would have thrown on
  uppercase schemes as if they were opaque URIs.

- **`clearAuthEnv()` test helper now clears `MCP_AUTH_RESOURCE_METADATA_URL`.**
  The helper was written for 0.14.0 and the 0.15.0 commit added a read of the
  new env var in `config.ts:loadEnvAuth` but forgot to mirror that in the
  cleanup. A test that sets the env var leaked its value to subsequent tests in
  the same process — intermittent green/red flips waiting to happen. Fix:
  one-line addition to the helper.

### Changed

- **Error message on invalid `resource` now `JSON.stringify`s the value.**
  Previously the error template embedded `${options.resource}` raw; a value
  containing quotes, newlines, or other specials could break error log parsing.
  Now the value is unambiguously inspectable even when weird.

### Migration

No migration needed. Backward compatible with 0.15.0 — all existing valid
configurations keep working. The changes only make previously-silent-wrong
configurations fail loudly at construction. If your tests set
`MCP_AUTH_RESOURCE_METADATA_URL` you may want to mirror the `clearAuthEnv()`
update in your own test helpers.

## [0.15.0] - 2026-04-11

### BREAKING

- **`ProtectedResourceMetadata.resource_metadata_url` is now required**
  (previously the field did not exist and the middleware derived the metadata
  URL from `resource`, which produced a broken URL when `resource` was not
  itself an HTTP(S) URL — e.g., when using an opaque OIDC project ID as JWT
  audience per RFC 9728 § 2).

### Fixed

- **`WWW-Authenticate` header now always contains a valid absolute HTTP(S) URL**
  in the `resource_metadata="..."` parameter. Previously, if a custom
  `AuthProvider` returned a non-URL `resource` (for example, an opaque OAuth2
  resource URI or an OIDC project ID used as audience — both valid per RFC 9728
  § 2), the middleware would compute
  `${resource}/.well-known/oauth-protected-resource` and produce something like
  `"367545125829670172/.well-known/oauth-protected-resource"` — not a valid URL,
  causing RFC 9728 § 5 compliant clients (Claude.ai / ChatGPT) to fail OAuth
  discovery.

  The fix makes `resource_metadata_url` a first-class required field on
  `ProtectedResourceMetadata`, always set by the provider, and used directly by
  the middleware. Derivation from `resource` is no longer attempted.

### Changed

- `JwtAuthProviderOptions` accepts a new optional
  `resourceMetadataUrl?: string`.
  - When the option is set, it is used as-is.
  - When omitted AND `resource` is an HTTP(S) URL, the factory auto-derives
    `${resource}/.well-known/oauth-protected-resource` and stores it (existing
    URL-resource callers get a no-op migration — no code change needed on their
    side).
  - When omitted AND `resource` is not an HTTP(S) URL, `JwtAuthProvider` throws
    at construction with a clear error message pointing to RFC 9728 and
    suggesting the fix.

### Migration

- **If your `resource` is an HTTP(S) URL**: no change needed. The factory
  auto-derives the metadata URL and stores it. `getResourceMetadata()` now
  returns a `resource_metadata_url` field, but you don't need to provide one.
- **If your `resource` is an opaque URI** (e.g., OIDC project ID): add
  `resourceMetadataUrl` to the `createOIDCAuthProvider` / `JwtAuthProvider`
  options, pointing to the HTTPS URL where your
  `/.well-known/oauth-protected-resource` endpoint is served publicly.
- **If you have a custom `AuthProvider` subclass**: the
  `ProtectedResourceMetadata` returned by `getResourceMetadata()` must include
  `resource_metadata_url`. TypeScript will catch missing values at compile time.
- **If you configure `@casys/mcp-server` via YAML or environment variables AND
  your `resource` is an opaque URI** (not an HTTP(S) URL): set
  `auth.resourceMetadataUrl` in YAML or the env var
  `MCP_AUTH_RESOURCE_METADATA_URL` to the public HTTPS URL of your
  `/.well-known/oauth-protected-resource` endpoint. Previously this case would
  fail at startup with a `JwtAuthProvider` error and no recovery path — the
  config layer silently dropped any override attempt because the field was not
  plumbed through `AuthConfig` / `loadYamlAuth` / `loadEnvAuth` /
  `createAuthProviderFromConfig`. Now wired end-to-end.

## [0.14.0] - 2026-04-08

### Added

- **MCP Apps capability negotiation** — new helpers and constants to read the
  MCP Apps extension capability advertised by clients (per the
  `@modelcontextprotocol/ext-apps` spec dated 2026-01-26 and the SDK 1.29
  `extensions` field on `ClientCapabilities`).
  - `MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui"` — well-known
    extension key.
  - `MCP_APPS_PROTOCOL_VERSION = "2026-01-26"` — dated spec this package
    targets. Bump in lockstep when adopting newer dated specs.
  - `getMcpAppsCapability(clientCapabilities)` — best-effort, defensive reader.
    Returns `McpAppsClientCapability | undefined`. Tolerates `null`/`undefined`
    input, missing `extensions` field, malformed extension values, and silently
    filters non-string `mimeTypes` entries.
  - `McpApp.getClientMcpAppsCapability()` — instance method that wires the above
    against the connected client. Use it from a tool handler to decide between
    returning a `_meta.ui` resource or a text-only fallback.
  - `McpAppsClientCapability` interface (currently `{ mimeTypes?: string[] }`,
    extensible to match future spec additions).
  - 13 boundary tests in `mcp-apps-capability_test.ts` cover happy paths,
    null/undefined inputs, missing extensions, non-object extension values,
    malformed `mimeTypes`, and determinism.

### Changed

- **Bumped `@modelcontextprotocol/sdk` from `^1.27.0` → `^1.29.0`** in both
  `packages/server` and `packages/compose`. SDK 1.28 brought
  `scopes_supported`-from-resource-metadata default behavior and
  `client_secret_basic` defaulting — both verified harmless against our
  `JwtAuthProvider` (we already emit `scopes_supported` server-side) and
  `client-auth/provider.ts` (we already override `token_endpoint_auth_method` to
  `"none"` for our public PKCE client). SDK 1.29 brings the
  `extensions`-on-`ClientCapabilities` feature that powers MCP Apps capability
  negotiation, plus an npm audit fix and several minor schema fixes (`size` on
  `ResourceSchema`, missing types exports, Windows stdio hide, infinite-TTL
  guard).

### Fixed

- **`scripts/build-node.sh` SDK version drift** — the generated
  `dist-node/package.json` for npm consumers hardcoded
  `@modelcontextprotocol/sdk: ^1.15.1`, far behind the `^1.29.0` used at build
  time. The script now reads the version from `deno.json` (single source of
  truth) and fails fast with a clear error if parsing fails. This was a latent
  bug since the package's first npm release — npm consumers may have been
  resolving an SDK floor too old to support features the code uses.

## [0.13.0] - 2026-04-08

### Added

- **`createMultiTenantMiddleware()`** — tenant resolution middleware sitting
  after the auth middleware. Delegates tenant identification to a user-provided
  `TenantResolver`, injects the resolved `tenantId` into `ctx.authInfo`, and
  rejects mismatches with a generic `invalid_token` error. Passthrough on STDIO;
  fails fast with a config error if `ctx.authInfo` is missing on HTTP. Existing
  single-tenant servers require no changes.
- **`AuthInfo.tenantId`** — new optional field populated by the multi-tenant
  middleware. Tool handlers should read this instead of raw JWT claims.
  `authInfo` is re-frozen after injection.
- **`MultiTenantMiddlewareOptions.onRejection`** — async audit hook awaited
  before the 401 is thrown. Rejection reasons are server-side only; the client
  always sees a generic `invalid_token` error. Hook exceptions are caught and
  logged to stderr — they can never change client-visible behaviour or become an
  oracle for attackers.
- **Empty-`tenantId` guard** — `{ ok: true, tenantId: "" }` is rejected as if it
  were a resolver failure, preventing truthy-guard bypasses in downstream
  handlers.
- **`McpApp.getFetchHandler()`** — returns a Web Standard fetch handler without
  binding a port. Use this to mount the MCP HTTP layer inside another framework
  (Fresh, Hono, Express, Cloudflare Workers, etc.) without giving up port
  ownership to `startHttp`. Auth, multi-tenant middleware, scope checks, rate
  limiting, sessions, and SSE all run identically. Designed for the multi-tenant
  SaaS pattern of caching one server-per-tenant and dispatching from the host
  framework's routing layer.
- **`HttpServerOptions.embedded` + `embeddedHandlerCallback`** — internal
  mechanism powering `getFetchHandler`. Most consumers should use
  `getFetchHandler` directly rather than setting these.
- **`FetchHandler` type re-exported from `./types.ts`** — was already exported
  from the runtime port at top-level, now also re-exported alongside
  `HttpServerOptions` for ergonomic single-import use.
- **New types** — `TenantResolver`, `TenantResolution`,
  `MultiTenantMiddlewareOptions` exported from `mod.ts`.

### Changed

- **`ConcurrentMCPServer` → `McpApp`** — **non-breaking**. The framework's main
  class has been renamed and its source file moved from
  `src/concurrent-server.ts` to `src/mcp-app.ts` (git-tracked rename, history
  preserved). `McpApp` is now the canonical name everywhere — class body, error
  messages, JSDoc, internal modules, tests, README, and the compose stubs. The
  options type follows: `ConcurrentServerOptions → McpAppOptions`. Existing code
  keeps working unchanged thanks to the deprecated re-exports in `mod.ts` (see
  Deprecated below) —
  `import { ConcurrentMCPServer } from
  "@casys/mcp-server"` still resolves to
  the same constructor at runtime, `ConcurrentMCPServer === McpApp` is true, and
  `instanceof` checks pass in both directions. Migration is a one-line import
  swap when consumers are ready. Rationale: "Concurrent" described a trivial
  implementation detail (any HTTP server is concurrent), while `McpApp` captures
  the actual value of the lib — a middleware-first framework on top of the MCP
  SDK, mirroring the Hono idiom (`new Hono()` → `new McpApp()`). `McpServer` was
  off the table because it would collide with the SDK's own `McpServer` class
  which we wrap.

### Deprecated

- **`ConcurrentMCPServer`** — kept as a re-export of `McpApp` for backwards
  compatibility (`export { McpApp as ConcurrentMCPServer }`). Both names point
  to the exact same class at runtime, so `instanceof` checks pass in both
  directions and migration is a one-line import swap. The deprecated alias will
  be removed in **v1.0**.
- **`ConcurrentServerOptions`** — same treatment as a re-export of
  `McpAppOptions`. Will be removed in v1.0.

### Fixed

- **`setRequestHandler` callbacks now have explicit type annotations** — the
  `tools/call` and `resources/read` handlers in `McpApp` (formerly
  `ConcurrentMCPServer`) relied on TypeScript inference for their `request`
  parameter. The MCP SDK exports the Zod-inferred types (`CallToolRequest`,
  `ReadResourceRequest`) from `@modelcontextprotocol/sdk/types.js` but the
  callback sites used neither imports nor annotations. Consumers who pulled the
  package via a local-path workspace and built with strict `noImplicitAny` were
  tripping on the inference gap. Both callbacks now import and annotate the
  request types explicitly, surfacing full type info at the call site and
  catching SDK shape drift early. Runtime behaviour unchanged.

## [0.12.0] - 2026-03-22

### Added

- **`structuredContent` support** — tool handlers can return
  `{ content: "summary", structuredContent: { ...data } }` to separate LLM
  context (text summary) from viewer payload (structured data). Reduces LLM
  token usage for data-heavy tools.
- **`outputSchema` on tools** — optional JSON Schema for tool output, passed
  through in `tools/list`. Enables host-side validation of tool results.
- **`annotations` on tools** — behavioural hints (`title`, `readOnlyHint`,
  `destructiveHint`, `idempotentHint`, `openWorldHint`) passed through in
  `tools/list`.
- **Tool visibility filtering** — tools with `_meta.ui.visibility: ["app"]` are
  excluded from `tools/list` (hidden from LLM) but remain callable via
  `tools/call`. Cleans up LLM tool list from UI-only actions (refresh,
  pagination, etc.).
- **`registerAppOnlyTool()` helper** — shortcut to register app-only tools with
  `visibility: ["app"]` auto-injected.
- **`toolErrorMapper` option** — centralized error-to-`isError` mapping.
  Business errors produce `{ isError: true }` results; system errors rethrow as
  JSON-RPC errors. Configurable via `ConcurrentServerOptions.toolErrorMapper`.
- **New types** — `ToolAnnotations`, `StructuredToolResult`, `ToolErrorMapper`
  exported from `mod.ts`.

### Changed

- **`tools/list` refactored** — both STDIO and HTTP paths now use shared
  `buildToolListing()` method (deduplication).
- **`tools/call` refactored** — both STDIO and HTTP paths now use shared
  `buildToolCallResult()` and `handleToolError()` methods. Serialization errors
  are no longer routed through `toolErrorMapper`.

## [0.11.0] - 2026-03-20

### Added

- **`registerViewers()` CSP option** — `csp` field on `RegisterViewersConfig`
  declares external domains the viewer needs (tiles, APIs, CDNs). Injects
  `_meta.ui.csp` into resource content.
- **Re-export compose SDK helpers** — `composeEvents`, `uiMeta`, and related
  types re-exported from `mod.ts` via `@casys/mcp-compose`.

### Changed

- **Bump `@casys/mcp-compose` ^0.2.0 → ^0.3.0**.

## [0.10.0] - 2026-03-20

### Changed

- **Bump MCP SDK ^1.15 → ^1.27** — unlocks `structuredContent`, `outputSchema`,
  `annotations`, `isError` at the protocol level.
- **Bump `@casys/mcp-compose` → ^0.2.0** — adds sub-path exports (`/sdk`,
  `/core`).
- **`McpUiToolMeta` imported from mcp-compose** — replaced inlined base type
  with `import type { McpUiToolMeta } from "@casys/mcp-compose/core"`. No API
  change.

## [0.9.2] - 2026-03-17

### Added

- **MCP Inspector launcher** — `launchInspector()` starts an interactive MCP
  Inspector session for debugging. Exported from `mod.ts` with
  `InspectorOptions` type.

## [0.9.1] - 2026-03-17

### Changed

- **Import `McpUiToolMetaBase` from `@casys/mcp-compose/core`** — replaced
  inlined visibility/resourceUri type with proper dependency import.

## [0.9.0] - 2026-03-17

### Added

- **Client-side OAuth2 flow** — `CallbackServer` (localhost redirect capture),
  `OAuthClientProviderImpl`, `connect()` helper for MCP client auth. Token
  stores: `FileTokenStore` (persistent, 0o600 permissions) and
  `MemoryTokenStore` (ephemeral).
- **MCP Apps viewer utilities** — `resolveViewerDistPath()` and
  `discoverViewers()` for auto-discovering built UI viewers. `registerViewers()`
  method on `ConcurrentMCPServer` for bulk resource registration.
- **New exports** — `RegisterViewersConfig`, `RegisterViewersSummary`,
  `resolveViewerDistPath`, `discoverViewers` from `mod.ts`.

## [0.8.0] - 2026-02-12

### Added

- **Security: HMAC-SHA256 channel authentication for PostMessage (MCP Apps)** —
  `MessageSigner` class for signing/verifying JSON-RPC messages with `_hmac` +
  `_seq` (anti-replay). `injectChannelAuth()` injects an inline script into
  iframe HTML that signs outgoing postMessages. Host-side verification via
  `MessageSigner.verify()`.
- **Security: HTTP hardening options** — `maxBodyBytes` (default 1 MB, returns
  413 JSON-RPC error), `corsOrigins` allowlist with wildcard warning,
  `requireAuth` fail-fast at startup, `ipRateLimit` per-IP 429 + `Retry-After`
  header, `sessionId` propagation into middleware context.
- **Security: CSP injection** — `buildCspHeader()` and `injectCspMetaTag()` for
  Content-Security-Policy in MCP Apps HTML resources. Configurable via
  `resourceCsp` in `ConcurrentServerOptions`.
- **Security: CORS wildcard warning** — logs `[WARN]` when `corsOrigins` is
  `"*"` regardless of auth configuration.
- **Node.js runtime adapter** — `runtime.node.ts` implements the `RuntimePort`
  contract for Node.js 18+ with `maxBodyBytes` enforcement at both
  `Content-Length` and streaming body levels.
- **Observability: `recordAuthEvent()` wired** — auth tracing spans now fire on
  token verify, reject, and JWT cache hit (gated by `isOtelEnabled()`).
- **`HttpServerInstance` return type** — `startHttp()` now returns
  `{ shutdown(), addr }` for programmatic control.

### Changed

- **File reorganization** — moved files into domain subfolders: `src/runtime/`,
  `src/concurrency/`, `src/validation/`, `src/sampling/`. All re-exports from
  `mod.ts` are unchanged.
- **API cleanup** — removed internal types from public barrel
  (`PromiseResolver`, `QueueOptions`, `MCP_APP_URI_SCHEME`).
- **Lint cleanup** — zero `deno lint` errors, zero `deno fmt` issues, no slow
  types.

## [0.7.0] - 2026-02-07

### Added

- **Observability: OTel tracing** — every tool call emits an OpenTelemetry span
  (`mcp.tool.call {name}`) with attributes (tool name, server name, transport,
  session ID, duration, success/error). Requires `OTEL_DENO=true` +
  `--unstable-otel`.
- **Observability: Prometheus `/metrics` endpoint** — exposes counters (tool
  calls, auth, sessions, rate limiting), histogram (tool call latency), and
  gauges (active requests, queued, sessions, SSE clients, uptime) in Prometheus
  text format.
- **Observability: `ServerMetrics` class** — embeddable metrics collector with
  per-tool breakdown, `getSnapshot()`, `toPrometheusFormat()`, and `reset()`.
- **Observability: `getServerMetrics()` / `getPrometheusMetrics()`** — public
  methods on `ConcurrentMCPServer` for programmatic access.
- **Observability: auth event tracing** — `recordAuthEvent()` helper for
  fire-and-forget auth spans.
- **Security: per-IP rate limiting on `initialize`** — 10 requests/min per IP to
  prevent session exhaustion attacks (DoS).
- **Reliability: session cleanup grace period** — 60s grace period added to
  session TTL so in-flight requests are not killed mid-execution.
- **Reliability: `RateLimiter.purgeExpiredKeys()`** — periodic cleanup of stale
  keys to prevent unbounded memory growth. Auto-triggers every 1000 operations.

### Fixed

- **Critical: RateLimiter memory leak** — keys with no active requests were
  never removed from the internal Map, causing unbounded growth in long-running
  servers with per-IP rate limiting.
- **Critical: SSE zombie clients** — failed `controller.enqueue()` calls were
  silently caught without removing the dead client from the Map, causing memory
  leaks and wasted CPU on every `sendToSession()`.
- **High: JWT token cache** — added SHA-256 token cache (max 1000 entries, TTL =
  min(token expiry, 5min)) to avoid redundant JWKS network round-trips on every
  tool call.

## [0.6.0] - 2026-02-06

### Added

- **OAuth2/Bearer authentication** — `JwtAuthProvider` with JWKS validation, 4
  presets (Google, Auth0, GitHub, OIDC).
- **YAML + env config** — `loadAuthConfig()` reads `mcp-server.yaml` +
  `MCP_AUTH_*` env vars with priority: programmatic > env > YAML.
- **Middleware pipeline** — composable onion-model pipeline: rate-limit → auth →
  custom → scope-check → validation → backpressure → handler.
- **Scope enforcement** — `requiredScopes` on tools with AND-based checking.
- **RFC 9728** — `/.well-known/oauth-protected-resource` metadata endpoint.
- **HTTP/SSE transport** — `startHttp()` with Streamable HTTP, session
  management, SSE streaming.
- **MCP Apps** — `ui://` scheme, `MCP_APP_MIME_TYPE`, `registerResource()`.

## [0.5.0] - 2026-01-28

### Added

- Initial release: `ConcurrentMCPServer`, `RequestQueue`, `RateLimiter`,
  `SchemaValidator`, `SamplingBridge`.
- STDIO transport with backpressure strategies (sleep/queue/reject).
- Schema validation with ajv.
