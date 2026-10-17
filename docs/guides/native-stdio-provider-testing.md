# Testing a provider's native stdio command

Provider repositories should test the command users actually run, not a wrapper
that imports the provider or an in-memory transport that bypasses its CLI. This
guide is a test-only adoption kit for that boundary. It does not add a framework
runtime API or a shared CLI parser.

The framework's own `packages/server/src/stdio-e2e_test.ts` proves
`McpApp.start()` over a real subprocess. A provider test has a different job: it
must prove that the provider's documented executable, flags, permissions, and
shutdown behavior reach that native stdio path correctly.

## Keep the launch contract provider-owned

Copy the executable and arguments from the provider's README, package manifest,
or container entrypoint into its test. Do not replace them with a fixture or a
test-only wrapper.

At minimum, exercise this launch matrix:

| Case                      | Required assertion                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| No transport flag         | The documented HTTP mode is selected explicitly. Verify its documented readiness signal or bind address. |
| Native stdio flag         | The real command serves JSON-RPC on stdin/stdout.                                                        |
| Mixed HTTP + stdio flags  | The process exits non-zero before starting either transport.                                             |
| Duplicate transport flags | The process exits non-zero instead of guessing which occurrence wins.                                    |

Flag names, Deno or Node permissions, Docker policy, environment variables, and
solver/database preparation remain in the provider repository. In particular, do
not copy the framework fixture's broad `--allow-all`: use the exact permissions
documented for the provider.

## Minimal Deno harness

The following helper launches one documented command, writes JSON-RPC lines,
rejects any non-JSON protocol output, keeps stderr available for diagnostics,
and requires a clean exit after stdin closes.

```typescript
import { assertEquals } from "@std/assert";

interface ProviderCommand {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  result?: unknown;
  error?: unknown;
}

function spawnNativeStdio(spec: ProviderCommand) {
  const child = new Deno.Command(spec.command, {
    args: [...spec.args],
    cwd: spec.cwd,
    env: spec.env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const writer = child.stdin.getWriter();
  const reader = child.stdout.getReader();
  const stderrReader = child.stderr.getReader();
  const statusPromise = child.status;
  const messages: JsonRpcMessage[] = [];
  let pumpFailure: unknown;
  let stderr = "";

  const parseLine = (line: string) => {
    if (line.length === 0) {
      throw new Error("provider wrote a blank line to protocol stdout");
    }
    const parsed = JSON.parse(line) as JsonRpcMessage;
    if (
      parsed === null || typeof parsed !== "object" ||
      parsed.jsonrpc !== "2.0"
    ) {
      throw new Error("provider stdout line is not a JSON-RPC 2.0 message");
    }
    messages.push(parsed);
  };

  const stdoutDone = (async () => {
    const decoder = new TextDecoder();
    let buffered = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) parseLine(line);
    }
    buffered += decoder.decode();
    if (buffered.length > 0) parseLine(buffered);
  })().catch((error) => {
    pumpFailure = error;
  });

  const stderrDone = (async () => {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }
    stderr += decoder.decode();
  })();

  const send = async (message: Record<string, unknown>) => {
    await writer.write(
      new TextEncoder().encode(`${JSON.stringify(message)}\n`),
    );
  };

  const waitForId = async (
    id: string | number,
    timeoutMs = 1_000,
  ): Promise<JsonRpcMessage> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pumpFailure) throw pumpFailure;
      const found = messages.find((message) => message.id === id);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(
      `provider did not answer JSON-RPC id ${id}; provider stderr: ${
        stderr.trim() || "<empty>"
      }`,
    );
  };

  const closeStdinAndWait = async (timeoutMs = 2_000) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await writer.close();
      const status = await Promise.race([
        statusPromise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("provider did not exit after stdin EOF")),
            timeoutMs,
          );
        }),
      ]);
      await Promise.all([stdoutDone, stderrDone]);
      if (pumpFailure) throw pumpFailure;
      assertEquals(status.success, true, stderr);
      return { status, stderr, messages };
    } catch (error) {
      try {
        child.kill("SIGTERM");
      } catch {
        // The child may have exited between the deadline and the kill attempt.
      }
      await statusPromise.catch(() => undefined);
      await Promise.allSettled([stdoutDone, stderrDone]);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}; provider stderr: ${stderr.trim() || "<empty>"}`,
        { cause: error },
      );
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };

  return {
    send,
    waitForId,
    closeStdinAndWait,
    diagnostics: () => stderr,
    messages,
  };
}

