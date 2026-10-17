// deno-lint-ignore-file require-await
/**
 * Tests for multi-tenant middleware.
 *
 * Covers:
 *   - STDIO passthrough (no request)
 *   - Missing authInfo (config error)
 *   - Resolver success → tenantId injected
 *   - Resolver rejection → AuthError + onRejection called
 *   - Resolver throw → AuthError + onRejection called
 *   - authInfo immutability (frozen copy)
 *
 * @module lib/server/auth/multi-tenant-middleware_test
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import type { MiddlewareContext } from "../middleware/types.ts";
import type { AuthInfo } from "./types.ts";
import { AuthError } from "./middleware.ts";
import {
  createMultiTenantMiddleware,
  type TenantResolution,
  type TenantResolver,
} from "./multi-tenant-middleware.ts";

// ============================================
// Test helpers
// ============================================

function makeAuthInfo(overrides: Partial<AuthInfo> = {}): AuthInfo {
  return Object.freeze({
    subject: "user-123",
    scopes: [],
    claims: Object.freeze({
      "urn:test:tenant_id": "acme",
    }),
    ...overrides,
  }) as AuthInfo;
}

function makeHttpCtx(
  authInfo: AuthInfo | undefined,
  host = "acme.example.com",
): MiddlewareContext {
  return {
    toolName: "test_tool",
    args: {},
    request: new Request(`http://${host}/mcp`, { headers: { host } }),
    authInfo,
    resourceMetadataUrl:
      "https://example.com/.well-known/oauth-protected-resource",
  };
}

function makeStdioCtx(authInfo?: AuthInfo): MiddlewareContext {
  return {
    toolName: "test_tool",
    args: {},
    authInfo,
  };
}

/**
 * Minimal resolver that trusts the subdomain and checks it against the
 * `urn:test:tenant_id` claim.
 */
class SubdomainResolver implements TenantResolver {
  async resolve(ctx: MiddlewareContext): Promise<TenantResolution> {
    const host = ctx.request!.headers.get("host") ?? "";
    const subdomain = host.split(".")[0];
    const authInfo = ctx.authInfo as AuthInfo;
    const claim = authInfo.claims?.["urn:test:tenant_id"];
    if (typeof claim !== "string") {
      return { ok: false, reason: "claim missing" };
    }
    if (claim !== subdomain) {
      return {
        ok: false,
        reason: `subdomain=${subdomain} claim=${claim}`,
      };
    }
    return { ok: true, tenantId: subdomain };
  }
}

class ThrowingResolver implements TenantResolver {
  async resolve(_ctx: MiddlewareContext): Promise<TenantResolution> {
    throw new Error("boom");
  }
}

// ============================================
// STDIO passthrough
// ============================================

Deno.test("multi-tenant middleware - STDIO passthrough (no request)", async () => {
  const mw = createMultiTenantMiddleware(new SubdomainResolver());
  const ctx = makeStdioCtx(makeAuthInfo());
  let nextCalled = false;
  await mw(ctx, async () => {
    nextCalled = true;
    return undefined;
  });
  assert(nextCalled, "next() should be called on STDIO transport");
  // tenantId should NOT be injected on STDIO
  assertEquals((ctx.authInfo as AuthInfo).tenantId, undefined);
});

// ============================================
// Configuration errors
// ============================================

Deno.test("multi-tenant middleware - HTTP without authInfo throws config error", async () => {
  const mw = createMultiTenantMiddleware(new SubdomainResolver());
  const ctx = makeHttpCtx(undefined);
  await assertRejects(
    () => mw(ctx, async () => undefined),
    Error,
    "auth middleware",
  );
});

// ============================================
// Successful resolution
// ============================================

Deno.test("multi-tenant middleware - injects tenantId on successful resolution", async () => {
  const mw = createMultiTenantMiddleware(new SubdomainResolver());
  const ctx = makeHttpCtx(makeAuthInfo());
  await mw(ctx, async () => undefined);
  assertEquals((ctx.authInfo as AuthInfo).tenantId, "acme");
});

