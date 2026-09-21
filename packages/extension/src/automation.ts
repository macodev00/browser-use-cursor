import { isForbiddenUrl } from "@cursor-browser/protocol";
import {
  injectedClick,
  injectedFill,
  injectedHideOverlay,
  injectedPressKey,
  injectedResolveRef,
  injectedScroll,
  injectedShowOverlay,
  injectedSnapshot,
  injectedType,
} from "./injected";
import { assertAllowedUrl } from "./permissions";
import { closeGroupTab, createGroupTab, listGroupTabs, requireGroupTab } from "./tab-groups";

const attached = new Set<number>();
const consoleLogs = new Map<number, string[]>();
const networkLogs = new Map<number, string[]>();

function hasDebugger(): boolean {
  return Boolean(chrome.debugger?.attach);
}

export function listenDebuggerEvents(): void {
  if (!hasDebugger()) {
    return;
  }
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (tabId == null) {
      return;
    }
    if (method === "Runtime.consoleAPICalled") {
      const event = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
      const text = (event.args ?? []).map((arg) => String(arg.value ?? arg.description ?? "")).join(" ");
      pushLog(consoleLogs, tabId, `[${event.type ?? "log"}] ${text}`);
    }
    if (method === "Log.entryAdded") {
      const event = params as { entry?: { level?: string; text?: string } };
      pushLog(consoleLogs, tabId, `[${event.entry?.level ?? "log"}] ${event.entry?.text ?? ""}`);
    }
    if (method === "Network.responseReceived") {
      const event = params as { response?: { url?: string; status?: number; mimeType?: string } };
      pushLog(
        networkLogs,
        tabId,
        `${event.response?.status ?? "?"} ${event.response?.url ?? ""} ${event.response?.mimeType ?? ""}`,
      );
    }
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId != null) {
      attached.delete(source.tabId);
    }
  });
}

function pushLog(store: Map<number, string[]>, tabId: number, line: string): void {
  const lines = store.get(tabId) ?? [];
  lines.push(line);
  store.set(tabId, lines.slice(-200));
}

async function attach(tabId: number): Promise<void> {
  if (!hasDebugger() || attached.has(tabId)) {
    return;
  }
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    const message = String((error as Error).message ?? error);
    if (!/already attached/i.test(message)) {
      throw error;
    }
  }
  attached.add(tabId);
  await sendCdp(tabId, "Runtime.enable", {});
  await sendCdp(tabId, "Log.enable", {});
  await sendCdp(tabId, "Network.enable", {});
}

async function sendCdp(tabId: number, method: string, params: Record<string, unknown>): Promise<unknown> {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function runInPage<T, A extends unknown[]>(
  tabId: number,
  func: (...args: A) => T,
  args: A,
): Promise<T> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return result?.result as T;
}

async function withHiddenOverlay<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  await runInPage(tabId, injectedHideOverlay, []).catch(() => undefined);
  try {
    return await fn();
  } finally {
    await runInPage(tabId, injectedShowOverlay, []).catch(() => undefined);
  }
}

async function resolveRef(tabId: number, ref?: string, x?: number, y?: number): Promise<{ x: number; y: number }> {
  if (ref) {
    const resolved = await runInPage(tabId, injectedResolveRef, [ref]);
    if (!resolved) {
      throw new Error(`Unknown ref ${ref}. Take a fresh snapshot.`);
    }
    return { x: resolved.x, y: resolved.y };
  }
  if (x != null && y != null) {
    return { x, y };
  }
  throw new Error("Provide a snapshot ref or x/y coordinates.");
}

async function mouse(
  tabId: number,
  type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel",
  extra: Record<string, unknown>,
): Promise<void> {
  if (!hasDebugger()) {
    return;
  }
  await attach(tabId);
  await sendCdp(tabId, "Input.dispatchMouseEvent", extra);
}

export async function executeTool(
  tool: string,
  args: Record<string, unknown>,
  sessionScope: string,
  tabId?: number,
): Promise<unknown> {
  switch (tool) {
    case "tabs_context":
      return { sessionScope, tabs: await listGroupTabs(sessionScope) };
    case "tabs_create":
      return createGroupTab(sessionScope, typeof args.url === "string" ? args.url : undefined);
    case "tabs_close": {
      const id = numberArg(args.tabId, tabId, "tabId");
      await closeGroupTab(sessionScope, id);
      return { closed: id };
    }
    case "navigate":
      return navigate(sessionScope, tabId, String(args.url ?? ""));
    case "snapshot":
      return snapshot(sessionScope, tabId, args.filter === "all" ? "all" : "interactive");
    case "click":
      return click(sessionScope, tabId, args);
    case "type":
      return typeText(sessionScope, tabId, args);
    case "fill":
      return fill(sessionScope, tabId, args);
    case "press_key":
      return pressKey(sessionScope, tabId, args);
    case "scroll":
      return scroll(sessionScope, tabId, args);
    case "hover":
      return hover(sessionScope, tabId, args);
    case "screenshot":
      return screenshot(sessionScope, tabId);
    case "read_console":
      return readLogs(sessionScope, tabId, consoleLogs, Boolean(args.onlyErrors), numberOptional(args.limit) ?? 100);
    case "read_network":
      return readNetwork(sessionScope, tabId, typeof args.urlPattern === "string" ? args.urlPattern : undefined, numberOptional(args.limit) ?? 100);
    default:
      throw new Error(`Unknown tool ${tool}`);
  }
}

