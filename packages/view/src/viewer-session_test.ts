import { assertEquals } from "@std/assert";
import { VIEWER_SESSION_APPLY_ACTION } from "@mcpview/contracts";

import type { ComposeEventClient, ComposeEventHandler } from "./compose-events.ts";
import type { AppHandle } from "./types.ts";
import { onViewerSession } from "./viewer-session.ts";

class FakeEvents implements ComposeEventClient {
  readonly handlers = new Map<string, ComposeEventHandler>();
  emit(): void {}
  on(action: string, handler: ComposeEventHandler): () => void {
    this.handlers.set(action, handler);
    return () => this.handlers.delete(action);
  }
  destroy(): void {}
}

interface RecordedSession {
  schema: "io.casys.thread.cad-viewer-session/1.0";
  artifactUri: string;
}

interface State {
  currentArtifact?: string;
}

function isRecordedSession(value: unknown): value is RecordedSession {
  return typeof value === "object" && value !== null &&
    (value as { schema?: unknown }).schema === "io.casys.thread.cad-viewer-session/1.0" &&
    typeof (value as { artifactUri?: unknown }).artifactUri === "string";
}

function fakeHandle(
  state: State = {},
  overrides: Partial<AppHandle<State>> = {},
): AppHandle<State> {
  return {
    ctx: { state } as AppHandle<State>["ctx"],
    currentView: "loading",
    navigate: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
    ...overrides,
  };
}

Deno.test("viewer session payload stays opaque and valid early actions replay after activation", async () => {
  const events = new FakeEvents();
  const seen: RecordedSession[] = [];
  let invalid = 0;
  const sessions = onViewerSession<State, RecordedSession>(events, {
    validate: isRecordedSession,
    onSession: (session, _payload, app) => {
      seen.push(session);
      app.ctx.state.currentArtifact = session.artifactUri;
    },
    onInvalid: () => invalid += 1,
  });

  const handler = events.handlers.get(VIEWER_SESSION_APPLY_ACTION)!;
  handler({ data: { schema: "wrong", artifactUri: "artifact://ignored" } });
  const session: RecordedSession = {
    schema: "io.casys.thread.cad-viewer-session/1.0",
    artifactUri: "artifact://sha256/example",
  };
  handler({ data: session });
  assertEquals(seen, []);

  const state: State = {};
  await sessions.activate(fakeHandle(state));
  assertEquals(invalid, 1);
  assertEquals(seen, [session]);
  assertEquals(state.currentArtifact, session.artifactUri);

  sessions.dispose();
  assertEquals(events.handlers.has(VIEWER_SESSION_APPLY_ACTION), false);
});

Deno.test("viewer sessions are serialized across activation and live delivery", async () => {
  const events = new FakeEvents();
  const seen: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => releaseFirst = resolve);
  const sessions = onViewerSession<State, RecordedSession>(events, {
    validate: isRecordedSession,
    onSession: async (session) => {
      seen.push(`start:${session.artifactUri}`);
      if (session.artifactUri === "first") await firstGate;
      seen.push(`end:${session.artifactUri}`);
    },
  });
  const handler = events.handlers.get(VIEWER_SESSION_APPLY_ACTION)!;
  handler({
    data: {
      schema: "io.casys.thread.cad-viewer-session/1.0",
      artifactUri: "first",
    },
  });
  const activation = sessions.activate(fakeHandle());
  await Promise.resolve();
  handler({
    data: {
      schema: "io.casys.thread.cad-viewer-session/1.0",
      artifactUri: "second",
    },
  });
  assertEquals(seen, ["start:first"]);

  releaseFirst();
  await activation;
  await sessions.drain();
  assertEquals(seen, ["start:first", "end:first", "start:second", "end:second"]);
});

Deno.test("dispose synchronously revokes late handle and context navigation", async () => {
  const events = new FakeEvents();
  const realNavigations: string[] = [];
  const rejectedNavigations: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => markStarted = resolve);
  const sessions = onViewerSession<State, RecordedSession>(events, {
    validate: isRecordedSession,
    onSession: async (_session, _payload, app) => {
      markStarted();
      await gate;
      for (
        const [source, navigate] of [
          ["handle", app.navigate],
          ["context", app.ctx.navigate],
        ] as const
      ) {
        try {
          await navigate("late");
        } catch (error) {
          rejectedNavigations.push(
            `${source}:${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
  });
  events.handlers.get(VIEWER_SESSION_APPLY_ACTION)!({
    data: {
      schema: "io.casys.thread.cad-viewer-session/1.0",
      artifactUri: "artifact://sha256/race",
    },
  });
  const activation = sessions.activate(fakeHandle({}, {
    navigate: (name) => {
      realNavigations.push(name);
      return Promise.resolve();
    },
  }));

  await started;
  sessions.dispose();
  assertEquals(events.handlers.has(VIEWER_SESSION_APPLY_ACTION), false);
  release();
  await activation;

  assertEquals(realNavigations, []);
  assertEquals(rejectedNavigations, [
    "handle:Viewer session navigation is revoked after dispatcher disposal",
    "context:Viewer session navigation is revoked after dispatcher disposal",
  ]);
});

Deno.test("a session callback can await App disposal without a dispatcher drain deadlock", async () => {
  const events = new FakeEvents();
  let finished = false;
  const sessions = onViewerSession<State, RecordedSession>(events, {
    validate: isRecordedSession,
    onSession: async (_session, _payload, app) => {
      await app.dispose();
      finished = true;
    },
  });
  events.handlers.get(VIEWER_SESSION_APPLY_ACTION)!({
    data: {
      schema: "io.casys.thread.cad-viewer-session/1.0",
      artifactUri: "artifact://sha256/dispose",
    },
  });

  await sessions.activate(fakeHandle({}, {
    dispose: () => {
      sessions.dispose();
      return Promise.resolve();
    },
  }));
  assertEquals(finished, true);
  assertEquals(events.handlers.has(VIEWER_SESSION_APPLY_ACTION), false);
});
