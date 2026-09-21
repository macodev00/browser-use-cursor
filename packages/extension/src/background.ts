import type { ToolRequest } from "@cursor-browser/protocol";
import { executeTool, listenDebuggerEvents } from "./automation";
import { RelayClient } from "./pairing";
import { allowHost, blockHost, getPermissions, savePermissions } from "./permissions";

const client = new RelayClient();

listenDebuggerEvents();

client.onMessage((message) => {
  if (message.type !== "tool_request") {
    return;
  }
  void handleTool(message);
});

async function handleTool(request: ToolRequest): Promise<void> {
  try {
    const result = await executeTool(
      request.params.tool,
      request.params.args,
      request.params.session_scope,
      request.params.tabId ?? (typeof request.params.args.tabId === "number" ? request.params.args.tabId : undefined),
    );
    client.send({ type: "tool_response", id: request.id, result });
  } catch (error) {
    const code = (error as { code?: string }).code;
    client.send({
      type: "tool_response",
      id: request.id,
      error: { message: error instanceof Error ? error.message : String(error), code },
    });
  }
}

async function connectNow(): Promise<unknown> {
  try {
    return await client.connect();
  } catch (error) {
    return { mode: "disconnected", error: error instanceof Error ? error.message : String(error) };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void connectNow();
});

chrome.runtime.onStartup.addListener(() => {
  void connectNow();
});

chrome.alarms.create("cursor-browser-reconnect", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cursor-browser-reconnect" && client.state.mode === "disconnected") {
    void connectNow();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    switch (message?.type) {
      case "get_state":
        sendResponse({
          connection: client.state,
          permissions: await getPermissions(),
        });
        return;
      case "connect":
        sendResponse(await connectNow());
        return;
      case "disconnect":
        client.disconnect();
        sendResponse(client.state);
        return;
      case "allow_host":
        await allowHost(String(message.host));
        sendResponse(await getPermissions());
        return;
      case "block_host":
        await blockHost(String(message.host));
        sendResponse(await getPermissions());
        return;
      case "allow_all":
        await savePermissions({ ...(await getPermissions()), allowAll: Boolean(message.value) });
        sendResponse(await getPermissions());
        return;
      default:
        sendResponse({ error: "unknown_message" });
    }
  })();
  return true;
});

void connectNow();
