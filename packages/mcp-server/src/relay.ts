import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { createServer as createUnixServer, type Socket } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import {
  DEFAULT_RELAY_PORT,
  RELAY_NAME,
  RELAY_PORT_MAX,
  type BrowserKind,
  type RelayMessage,
  type ToolRequest,
} from "@cursor-browser/protocol";
import { log } from "./log.js";
import { createState, socketPath, writeRelayState } from "./state.js";

export interface ConnectedBrowser {
  id: string;
  browser: BrowserKind;
  browserName: string;
  extensionVersion: string;
  connectedAt: string;
  send: (message: RelayMessage) => void;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const CALL_TIMEOUT_MS = 60_000;

export class BrowserRelay {
  token = randomBytes(16).toString("hex");
  port = DEFAULT_RELAY_PORT;
  browsers = new Map<string, ConnectedBrowser>();
  lastUsedId: string | undefined;

  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly pending = new Map<string, PendingCall>();
  private httpServer: ReturnType<typeof createHttpServer> | undefined;
  private unixServer: ReturnType<typeof createUnixServer> | undefined;
  private wss: WebSocketServer | undefined;

  async start(): Promise<void> {
    this.httpServer = createHttpServer((req, res) => {
      this.handleHttp(req, res).catch((error) => {
        log("http error", error);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
        }
        res.end(JSON.stringify({ error: "internal_error" }));
      });
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (socket, req) => {
      const remote = req.socket.remoteAddress ?? "";
      if (!isLoopback(remote)) {
        socket.close(1008, "loopback only");
        return;
      }
      this.bindSocket({
        send: (message) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
          }
        },
        onMessage: (handler) => {
          socket.on("message", (raw) => {
            handler(String(raw));
          });
        },
        onClose: (handler) => {
          socket.on("close", handler);
          socket.on("error", handler);
        },
      });
    });

    this.port = await listenLoopback(this.httpServer, DEFAULT_RELAY_PORT, RELAY_PORT_MAX);

    const sock = socketPath();
    await unlink(sock).catch(() => undefined);
    this.unixServer = createUnixServer((socket) => {
      this.bindLengthPrefixed(socket);
    });
    await new Promise<void>((resolve, reject) => {
      this.unixServer!.once("error", reject);
      this.unixServer!.listen(sock, () => resolve());
    });