async function navigate(sessionScope: string, tabId: number | undefined, url: string): Promise<unknown> {
  const tab = await requireGroupTab(sessionScope, tabId);
  if (!tab.id) {
    throw new Error("Tab is missing an id");
  }
  if (url === "back") {
    await chrome.tabs.goBack(tab.id);
    return { tabId: tab.id, action: "back" };
  }
  if (url === "forward") {
    await chrome.tabs.goForward(tab.id);
    return { tabId: tab.id, action: "forward" };
  }
  if (url === "reload") {
    await chrome.tabs.reload(tab.id);
    return { tabId: tab.id, action: "reload" };
  }
  const target = url.includes("://") || url.startsWith("about:") ? url : `https://${url}`;
  if (isForbiddenUrl(target)) {
    throw Object.assign(new Error(`Refusing to navigate to ${target}`), { code: "forbidden_url" });
  }
  await assertAllowedUrl(target);
  await chrome.tabs.update(tab.id, { url: target, active: false });
  return waitForTab(tab.id);
}

async function snapshot(
  sessionScope: string,
  tabId: number | undefined,
  filter: "interactive" | "all",
): Promise<unknown> {
  const tab = await requireGroupTab(sessionScope, tabId);
  if (!tab.id || !tab.url) {
    throw new Error("Tab is not ready");
  }
  await assertAllowedUrl(tab.url);
  if (hasDebugger()) {
    await attach(tab.id);
  }
  const text = await runInPage(tab.id, injectedSnapshot, [{ filter }]);
  return { tabId: tab.id, url: tab.url, title: tab.title, text };
}

async function click(sessionScope: string, tabId: number | undefined, args: Record<string, unknown>): Promise<unknown> {
  const tab = await readyTab(sessionScope, tabId);
  const point = await resolveRef(tab.id!, optionalString(args.ref), numberOptional(args.x), numberOptional(args.y));
  const button = args.button === "right" ? "right" : args.button === "middle" ? "middle" : "left";
  if (hasDebugger()) {
    await attach(tab.id!);
    await mouse(tab.id!, "mouseMoved", { type: "mouseMoved", x: point.x, y: point.y });
    await delay(80);
    const clicks = args.doubleClick ? 2 : 1;
    for (let i = 1; i <= clicks; i += 1) {
      await mouse(tab.id!, "mousePressed", {
        type: "mousePressed",
        x: point.x,
        y: point.y,
        button,
        clickCount: i,
      });
      await mouse(tab.id!, "mouseReleased", {
        type: "mouseReleased",
        x: point.x,
        y: point.y,
        button,
        clickCount: i,
      });
    }
    return { tabId: tab.id, clicked: point };
  }
  if (args.ref) {
    await runInPage(tab.id!, injectedClick, [String(args.ref)]);
    return { tabId: tab.id, clicked: point, mode: "dom" };
  }
  throw new Error("Coordinate clicks need Chromium debugger support");
}

async function typeText(sessionScope: string, tabId: number | undefined, args: Record<string, unknown>): Promise<unknown> {
  const tab = await readyTab(sessionScope, tabId);
  const text = String(args.text ?? "");
  const ref = optionalString(args.ref);
  if (ref) {
    await runInPage(tab.id!, injectedResolveRef, [ref]);
  }
  if (hasDebugger()) {
    await attach(tab.id!);
    if (args.clear) {
      await sendCdp(tab.id!, "Input.dispatchKeyEvent", { type: "keyDown", key: "a", modifiers: 4 });
      await sendCdp(tab.id!, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", modifiers: 4 });
      await sendCdp(tab.id!, "Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace" });
      await sendCdp(tab.id!, "Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace" });
    }
    await sendCdp(tab.id!, "Input.insertText", { text });
    return { tabId: tab.id, typed: text.length };
  }
  return { tabId: tab.id, result: await runInPage(tab.id!, injectedType, [ref, text, Boolean(args.clear)]) };
}

async function fill(sessionScope: string, tabId: number | undefined, args: Record<string, unknown>): Promise<unknown> {
  const tab = await readyTab(sessionScope, tabId);
  const ref = String(args.ref ?? "");
  const value = args.value as string | number | boolean;
  return { tabId: tab.id, result: await runInPage(tab.id!, injectedFill, [ref, value]) };
}

