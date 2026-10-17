# Design Spec — CIMD Client Support (`@mcpview/server`)

|             |                                                                            |
| ----------- | -------------------------------------------------------------------------- |
| **Date**    | 2026-06-29                                                                 |
| **Status**  | Draft (design approved, pending spec review)                               |
| **Scope**   | `packages/server/src/client-auth/` — client side only                      |
| **Authors** | Claude (orchestration) + Codex (independent architecture review, 2 rounds) |
| **Related** | `docs/migration/2026-07-28.md` (Track E), SEP-991, IETF CIMD draft         |

## 1. Context & Problem

**CIMD (Client ID Metadata Documents, SEP-991)** became the _preferred default_
(`SHOULD`) for OAuth client registration in the MCP spec update of **November
2025** (`2025-11-25`, the currently supported stable). Dynamic Client
Registration (DCR, RFC 7591) was demoted to `MAY`. With CIMD, the `client_id` is
an **HTTPS URL** pointing to a JSON metadata document hosted by the client; the
Authorization Server fetches and validates that URL during the flow. No
pre-registration, app-level identity, smaller phishing surface than DCR.

### The AS/RS constraint (the design's central fact)

`@mcpview/server` is a **Resource Server**: it serves protected-resource
metadata (`mcp-app.ts:1180`) and validates `iss`/`aud` on JWTs
(`jwt-provider.ts`). It does **not** control `/authorize`, `/token`, or the
validation of a `client_id`-URL — that belongs to the Authorization Server (the
IdP: Zitadel, Auth0…).

Consequence: "supporting CIMD on the server side" (advertising it via
`as-metadata-proxy.ts`) is largely illusory — advertising
`client_id_metadata_document_supported: true` would be **misleading** if the
upstream IdP cannot process a `client_id`-URL, sending clients into an OAuth
dead-end _after_ the user redirect. The only place `@casys` controls end-to-end
is the **client** path (`client-auth/`), which today uses a static `clientId`
string (`provider.ts:52`, `types.ts:40`).

This spec therefore covers **client-side CIMD only**.

## 2. Decisions (validated framing)

| Decision                     | Choice                                                      | Rationale                                                                                                    |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Scope                        | **Client side only** (`client-auth/`)                       | Only path `@casys` controls end-to-end; testable without an IdP                                              |
| Activation                   | **Opt-in, explicit**                                        | Never silently change an existing client's OAuth identity; AX explicit-over-implicit                         |
| Approach                     | **A1 — config branch + builder + validations**              | Narrow contract; a bare builder is too easy to misuse (`localhost:0`, forgotten fixed port)                  |
| Loopback redirect            | **Fixed explicit port**, `http://127.0.0.1:<port>/callback` | CIMD interop on RFC 8252 variable-port matching is not solid enough to bet v1 on                             |
| DCR / `as-metadata-proxy.ts` | **Kept, repositioned "legacy/compat"**                      | DCR is `MAY`, not forbidden; IdPs are heterogeneous; removing it is an interop regression                    |
| Out of scope v1              | Hosting handler (A2), auto-negotiation (A3)                 | A2 useless for CLI clients (doc must be public HTTPS); A3 weakens opt-in and mixes too many responsibilities |

## 3. Current Architecture (what exists)

- `OAuthClientConfig` (`types.ts:38-53`): `clientId: string` (required),
  `clientName?`, `scopes?`, `tokenStore`, `openBrowser`, `callbackPort?`
  (default `0`), `authTimeout?`.
- `OAuthClientProviderImpl` (`provider.ts`):
  - `clientMetadata` getter (`:40-48`) builds an `OAuthClientMetadata`:
    `client_name` (default `"PML Client"`),
    `redirect_uris:
    [String(this.redirectUrl)]`, `grant_types`,
    `response_types`, `token_endpoint_auth_method: "none"`. **This is the direct
    skeleton of a CIMD document** — it only lacks `client_id`.
  - `clientInformation()` (`:50-54`) returns
    `{ client_id: this.config.clientId }`. **This is where `client_id` lives**,
    not in `clientMetadata`.
  - `redirectUrl` getter (`:31-33`) defaults to `http://localhost:0/callback`;
    `setRedirectUrl()` (`:36`) is called after the `CallbackServer` binds.
- `CallbackServer` (`callback-server.ts:11-13`) **already accepts a fixed port**
  (`CallbackServerOptions.port`, default `0`). The fixed-port requirement is a
  _config_ concern, not a refactor.