    await writeRelayState(createState(this.port, this.token, sock));
    log(`relay listening on 127.0.0.1:${this.port} and ${sock}`);
  }

  listBrowsers(): Array<Omit<ConnectedBrowser, "send">> {
    return [...this.browsers.values()].map(({ send: _send, ...rest }) => rest);
  }

  pickBrowser(browserId?: string): ConnectedBrowser {
    if (browserId) {
      const match = this.browsers.get(browserId);
      if (!match) {
        throw new Error(
          `No connected browser with id ${browserId}. Connected: ${this.describeConnections()}`,
        );
      }
      return match;
    }
    if (this.lastUsedId) {
      const last = this.browsers.get(this.lastUsedId);
      if (last) {
        return last;
      }
    }
    const first = this.browsers.values().next().value;
    if (!first) {
      throw new Error(
        "No real browser is connected. Install the Cursor Browser extension in Chrome, Edge, Brave, Firefox, or another supported browser, open the popup, and click Connect. Do not use Cursor's built-in Browser Tab.",
      );
    }
    return first;
  }

  async call(
    tool: string,
    args: Record<string, unknown>,
    options: {
      browserId?: string;
      sessionScope: string;
      tabId?: number;
      tabGroupId?: number;
    },
  ): Promise<unknown> {
    const browser = this.pickBrowser(options.browserId);
    this.lastUsedId = browser.id;
    const previous = this.queues.get(browser.id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.callNow(browser, tool, args, options));
    this.queues.set(browser.id, next);
    return next;
  }

  private callNow(
    browser: ConnectedBrowser,
    tool: string,
    args: Record<string, unknown>,
    options: {
      sessionScope: string;
      tabId?: number;
      tabGroupId?: number;
    },
  ): Promise<unknown> {
    const id = randomUUID();
    const request: ToolRequest = {
      type: "tool_request",
      id,
      method: "execute_tool",
      params: {
        tool,
        args,
        client_id: "cursor",
        session_scope: options.sessionScope,
        tabId: options.tabId,
        tabGroupId: options.tabGroupId,
      },
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser tool ${tool} timed out after ${CALL_TIMEOUT_MS / 1000}s`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      browser.send(request);
    });
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remote = req.socket.remoteAddress ?? "";
    if (!isLoopback(remote)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "loopback_only" }));
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "no-store");

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          name: RELAY_NAME,
          port: this.port,
          browsers: this.listBrowsers(),
        }),
      );
      return;
    }

    if (url.pathname === "/pair") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          name: RELAY_NAME,
          port: this.port,
          token: this.token,
        }),
      );
      return;
    }

    if (url.pathname === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          name: RELAY_NAME,
          port: this.port,
          tokenHint: this.token.slice(0, 6),
          browsers: this.listBrowsers(),
        }),
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  }

  private bindLengthPrefixed(socket: Socket): void {
    const remote = socket.remoteAddress ?? "unix";
    if (socket.remoteAddress && !isLoopback(socket.remoteAddress)) {
      socket.destroy();
      return;
    }
    log("unix client", remote);

    let buffer = Buffer.alloc(0);
    const send = (message: RelayMessage) => {
      const body = Buffer.from(JSON.stringify(message), "utf8");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length, 0);
      socket.write(Buffer.concat([header, body]));
    };

    this.bindSocket({
      send,
      onMessage: (handler) => {
        socket.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (buffer.length >= 4) {
            const size = buffer.readUInt32LE(0);
            if (buffer.length < 4 + size) {
              break;
            }
            const body = buffer.subarray(4, 4 + size).toString("utf8");
            buffer = buffer.subarray(4 + size);
            handler(body);
          }
        });
      },
      onClose: (handler) => {
        socket.on("close", handler);
        socket.on("error", handler);
      },
    });
  }

  private bindSocket(transport: {
    send: (message: RelayMessage) => void;
    onMessage: (handler: (raw: string) => void) => void;
    onClose: (handler: () => void) => void;
  }): void {
    let browser: ConnectedBrowser | undefined;

    transport.onMessage((raw) => {
      let message: RelayMessage;
      try {
        message = JSON.parse(raw) as RelayMessage;
      } catch {
        log("invalid json from browser");
        return;
      }

      if (message.type === "hello") {
        if (message.token !== this.token) {
          transport.send({
            type: "tool_response",
            id: "hello",
            error: { code: "auth_failed", message: "Invalid pairing token" },
          });
          return;
        }
        browser = {
          id: randomUUID(),
          browser: message.browser,
          browserName: message.browserName,
          extensionVersion: message.extensionVersion,
          connectedAt: new Date().toISOString(),
          send: transport.send,
        };
        this.browsers.set(browser.id, browser);
        this.lastUsedId = browser.id;
        transport.send({ type: "hello_ok", browserId: browser.id });
        log(`browser connected ${browser.browserName} ${browser.id}`);
        return;
      }

      if (message.type === "ping") {
        transport.send({ type: "pong" });
        return;
      }

      if (message.type === "tool_response") {
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) {
          const error = new Error(message.error.message);
          (error as Error & { code?: string }).code = message.error.code;
          pending.reject(error);
          return;
        }
        pending.resolve(message.result);
      }
    });

    transport.onClose(() => {
      if (!browser) {
        return;
      }
      this.browsers.delete(browser.id);
      if (this.lastUsedId === browser.id) {
        this.lastUsedId = undefined;
      }
      log(`browser disconnected ${browser.browserName} ${browser.id}`);
    });
  }

  private describeConnections(): string {
    const names = this.listBrowsers().map((browser) => `${browser.browserName} (${browser.id.slice(0, 8)})`);
    return names.length ? names.join(", ") : "none";
  }
}

function isLoopback(address: string): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === ":ffff:127.0.0.1" ||
    address === "localhost" ||
    address === "unix" ||
    address === ""
  );
}

function listenLoopback(
  server: ReturnType<typeof createHttpServer>,
  start: number,
  end: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && port < end) {
          tryPort(port + 1);
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}