async function pressKey(sessionScope: string, tabId: number | undefined, args: Record<string, unknown>): Promise<unknown> {
  const tab = await readyTab(sessionScope, tabId);
  const key = String(args.key ?? "");
  if (optionalString(args.ref)) {
    await runInPage(tab.id!, injectedResolveRef, [String(args.ref)]);
  }
  if (hasDebugger()) {
    await attach(tab.id!);
    const modifiers = keyModifiers(key);
    const code = key.split("+").pop() ?? key;
    await sendCdp(tab.id!, "Input.dispatchKeyEvent", { type: "keyDown", key: code, modifiers });
    await sendCdp(tab.id!, "Input.dispatchKeyEvent", { type: "keyUp", key: code, modifiers });
    return { tabId: tab.id, key };
  }
  return { tabId: tab.id, result: await runInPage(tab.id!, injectedPressKey, [key]) };
}

async function scroll(sessionScope: string, tabId: number | undefined, args: Record<string, unknown>): Promise<unknown> {
  const tab = await readyTab(sessionScope, tabId);
  const direction = typeof args.direction === "string" ? args.direction : "down";
  const amount = numberOptional(args.amount) ?? 3;
  const ref = optionalString(args.ref);
  if (hasDebugger() && !ref) {
    await attach(tab.id!);
    const delta = amount * 100;
    await sendCdp(tab.id!, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 200,
      y: 200,
      deltaX: direction === "left" ? -delta : direction === "right" ? delta : 0,
      deltaY: direction === "up" ? -delta : direction === "down" ? delta : 0,
    });
    return { tabId: tab.id, direction, amount };
  }
  return {
    tabId: tab.id,
    result: await runInPage(tab.id!, injectedScroll, [ref, direction, amount]),
  };
}

async function hover(sessionScope: string, tabId: number | undefined, args: Record<string, unknown>): Promise<unknown> {
  const tab = await readyTab(sessionScope, tabId);
  const point = await resolveRef(tab.id!, optionalString(args.ref), numberOptional(args.x), numberOptional(args.y));
  if (hasDebugger()) {
    await attach(tab.id!);
    await mouse(tab.id!, "mouseMoved", { type: "mouseMoved", x: point.x, y: point.y });
    return { tabId: tab.id, hovered: point };
  }
  return { tabId: tab.id, hovered: point, mode: "dom" };
}

async function screenshot(sessionScope: string, tabId: number | undefined): Promise<unknown> {
  const tab = await readyTab(sessionScope, tabId);
  const data = await withHiddenOverlay(tab.id!, async () => {
    if (hasDebugger()) {
      await attach(tab.id!);
      const result = (await sendCdp(tab.id!, "Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      })) as { data?: string };
      return result.data;
    }
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return url.replace(/^data:image\/png;base64,/, "");
  });
  if (!data) {
    throw new Error("Screenshot failed");
  }
  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    image: { data, mimeType: "image/png" },
  };
}

async function readLogs(
  sessionScope: string,
  tabId: number | undefined,
  store: Map<number, string[]>,
  onlyErrors: boolean,
  limit: number,
): Promise<unknown> {
  const tab = await readyTab(sessionScope, tabId);
  if (hasDebugger()) {
    await attach(tab.id!);
  }
  const lines = (store.get(tab.id!) ?? []).filter((line) => (onlyErrors ? /error/i.test(line) : true));
  return { tabId: tab.id, messages: lines.slice(-limit) };
}

async function readNetwork(
  sessionScope: string,
  tabId: number | undefined,
  pattern: string | undefined,
  limit: number,
): Promise<unknown> {
  const tab = await readyTab(sessionScope, tabId);
  if (hasDebugger()) {
    await attach(tab.id!);
  }
  let lines = networkLogs.get(tab.id!) ?? [];
  if (pattern) {
    const regex = new RegExp(pattern);
    lines = lines.filter((line) => regex.test(line));
  }
  return { tabId: tab.id, requests: lines.slice(-limit) };
}

async function readyTab(sessionScope: string, tabId?: number): Promise<chrome.tabs.Tab> {
  const tab = await requireGroupTab(sessionScope, tabId);
  if (!tab.id || !tab.url) {
    throw new Error("Tab is not ready");
  }
  await assertAllowedUrl(tab.url);
  return tab;
}

async function waitForTab(tabId: number): Promise<unknown> {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      return { tabId, url: tab.url, title: tab.title };
    }
    await delay(200);
  }
  const tab = await chrome.tabs.get(tabId);
  return { tabId, url: tab.url, title: tab.title, status: tab.status };
}

function keyModifiers(key: string): number {
  let value = 0;
  if (/alt|option/i.test(key)) value += 1;
  if (/ctrl|control/i.test(key)) value += 2;
  if (/meta|cmd|command/i.test(key)) value += 4;
  if (/shift/i.test(key)) value += 8;
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberOptional(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function numberArg(...values: Array<unknown>): number {
  for (const value of values) {
    if (typeof value === "number") {
      return value;
    }
  }
  throw new Error("tabId is required");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
