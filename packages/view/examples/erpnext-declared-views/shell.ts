import { App } from "@modelcontextprotocol/ext-apps";
import { createDeclaredViewDispatcher, type DeclaredViewDispatcherOptions } from "@mcpview/view";

export { mountDeclaredSessionApp } from "@mcpview/view";

/** The shell owns the single host connection. Publisher modules mount inside its existing root. */
export async function start(loaders: DeclaredViewDispatcherOptions<App>["loaders"]) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing application root.");
  const host = new App({ name: "erpnext-declared-views", version: "1.0.0" }, {});
  const dispatcher = createDeclaredViewDispatcher({ root, host, loaders });
  // The host can deliver its first result while connect() is still resolving.
  let connect!: () => void;
  const ready = new Promise<void>((resolve) => {
    connect = resolve;
  });
  host.ontoolresult = async (result) => {
    await ready;
    if (!(await dispatcher.dispatch(result))) {
      const text = document.createElement("pre");
      text.textContent = result.content?.flatMap((item) =>
        item.type === "text" ? [item.text] : []
      ).join("\n") || "";
      root.replaceChildren(text);
    }
  };
  host.onteardown = () => {
    dispatcher.dispose();
    return {};
  };
  await host.connect();
  connect();
}