Deno.test("multi-tenant middleware - preserves original authInfo fields", async () => {
  const mw = createMultiTenantMiddleware(new SubdomainResolver());
  const original = makeAuthInfo({
    subject: "user-xyz",
    scopes: ["invoice:read", "invoice:write"],
    clientId: "client-abc",
    expiresAt: 1234567890,
  });
  const ctx = makeHttpCtx(original);
  await mw(ctx, async () => undefined);
  const after = ctx.authInfo as AuthInfo;
  assertEquals(after.subject, "user-xyz");
  assertEquals(after.scopes, ["invoice:read", "invoice:write"]);
  assertEquals(after.clientId, "client-abc");
  assertEquals(after.expiresAt, 1234567890);
  assertEquals(after.tenantId, "acme");
});

Deno.test("multi-tenant middleware - re-freezes authInfo after injection", async () => {
  const mw = createMultiTenantMiddleware(new SubdomainResolver());
  const ctx = makeHttpCtx(makeAuthInfo());
  await mw(ctx, async () => undefined);
  assert(Object.isFrozen(ctx.authInfo), "authInfo should be frozen");
});

// ============================================
// Resolver rejection (ok: false)
// ============================================

Deno.test("multi-tenant middleware - rejection yields invalid_token AuthError", async () => {
  const mw = createMultiTenantMiddleware(new SubdomainResolver());
  // subdomain "attacker" but claim says "acme" → mismatch
  const ctx = makeHttpCtx(makeAuthInfo(), "attacker.example.com");
  await assertRejects(
    () => mw(ctx, async () => undefined),
    AuthError,
  );
});

Deno.test("multi-tenant middleware - rejection calls onRejection with reason", async () => {
  let capturedReason: string | undefined;
  let capturedCtx: MiddlewareContext | undefined;
  const mw = createMultiTenantMiddleware(new SubdomainResolver(), {
    onRejection: (ctx, reason) => {
      capturedCtx = ctx;
      capturedReason = reason;
    },
  });
  const ctx = makeHttpCtx(makeAuthInfo(), "attacker.example.com");
  await assertRejects(() => mw(ctx, async () => undefined), AuthError);
  assertEquals(capturedReason, "subdomain=attacker claim=acme");
  assert(capturedCtx === ctx, "onRejection should receive the same ctx");
});

Deno.test("multi-tenant middleware - rejection awaits async onRejection", async () => {
  let logged = false;
  const mw = createMultiTenantMiddleware(new SubdomainResolver(), {
    onRejection: async () => {
      await new Promise((r) => setTimeout(r, 10));
      logged = true;
    },
  });
  const ctx = makeHttpCtx(makeAuthInfo(), "attacker.example.com");
  await assertRejects(() => mw(ctx, async () => undefined), AuthError);
  assert(logged, "async onRejection should be awaited before 401 is thrown");
});

// ============================================
// Resolver throw
// ============================================

Deno.test("multi-tenant middleware - thrown error yields invalid_token AuthError", async () => {
  const mw = createMultiTenantMiddleware(new ThrowingResolver());
  const ctx = makeHttpCtx(makeAuthInfo());
  const err = await assertRejects(
    () => mw(ctx, async () => undefined),
    AuthError,
  );
  assertEquals(err.code, "invalid_token");
});

Deno.test("multi-tenant middleware - thrown error calls onRejection with message", async () => {
  let captured: string | undefined;
  const mw = createMultiTenantMiddleware(new ThrowingResolver(), {
    onRejection: (_ctx, reason) => {
      captured = reason;
    },
  });
  const ctx = makeHttpCtx(makeAuthInfo());
  await assertRejects(() => mw(ctx, async () => undefined), AuthError);
  assertEquals(captured, "boom");
});

// ============================================
// AuthError does not leak rejection reason to client
// ============================================

Deno.test("multi-tenant middleware - AuthError message is generic, not resolver reason", async () => {
  const mw = createMultiTenantMiddleware(new SubdomainResolver());
  const ctx = makeHttpCtx(makeAuthInfo(), "attacker.example.com");
  const err = await assertRejects(
    () => mw(ctx, async () => undefined),
    AuthError,
  );
  // The resolver's detailed reason MUST NOT appear in the error message
  // that will be sent to the client.
  assert(
    !err.message.includes("subdomain=attacker"),
    "AuthError message should not leak resolver reason",
  );
  assert(
    !err.message.includes("claim=acme"),
    "AuthError message should not leak resolver reason",
  );
  // The resourceMetadataUrl (used in the WWW-Authenticate header) must come
  // from the upstream ctx, NOT from any resolver-supplied data — verify the
  // middleware did not accidentally construct it from rejection details.
  assertEquals(
    err.resourceMetadataUrl,
    "https://example.com/.well-known/oauth-protected-resource",
  );
});

