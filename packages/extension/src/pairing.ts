import {
  DEFAULT_RELAY_PORT,
  NATIVE_HOST_NAME,
  RELAY_NAME,
  RELAY_PORT_MAX,
  type BrowserKind,
  type RelayMessage,
} from "@cursor-browser/protocol";

export type ConnectionMode = "disconnected" | "websocket" | "native";

export interface PairingInfo {
  port: number;
  token: string;
}

export interface ConnectionState {
  mode: ConnectionMode;
  browserId?: string;
  error?: string;
}

type MessageHandler = (message: RelayMessage) => void;

interface Transport {
  send(message: RelayMessage): void;
  disconnect(): void;
}

export async function discoverRelay(): Promise<PairingInfo> {
  for (let port = DEFAULT_RELAY_PORT; port <= RELAY_PORT_MAX; port += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/pair`);
      if (!response.ok) {
        continue;
      }
      const body = (await response.json()) as { name?: string; token?: string; port?: number };
      if (body.name === RELAY_NAME && body.token) {
        return { port: body.port ?? port, token: body.token };
      }
    } catch {
      // try next port
    }
  }
  throw new Error("Cursor plugin relay is not running. Enable the cursor-browser plugin in Cursor and retry.");
}

export function detectBrowser(): { browser: BrowserKind; browserName: string } {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return { browser: "edge", browserName: "Microsoft Edge" };
  if (ua.includes("OPR/") || ua.includes("Opera")) return { browser: "opera", browserName: "Opera" };
  if (ua.includes("Vivaldi")) return { browser: "vivaldi", browserName: "Vivaldi" };
  if (ua.includes("Brave") || (navigator as Navigator & { brave?: unknown }).brave) {
    return { browser: "brave", browserName: "Brave" };
  }
  if (ua.includes("Firefox")) return { browser: "firefox", browserName: "Firefox" };
  if (ua.includes("Chrome")) return { browser: "chrome", browserName: "Google Chrome" };
  return { browser: "unknown", browserName: "Browser" };
}

export class RelayClient {
  state: ConnectionState = { mode: "disconnected" };
  private transport: Transport | undefined;
  private handler: MessageHandler | undefined;

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async connect(): Promise<ConnectionState> {
    this.disconnect();
    const identity = detectBrowser();
    const pair = await discoverRelay();
    try {
      this.transport = await this.connectNative(pair, identity);
      this.state = { mode: "native", browserId: this.state.browserId };
    } catch (nativeError) {
      try {
        this.transport = await this.connectWebSocket(pair, identity);
        this.state = { mode: "websocket", browserId: this.state.browserId };
      } catch (wsError) {
        this.state = {
          mode: "disconnected",
          error: `${(wsError as Error).message} (native: ${(nativeError as Error).message})`,
        };
        throw wsError;
      }
    }
    await chrome.storage.local.set({ connection: this.state });
    return this.state;
  }

  send(message: RelayMessage): void {
    if (!this.transport) {
      throw new Error("Not connected to Cursor");
    }
    this.transport.send(message);
  }

  disconnect(): void {
    this.transport?.disconnect();
    this.transport = undefined;
    this.state = { mode: "disconnected" };
    void chrome.storage.local.set({ connection: this.state });
  }

  private connectNative(
    pair: PairingInfo,
    identity: { browser: BrowserKind; browserName: string },
  ): Promise<Transport> {
    if (!chrome.runtime.connectNative) {
      return Promise.reject(new Error("native messaging unavailable"));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          port.disconnect();
        } catch {
          // already closed
        }
        reject(error);
      };
      const onMessage = (message: RelayMessage) => {
        this.receive(message);
        if (!settled && (message.type === "hello_ok" || message.type === "pong")) {
          settled = true;
          resolve({
            send: (outgoing) => port.postMessage(outgoing),
            disconnect: () => {
              port.onMessage.removeListener(onMessage);
              port.onDisconnect.removeListener(onDisconnect);
              port.disconnect();
            },
          });
        }
      };
      const onDisconnect = () => {
        fail(new Error(chrome.runtime.lastError?.message ?? "native host missing"));
      };
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
      try {
        port.postMessage({
          type: "hello",
          token: pair.token,
          browser: identity.browser,
          browserName: identity.browserName,
          extensionVersion: chrome.runtime.getManifest().version,
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
      setTimeout(() => fail(new Error("native host handshake timed out")), 2500);
    });
  }

  private async connectWebSocket(
    pair: PairingInfo,
    identity: { browser: BrowserKind; browserName: string },
  ): Promise<Transport> {
    const ws = new WebSocket(`ws://127.0.0.1:${pair.port}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket timeout")), 4000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("WebSocket connection failed"));
      });
    });
    ws.addEventListener("message", (event) => {
      this.receive(JSON.parse(String(event.data)) as RelayMessage);
    });
    ws.addEventListener("close", () => {
      if (this.state.mode !== "disconnected") {
        this.state = { mode: "disconnected", error: "Relay closed" };
        void chrome.storage.local.set({ connection: this.state });
      }
    });
    ws.send(
      JSON.stringify({
        type: "hello",
        token: pair.token,
        browser: identity.browser,
        browserName: identity.browserName,
        extensionVersion: chrome.runtime.getManifest().version,
      }),
    );
    return {
      send: (message) => ws.send(JSON.stringify(message)),
      disconnect: () => ws.close(),
    };
  }

  private receive(message: RelayMessage): void {
    if (message.type === "hello_ok") {
      this.state = { ...this.state, browserId: message.browserId, error: undefined };
      void chrome.storage.local.set({ connection: this.state });
    }
    this.handler?.(message);
  }
}
