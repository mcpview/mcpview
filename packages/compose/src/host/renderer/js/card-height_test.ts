import { assertEquals } from "@std/assert";
import { MCP_APPS_PROTOCOL_VERSION } from "../../../version.ts";
import { generateCardHeightScript } from "./card-height.ts";

function fixture(options: { chatgpt?: boolean; standalone?: boolean } = {}) {
  let boardHeight = 200;
  let active = false;
  let measure = () => {};
  const nativeHeights: number[] = [];
  const sent: { message: Record<string, unknown>; origin: string }[] = [];
  const host = {
    postMessage(message: Record<string, unknown>, origin: string) {
      sent.push({ message, origin });
    },
  };
  const events = new EventTarget();
  const win = Object.assign(events, {
    parent: options.standalone ? events : host,
    openai: options.chatgpt
      ? { notifyIntrinsicHeight: (height: number) => nativeHeights.push(height) }
      : undefined,
  });
  const board = {
    setAttribute() {},
    getBoundingClientRect: () => ({ height: boardHeight }),
  };
  class TestObserver {
    constructor(callback: () => void) {
      measure = callback;
    }
    observe(target: unknown, options: unknown) {
      assertEquals(target, board);
      assertEquals(options, { box: "border-box" });
      active = true;
    }
    disconnect() {
      active = false;
    }
  }
  new Function("window", "document", "ResizeObserver", generateCardHeightScript())(
    win,
    { querySelector: () => board },
    TestObserver,
  );
  function receive(payload: object, source: object = host, origin = "https://chat.example") {
    events.dispatchEvent(Object.assign(new Event("message"), {
      source,
      origin,
      data: { jsonrpc: "2.0", ...payload },
    }));
  }
  return {
    host,
    nativeHeights,
    sent,
    receive,
    resize(height: number) {
      boardHeight = height;
      if (active) measure();
    },
  };
}

Deno.test("the card reports the grid's growth and shrinkage to its initialized parent", () => {
  const f = fixture();
  const init = f.sent[0].message;
  assertEquals(init.method, "ui/initialize");
  const reply = { id: init.id, result: { protocolVersion: MCP_APPS_PROTOCOL_VERSION } };
  f.resize(317.5);
  f.receive(reply, {});
  f.receive({ ...reply, id: "unrelated" });
  f.receive({ id: init.id, result: { protocolVersion: "unknown" } });
  assertEquals(f.sent.length, 1);

  f.receive(reply);
  f.resize(318);
  f.resize(645.1);
  f.resize(317.5);
  assertEquals(f.sent.slice(1).map(({ message }) => [message.method, message.params]), [
    ["ui/notifications/initialized", undefined],
    ["ui/notifications/size-changed", { height: 318 }],
    ["ui/notifications/size-changed", { height: 646 }],
    ["ui/notifications/size-changed", { height: 318 }],
  ]);
  assertEquals(f.sent.slice(1).every(({ origin }) => origin === "https://chat.example"), true);
  const teardown = { id: 99, method: "ui/resource-teardown" };
  f.receive(teardown, f.host, "https://other.example");
  assertEquals(f.sent.length, 5);
  f.receive(teardown);
  f.resize(900);
  assertEquals(f.sent.at(-1)?.message, { jsonrpc: "2.0", id: 99, result: {} });
});

Deno.test("ChatGPT's height bridge works before an MCP Apps handshake", () => {
  const f = fixture({ chatgpt: true });
  f.resize(300);
  f.resize(490);
  f.resize(490);
  f.resize(300);
  assertEquals(f.nativeHeights, [300, 490, 300]);
  f.receive({ id: f.sent[0].message.id, result: { protocolVersion: MCP_APPS_PROTOCOL_VERSION } });
  f.resize(450);
  assertEquals(f.nativeHeights, [300, 490, 300]);
  assertEquals(f.sent.at(-1)?.message.params, { height: 450 });
});

Deno.test("a standalone dashboard has no enclosing app to notify", () => {
  const f = fixture({ standalone: true });
  f.resize(333);
  assertEquals(f.sent, []);
});