// ============================================
// Empty tenantId rejection
// ============================================

class EmptyTenantResolver implements TenantResolver {
  async resolve(_ctx: MiddlewareContext): Promise<TenantResolution> {
    return { ok: true, tenantId: "" };
  }
}

Deno.test("multi-tenant middleware - empty string tenantId is rejected even on ok:true", async () => {
  const mw = createMultiTenantMiddleware(new EmptyTenantResolver());
  const ctx = makeHttpCtx(makeAuthInfo());
  const err = await assertRejects(
    () => mw(ctx, async () => undefined),
    AuthError,
  );
  assertEquals(err.code, "invalid_token");
});

Deno.test("multi-tenant middleware - empty tenantId calls onRejection with dedicated reason", async () => {
  let captured: string | undefined;
  const mw = createMultiTenantMiddleware(new EmptyTenantResolver(), {
    onRejection: (_ctx, reason) => {
      captured = reason;
    },
  });
  const ctx = makeHttpCtx(makeAuthInfo());
  await assertRejects(() => mw(ctx, async () => undefined), AuthError);
  assertEquals(captured, "resolver returned empty tenantId");
});

// ============================================
// Defensive: authInfo without claims
// ============================================

/**
 * Resolver that treats missing/malformed claims as a rejection reason.
 * Simulates how a real consumer would defensively handle optional claims.
 */
class ClaimsAwareResolver implements TenantResolver {
  async resolve(ctx: MiddlewareContext): Promise<TenantResolution> {
    const authInfo = ctx.authInfo as AuthInfo;
    const claim = authInfo.claims?.["urn:test:tenant_id"];
    if (typeof claim !== "string") {
      return { ok: false, reason: "claim missing or malformed" };
    }
    return { ok: true, tenantId: claim };
  }
}

Deno.test("multi-tenant middleware - authInfo without claims routes to rejection, not crash", async () => {
  const mw = createMultiTenantMiddleware(new ClaimsAwareResolver());
  const ctx = makeHttpCtx(
    Object.freeze({ subject: "user-xyz", scopes: [] }) as AuthInfo,
  );
  const err = await assertRejects(
    () => mw(ctx, async () => undefined),
    AuthError,
  );
  assertEquals(err.code, "invalid_token");
});

// ============================================
// Crashing onRejection hook must not change client-visible behaviour
// ============================================

Deno.test("multi-tenant middleware - onRejection that throws still yields generic AuthError", async () => {
  // Suppress expected stderr log for this test — we are intentionally
  // triggering the crash path.
  const originalError = console.error;
  console.error = () => {};
  try {
    const mw = createMultiTenantMiddleware(new SubdomainResolver(), {
      onRejection: () => {
        throw new Error("audit DB down");
      },
    });
    const ctx = makeHttpCtx(makeAuthInfo(), "attacker.example.com");
    const err = await assertRejects(
      () => mw(ctx, async () => undefined),
      AuthError,
    );
    // The client-visible error MUST still be the generic invalid_token,
    // NOT the hook's exception. A crashing audit hook must never turn
    // into an oracle for attackers.
    assertEquals(err.code, "invalid_token");
    assert(
      !err.message.includes("audit DB down"),
      "hook exception must not leak to client",
    );
  } finally {
    console.error = originalError;
  }
});

Deno.test("multi-tenant middleware - async onRejection that throws is also caught", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const mw = createMultiTenantMiddleware(new ThrowingResolver(), {
      onRejection: async () => {
        await new Promise((r) => setTimeout(r, 1));
        throw new Error("async audit failure");
      },
    });
    const ctx = makeHttpCtx(makeAuthInfo());
    const err = await assertRejects(
      () => mw(ctx, async () => undefined),
      AuthError,
    );
    assertEquals(err.code, "invalid_token");
  } finally {
    console.error = originalError;
  }
});