- `connect.ts` wires provider + callback server; returns the real bound port.

## 4. API Design

### 4.1 Config — discriminated union on `OAuthClientConfig`

Follows the repo's existing "kind-tagged DU" convention (cf. `jwt-provider`
0.17.0). Absence of `clientRegistration` ⇒ today's static behavior (backwards
compatible).

```ts
// Shared base (unchanged fields)
interface OAuthClientConfigBase {
  clientName?: string; // required in CIMD mode (see invariants)
  scopes?: string[];
  tokenStore: TokenStore;
  openBrowser: (url: string) => Promise<void>;
  callbackPort?: number; // must be fixed (≠ 0) in CIMD mode
  authTimeout?: number;
}

// Variant A — static client_id (current behavior, default)
interface StaticClientConfig extends OAuthClientConfigBase {
  clientId: string;
  clientRegistration?: undefined;
}

// Variant B — CIMD (opt-in)
interface CimdClientConfig extends OAuthClientConfigBase {
  clientId?: never; // derived from the URL, never duplicated
  clientRegistration: {
    method: "client_id_metadata";
    clientIdMetadataUrl: string; // HTTPS URL; also the client_id, exact
    redirectUri: string; // http://127.0.0.1:<port>/callback
    metadata?: { // optional display/extra fields
      client_uri?: string;
      logo_uri?: string;
      contacts?: string[];
      extra?: Record<string, unknown>;
    };
  };
}

export type OAuthClientConfig = StaticClientConfig | CimdClientConfig;
```

In CIMD mode: `client_id` is **derived** from `clientIdMetadataUrl` (not a
separate field). `clientInformation()` returns
`{ client_id: clientIdMetadataUrl }`.

### 4.2 Builder — `buildClientIdMetadataDocument()`

Pure function (deterministic, no I/O) that produces the spec-correct JSON the
consumer hosts at `clientIdMetadataUrl`. Reuses the `clientMetadata` logic.

```ts
export function buildClientIdMetadataDocument(
  config: CimdClientConfig,
): ClientIdMetadataDocument;
```

Output shape:

```jsonc
{
  "client_id": "https://example.com/oauth/client.json", // === clientIdMetadataUrl, exact
  "client_name": "My CLI", // required
  "redirect_uris": ["http://127.0.0.1:38987/callback"],
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "openid profile", // from scopes, if any
  "client_uri": "...",
  "logo_uri": "...",
  "contacts": ["..."] // from metadata, if any
}
```

The document and the runtime provider MUST produce **identical** `client_id` and
`redirect_uris`. The builder is the single source of truth; the runtime provider
reads from the same resolved config.

## 5. Invariants (fast-fail at construction)

Validated when the provider/config is built — before any network operation (AX:
fast-fail early). Each emits a structured error (`code` + `context` +
`recovery`).

1. **Exactly one mode**: `clientId` XOR `clientRegistration`. Both ⇒ fail.
   Neither ⇒ fail.
2. **HTTPS URL**: `clientIdMetadataUrl` must be a valid absolute `https://` URL.
3. **URL exactness**: `clientIdMetadataUrl` is treated as a stable identity — no
   trailing-slash normalization, no query/fragment rewrite. `client_id` in the
   document MUST equal it byte-for-byte (CIMD requires exact match).
4. **Fixed port**: in CIMD mode `callbackPort` must be set and `≠ 0`. A `:0`
   redirect URI is rejected.
5. **Redirect coherence**: `redirectUri` host should be `127.0.0.1` (preferred
   over `localhost` — RFC 8252 speaks of IP literals); its port MUST equal
   `callbackPort`; and it MUST equal the `redirect_uris` entry the runtime will
   actually use. Mismatch ⇒ fail.
6. **`client_name` required** in CIMD mode (it is the user-facing identity; the
   generic `"PML Client"` default is a bad default here).
7. **Reserved metadata keys rejected**: `metadata.extra` MUST NOT contain
   `scope`, `client_id`, `client_name`, `client_uri`, `logo_uri`, `contacts`,
   `redirect_uris`, `grant_types`, `response_types`, or
   `token_endpoint_auth_method`. These fields are derived from first-class
   config and must not be shadowed.

## 6. Flow (end-to-end, CIMD mode)

