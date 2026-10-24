/**
 * Localhost callback server for OAuth PKCE redirect capture.
 *
 * Starts a temporary HTTP server on localhost to receive the
 * authorization code from the OAuth redirect. Shuts down
 * after receiving the code or on timeout.
 *
 * @module lib/server/client-auth/callback-server
 */

import { serve, type ServeHandle } from "../runtime/runtime.ts";

export interface CallbackServerOptions {
  /** Port to listen on (0 = auto-assign, default: 0) */
  port?: number;
  /** Hostname to bind (default: 127.0.0.1) */
  hostname?: string;
  /** Timeout in ms (default: 120_000) */
  timeout?: number;
}

/** Decoded OAuth authorization response received by the localhost callback. */
export interface OAuthCallbackResult {
  code: string;
  iss?: string;
  /** Preserved for the caller to compare with its expected state. */
  state?: string;
}

/** An OAuth error response. Its details are untrusted until issuer validation. */
export class OAuthCallbackError extends Error {
  constructor(
    public readonly error: string,
    public readonly errorDescription?: string,
    public readonly iss?: string,
    public readonly state?: string,
  ) {
    super("OAuth authorization callback returned an error");
    this.name = "OAuthCallbackError";
  }
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>PML Auth</title><style>
body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#08080a;color:#fff}
.card{text-align:center;padding:2rem}h1{color:#FFB86F}
</style></head><body><div class="card">
<h1>Authentication successful</h1>
<p>You can close this tab and return to the terminal.</p>
</div></body></html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html><head><title>PML Auth Error</title><style>
body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#08080a;color:#fff}
.card{text-align:center;padding:2rem}h1{color:#ff6b6b}
</style></head><body><div class="card">
<h1>Authentication failed</h1>
<p>Unable to complete authorization. Please try again.</p>
</div></body></html>`;

export class CallbackServer {
  private port: number;
  private hostname: string;
  private timeout: number;
  private server: ServeHandle | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private closeTimerId: ReturnType<typeof setTimeout> | null = null;
  /** Rejects the callback promise while it is still pending; null once settled. */
  private rejectPending: ((err: Error) => void) | null = null;

  constructor(options?: CallbackServerOptions) {
    this.port = options?.port ?? 0;
    this.hostname = options?.hostname ?? "127.0.0.1";
    this.timeout = options?.timeout ?? 120_000;
  }

  async start(): Promise<{
    port: number;
    codePromise: Promise<string>;
    callbackPromise: Promise<OAuthCallbackResult>;
  }> {
    let resolveCallback!: (callback: OAuthCallbackResult) => void;
    let rejectCallback!: (err: Error) => void;
    const callbackPromise = new Promise<OAuthCallbackResult>(
      (resolve, reject) => {
        resolveCallback = (callback) => {
          this.rejectPending = null;
          resolve(callback);
        };
        rejectCallback = (err) => {
          this.rejectPending = null;
          reject(err);
        };
      },
    );
    this.rejectPending = rejectCallback;
    const codePromise = callbackPromise.then(({ code }) => code);
    // Consumers may use either promise (or close without awaiting either).
    // Observe both rejections without changing the promises returned to callers.
    void callbackPromise.catch(() => {});
    void codePromise.catch(() => {});
    let resolveListen!: (port: number) => void;
    let rejectListen!: (err: Error) => void;
    const listenPromise = new Promise<number>((resolve) => {
      resolveListen = resolve;
    });
    const bindPromise = new Promise<never>((_, reject) => {
      rejectListen = reject;
    });

    this.timerId = setTimeout(() => {
      this.timerId = null;
      rejectCallback(
        new Error(
          "OAuth callback timeout — no authorization code received",
        ),
      );
      this.close();
    }, this.timeout);

    try {
      this.server = serve(
        {
          port: this.port,
          hostname: this.hostname,
          onListen: ({ port }) => {
            this.port = port;
            resolveListen(port);
          },
          onError: (err) => {
            rejectListen(err);
          },
        },
        (req) => {
          const url = new URL(req.url);
          if (url.pathname === "/callback") {
            const iss = url.searchParams.get("iss") ?? undefined;
            const state = url.searchParams.get("state") ?? undefined;
            const error = url.searchParams.get("error");
            const code = url.searchParams.get("code");
            if (!code && !error) {
              return new Response(ERROR_HTML, {
                status: 400,
                headers: { "Content-Type": "text/html" },
              });
            }
            if (this.timerId) {
              clearTimeout(this.timerId);
              this.timerId = null;
            }
            if (error) {
              rejectCallback(
                new OAuthCallbackError(
                  error,
                  url.searchParams.get("error_description") ?? undefined,
                  iss,
                  state,
                ),
              );
            } else if (code) {
              resolveCallback({ code, iss, state });
            }
            // Schedule close after response is sent
            this.closeTimerId = setTimeout(() => {
              this.closeTimerId = null;
              this.close();
            }, 100);
            return new Response(error ? ERROR_HTML : SUCCESS_HTML, {
              status: error ? 400 : 200,
              headers: { "Content-Type": "text/html" },
            });
          }
          return new Response("Not Found", { status: 404 });
        },
      );
    } catch (err) {
      await this.cleanupAfterStartFailure();
      throw err;
    }

    let port: number;
    try {
      port = await Promise.race([listenPromise, bindPromise]);
    } catch (err) {
      await this.cleanupAfterStartFailure();
      throw err;
    }
    return { port, codePromise, callbackPromise };
  }

  async close(): Promise<void> {
    this.clearTimers();
    // A close before the redirect would otherwise leave callbackPromise,
    // codePromise and finishAuth() waiting forever.
    this.rejectPendingCallback(
      "OAuth callback server closed before the authorization callback was received",
    );
    if (this.server) {
      await this.server.shutdown();
      this.server = null;
    }
  }

  private clearTimers(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.closeTimerId) {
      clearTimeout(this.closeTimerId);
      this.closeTimerId = null;
    }
  }

  private rejectPendingCallback(message: string): void {
    const rejectPending = this.rejectPending;
    this.rejectPending = null;
    rejectPending?.(new Error(message));
  }

  private async cleanupAfterStartFailure(): Promise<void> {
    this.clearTimers();
    this.rejectPendingCallback("OAuth callback server failed to start");
    if (this.server) {
      try {
        await this.server.shutdown();
      } catch {
        // Ignore shutdown failures after a failed bind.
      }
      this.server = null;
    }
  }
}
