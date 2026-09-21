import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { normalizeSessionScope } from "@cursor-browser/protocol";
import type { BrowserRelay } from "./relay.js";

const optionalBrowser = {
  browserId: z
    .string()
    .optional()
    .describe("Connected browser id from browser_status. Defaults to the last used real browser."),
  session_scope: z
    .string()
    .optional()
    .describe("Isolates Cursor tab groups per chat or workspace. Defaults to 'default'."),
  tabId: z.number().int().optional().describe("Target tab id inside the Cursor tab group."),
};

function sessionFrom(args: { session_scope?: string }): string {
  return normalizeSessionScope(args.session_scope ?? process.env.CURSOR_BROWSER_SESSION);
}

function asRecord(value: object): Record<string, unknown> {
  return { ...value };
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

function formatResult(result: unknown): {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
} {
  if (result && typeof result === "object" && "image" in result) {
    const image = (result as { image?: { data?: string; mimeType?: string } }).image;
    if (image?.data) {
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
        { type: "image", data: image.data, mimeType: image.mimeType ?? "image/png" },
      ];
      if ("text" in result && typeof (result as { text?: unknown }).text === "string") {
        content.unshift({ type: "text", text: (result as { text: string }).text });
      }
      return { content };
    }
  }
  if (typeof result === "string") {
    return textResult(result);
  }
  return textResult(JSON.stringify(result, null, 2));
}

export function registerTools(server: McpServer, relay: BrowserRelay): void {
  server.tool(
    "browser_status",
    "List real third-party browsers connected through the Cursor Browser extension. Never use Cursor's built-in Browser Tab for these tasks.",
    {},
    async () => {
      const browsers = relay.listBrowsers();
      if (browsers.length === 0) {
        return textResult(
          [
            "No real browser is connected.",
            "1. Keep this Cursor plugin enabled so the MCP relay is running.",
            "2. Load the Cursor Browser extension in Chrome, Edge, Brave, Opera, Vivaldi, or Firefox.",
            "3. Open the extension popup and confirm it says Connected.",
            "Do not fall back to Cursor's built-in Browser Tab.",
          ].join("\n"),
        );
      }
      return textResult(
        JSON.stringify(
          {
            relayPort: relay.port,
            browsers,
          },
          null,
          2,
        ),
      );
    },
  );

  server.tool(
    "tabs_context",
    "List tabs in the Cursor tab group of a connected real browser. User tabs outside the group are not included.",
    optionalBrowser,
    async (args) => {
      const result = await relay.call("tabs_context", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "tabs_create",
    "Create a new tab inside the Cursor tab group. Does not steal the user's foreground tab.",
    {
      ...optionalBrowser,
      url: z.string().optional().describe("Optional URL to open. Defaults to about:blank / empty tab."),
    },
    async (args) => {
      const result = await relay.call("tabs_create", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "tabs_close",
    "Close a tab that belongs to the Cursor tab group.",
    {
      ...optionalBrowser,
      tabId: z.number().int().describe("Tab id from tabs_context."),
    },
    async (args) => {
      const result = await relay.call("tabs_close", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "navigate",
    "Navigate a Cursor-group tab in the user's real browser. Reuses the signed-in profile.",
    {
      ...optionalBrowser,
      url: z
        .string()
        .describe("Absolute URL, or 'back' / 'forward' / 'reload'."),
    },
    async (args) => {
      const result = await relay.call("navigate", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "snapshot",
    "Accessibility snapshot of the page with stable ref_* ids for click/fill/type.",
    {
      ...optionalBrowser,
      filter: z.enum(["interactive", "all"]).optional().describe("Defaults to interactive controls."),
    },
    async (args) => {
      const result = await relay.call("snapshot", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "click",
    "Click an element in the Cursor tab group by ref from snapshot, or by viewport coordinates.",
    {
      ...optionalBrowser,
      ref: z.string().optional().describe("Element ref from snapshot, e.g. ref_12."),
      x: z.number().optional(),
      y: z.number().optional(),
      button: z.enum(["left", "right", "middle"]).optional(),
      doubleClick: z.boolean().optional(),
    },
    async (args) => {
      const result = await relay.call("click", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "type",
    "Type text into the focused element or an element ref. Does not autofill passwords.",
    {
      ...optionalBrowser,
      text: z.string().describe("Text to type."),
      ref: z.string().optional().describe("Optional element ref to focus first."),
      clear: z.boolean().optional().describe("Clear the field before typing."),
    },
    async (args) => {
      const result = await relay.call("type", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "fill",
    "Set a form control value by snapshot ref and dispatch input/change events.",
    {
      ...optionalBrowser,
      ref: z.string().describe("Element ref from snapshot."),
      value: z.union([z.string(), z.number(), z.boolean()]).describe("Value to assign."),
    },
    async (args) => {
      const result = await relay.call("fill", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "press_key",
    "Press a key or chord such as Enter, Tab, or Meta+A.",
    {
      ...optionalBrowser,
      key: z.string().describe("Key name or chord, e.g. Enter, Escape, Meta+A."),
      ref: z.string().optional(),
    },
    async (args) => {
      const result = await relay.call("press_key", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "scroll",
    "Scroll the page or a specific element.",
    {
      ...optionalBrowser,
      ref: z.string().optional().describe("Scroll this element into view when provided."),
      direction: z.enum(["up", "down", "left", "right"]).optional(),
      amount: z.number().optional().describe("Scroll ticks. Default 3."),
    },
    async (args) => {
      const result = await relay.call("scroll", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "hover",
    "Hover the mouse over an element ref or coordinates.",
    {
      ...optionalBrowser,
      ref: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    },
    async (args) => {
      const result = await relay.call("hover", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "screenshot",
    "Capture a screenshot of a Cursor-group tab in the real browser.",
    optionalBrowser,
    async (args) => {
      const result = await relay.call("screenshot", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "read_console",
    "Read console messages from a Cursor-group tab (Chromium debugger).",
    {
      ...optionalBrowser,
      onlyErrors: z.boolean().optional(),
      limit: z.number().int().optional(),
    },
    async (args) => {
      const result = await relay.call("read_console", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );

  server.tool(
    "read_network",
    "Read recent network requests from a Cursor-group tab (Chromium debugger).",
    {
      ...optionalBrowser,
      urlPattern: z.string().optional(),
      limit: z.number().int().optional(),
    },
    async (args) => {
      const result = await relay.call("read_network", asRecord(args), {
        browserId: args.browserId,
        sessionScope: sessionFrom(args),
        tabId: args.tabId,
      });
      return formatResult(result);
    },
  );
}