1. Consumer hosts the JSON from `buildClientIdMetadataDocument()` at
   `clientIdMetadataUrl` (public HTTPS — static file or their own route).
2. Consumer builds `OAuthClientConfig` in CIMD mode + starts `CallbackServer` on
   the fixed `callbackPort`, bound to **loopback only** (see §8).
3. Provider advertises `client_id = clientIdMetadataUrl` via
   `clientInformation()`.
4. MCP server's AS fetches `clientIdMetadataUrl`, validates the document,
   matches `redirect_uris`.
5. PKCE authorization-code flow proceeds as today; tokens stored via
   `TokenStore`.

## 7. Error Handling

Machine-readable errors (`code`/`context`/`recovery`), consistent with the
existing auth error style. Examples:

| Code                         | When                                                                                     | Recovery                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `cimd_config_conflict`       | both `clientId` and `clientRegistration`                                                 | choose one mode                                            |
| `cimd_registration_missing`  | neither `clientId` nor `clientRegistration` is present where CIMD validation is required | provide `clientRegistration.method = "client_id_metadata"` |
| `cimd_method_invalid`        | `clientRegistration.method` is not `"client_id_metadata"`                                | set the explicit CIMD method                               |
| `cimd_url_invalid`           | non-HTTPS / unparseable `clientIdMetadataUrl`                                            | provide an absolute https URL                              |
| `cimd_port_unfixed`          | `callbackPort` is `0`/unset in CIMD mode                                                 | set a fixed port                                           |
| `cimd_redirect_mismatch`     | redirect host/port ≠ callback / document                                                 | align redirectUri with callbackPort                        |
| `cimd_name_missing`          | no `client_name` in CIMD mode                                                            | set client_name                                            |
| `cimd_reserved_metadata_key` | `metadata.extra` contains a reserved OAuth client metadata key                           | move the field to first-class config                       |

## 8. Testing

Deno tests colocated (`provider_test.ts`, plus a new
`client-id-metadata_test.ts`). DI on `fetch` where needed (mirrors
`as-metadata-proxy_test.ts`).

- **Builder determinism**: same config ⇒ identical document; `client_id` equals
  `clientIdMetadataUrl` exactly.
- **Runtime/document coherence**: `clientInformation()` and the document agree
  on `client_id` and `redirect_uris`.
- **Each invariant** (§5) has a failing-input test (edge cases first).
- **Backwards compat**: existing static-`clientId` tests stay green untouched.
- **Loopback bind**: callback server listens on `127.0.0.1`, not `0.0.0.0`.

## 9. Coexistence & Plan Correction

- `as-metadata-proxy.ts` (DCR) is **kept**, docs/positioning reworded from
  "preferred" to "compatibility / legacy interop path". No deprecation.
- **Fix `docs/migration/2026-07-28.md:137`**: the Track E line says to inject
  `application_type` into `as-metadata-proxy.ts`. That is wrong —
  `application_type` is a _DCR client-metadata payload_ property (client side),
  not a field the proxy can inject into a request it never sees. Re-point or
  remove that row; fold CIMD into Track E as the actual modern path.

## 10. Out of Scope (v1)

- **A2 — hosting handler** (`createClientIdMetadataHandler()`): the doc must be
  publicly fetchable by the AS, so a local handler adds little for CLI clients.
  Revisit for web-app consumers.
- **A3 — auto-negotiation** (pre-registered → CIMD → DCR → manual in
  `connect.ts`): mixes discovery/strategy/fallback/UX and weakens explicit
  opt-in.
- Any server-side / AS-role behavior. `@casys` stays a Resource Server.

## 11. Known Limitations / Blind Spots

- A1 promises a _spec-correct document + coherent runtime_, **not** "works with
  every IdP". Some AS reject loopback `redirect_uris` in a publicly-hosted
  document, or require a `client_uri`/`client_id` relationship.
- CIMD does not eliminate localhost impersonation risk on the loopback redirect.
- SSRF/cache/size limits on fetching the `client_id`-URL belong to the AS;
  `@casys` must not half-reimplement them.

## 12. References

- [MCP Authorization 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [SEP-991 — URL-based client registration](https://modelcontextprotocol.io/seps/991-enable-url-based-client-registration-using-oauth-c)
- [IETF CIMD draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-01)
- [RFC 8252 — OAuth for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252)
- [RFC 9700 — OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/html/rfc9700)
