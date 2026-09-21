export const RELAY_NAME = "cursor-browser-relay";
export const NATIVE_HOST_NAME = "com.cursor.browser";
export const DEFAULT_RELAY_PORT = 19785;
export const RELAY_PORT_MAX = 19795;
export const CHROMIUM_EXTENSION_ID = "ibjlphjckbnfgcgnbacghiiicnnodonb";
export const FIREFOX_EXTENSION_ID = "cursor-browser@browser-use-cursor.local";
export const STATE_DIR_NAME = "browser-relay";

export type BrowserKind =
  | "chrome"
  | "edge"
  | "brave"
  | "opera"
  | "vivaldi"
  | "chromium"
  | "firefox"
  | "unknown";

export const TOOL_NAMES = [
  "browser_status",
  "tabs_context",
  "tabs_create",
  "tabs_close",
  "navigate",
  "snapshot",
  "click",
  "type",
  "fill",
  "press_key",
  "scroll",
  "hover",
  "screenshot",
  "read_console",
  "read_network",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface RelayState {
  name: typeof RELAY_NAME;
  port: number;
  token: string;
  startedAt: string;
  socketPath: string;
  pid: number;
}

export interface HelloMessage {
  type: "hello";
  token: string;
  browser: BrowserKind;
  browserName: string;
  extensionVersion: string;
}

export interface HelloOkMessage {
  type: "hello_ok";
  browserId: string;
}

export interface PingMessage {
  type: "ping";
}

export interface PongMessage {
  type: "pong";
}

export interface GetStatusMessage {
  type: "get_status";
  id: string;
}

export interface StatusMessage {
  type: "status";
  id: string;
  connected: boolean;
  browserId?: string;
  tabGroupId?: number;
  tabs?: TabInfo[];
}

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  groupId?: number;
  active?: boolean;
}

export interface ToolRequest {
  type: "tool_request";
  id: string;
  method: "execute_tool";
  params: {
    tool: string;
    args: Record<string, unknown>;
    client_id: string;
    session_scope: string;
    tabId?: number;
    tabGroupId?: number;
  };
}

export interface ToolResponse {
  type: "tool_response";
  id: string;
  result?: unknown;
  error?: { message: string; code?: string };
}

export type RelayMessage =
  | HelloMessage
  | HelloOkMessage
  | PingMessage
  | PongMessage
  | GetStatusMessage
  | StatusMessage
  | ToolRequest
  | ToolResponse;

export const BLOCKED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "chrome-search://",
  "chrome-untrusted://",
  "devtools://",
  "edge://",
  "extension://",
  "about:",
  "moz-extension://",
  "vivaldi://",
  "brave://",
  "opera://",
  "view-source:",
] as const;

export function isForbiddenUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return BLOCKED_URL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function normalizeSessionScope(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 80);
  }
  return "default";
}