async function withNativeStdio<T>(
  spec: ProviderCommand,
  run: (session: ReturnType<typeof spawnNativeStdio>) => Promise<T>,
): Promise<T> {
  const session = spawnNativeStdio(spec);
  let runFailure: Error | undefined;
  try {
    return await run(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runFailure = new Error(
      `${message}; provider stderr: ${
        session.diagnostics().trim() || "<empty>"
      }`,
      { cause: error },
    );
    throw runFailure;
  } finally {
    try {
      await session.closeStdinAndWait();
    } catch (cleanupError) {
      if (runFailure === undefined) throw cleanupError;
      const cleanupMessage = cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
      throw new Error(
        `${runFailure.message}; cleanup failed: ${cleanupMessage}`,
        { cause: runFailure },
      );
    }
  }
}
```

Instantiate it with the provider's real command. For example, if the README says
`deno run --allow-env --allow-read src/cli.ts --stdio`, use those exact
arguments. If the shipped entrypoint is `npx`, a compiled binary, or a Docker
command, launch that instead.

## Required protocol checks

Use a fresh process for the modern and legacy eras so one negotiation cannot
hide an initialization bug in the other.

### Modern-first discovery

The first request is `server/discover`; do not send legacy `initialize` first.

```typescript
await withNativeStdio(DOCUMENTED_STDIO_COMMAND, async (modern) => {
  await modern.send({
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": {
          name: "provider-native-stdio-test",
          version: "1.0.0",
        },
      },
    },
  });
  const discovered = await modern.waitForId(1);
  assertEquals(
    (discovered.result as Record<string, unknown>).resultType,
    "complete",
  );
});
```

Also call `tools/list` and one harmless provider tool through this process. This
proves the documented command reaches the provider's real registration and
configuration path, rather than only the framework bootstrap.

### Legacy initialization

Start another process, send `initialize` for the provider's supported legacy
revision, then `notifications/initialized`, `tools/list`, and one harmless tool
call. Assert the legacy result shape remains legacy; do not require the modern
`resultType` envelope there.

### Stdout and EOF

- Every stdout line must be one JSON-RPC 2.0 message. Send logs and diagnostics
  to stderr only.
- Close stdin at the end of every test and require the child to exit cleanly
  within a bounded deadline. A test that kills the process unconditionally does
  not prove EOF cleanup.
- Include stderr in assertion failures, but never merge it into stdout.

### Dynamic resource lifecycle, when supported

If the provider can add or remove resources after startup, keep one process
alive and verify causally:

1. `resources/list` before the change;
2. the real provider action that adds or removes the resource;
3. exactly one `notifications/resources/list_changed` for a successful batch;
4. `resources/list` and `resources/read` after the change;
5. no extra notification after a rejected or no-op mutation.

Skip this section only when the provider has no dynamic-resource capability;
record that fact in the test rather than emulating one.

## Adoption checklist

- [ ] Test the exact documented executable and arguments.
- [ ] Prove the no-flag HTTP default separately.
- [ ] Reject mixed and duplicate transport flags.
- [ ] Probe modern `server/discover` before any handshake.
- [ ] Exercise legacy `initialize` in a fresh process.
- [ ] Keep stdout JSON-RPC-only and diagnostics on stderr.
- [ ] Close stdin and prove bounded, clean EOF shutdown.
- [ ] Exercise real tools and provider configuration.
- [ ] Cover dynamic resource add/remove and notification cardinality when the
      provider supports it.
- [ ] Keep provider permissions, Docker, environment, and solver setup local to
      that repository.
