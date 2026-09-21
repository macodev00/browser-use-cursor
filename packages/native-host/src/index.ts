import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { DEFAULT_RELAY_PORT, RELAY_PORT_MAX, RELAY_NAME, type RelayState } from "@cursor-browser/protocol";

function log(...args: unknown[]): void {
  console.error("[cursor-browser-host]", ...args);
}

async function readState(): Promise<RelayState | undefined> {
  try {
    const raw = await readFile(join(homedir(), ".cursor", "browser-relay", "state.json"), "utf8");
    return JSON.parse(raw) as RelayState;
  } catch {
    return undefined;
  }
}

async function discoverPort(): Promise<{ port: number; token: string }> {
  const state = await readState();
  if (state?.port && state.token) {
    return { port: state.port, token: state.token };
  }
  for (let port = DEFAULT_RELAY_PORT; port <= RELAY_PORT_MAX; port += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/pair`);
      if (!response.ok) {
        continue;
      }
      const body = (await response.json()) as { name?: string; token?: string };
      if (body.name === RELAY_NAME && body.token) {
        return { port, token: body.token };
      }
    } catch {
      // try next
    }
  }
  throw new Error("Cursor Browser relay is not running. Enable the cursor-browser plugin in Cursor.");
}

function writeNativeMessage(message: unknown): void {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

async function main(): Promise<void> {
  const { port, token } = await discoverPort();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  ws.on("message", (raw) => {
    writeNativeMessage(JSON.parse(String(raw)));
  });
  ws.on("close", () => process.exit(0));
  ws.on("error", (error) => {
    log(error);
    process.exit(1);
  });

  let buffer = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0);
      if (buffer.length < 4 + size) {
        break;
      }
      const body = buffer.subarray(4, 4 + size).toString("utf8");
      buffer = buffer.subarray(4 + size);
      const message = JSON.parse(body) as { type?: string; token?: string };
      if (message?.type === "hello" && !message.token) {
        message.token = token;
      }
      ws.send(JSON.stringify(message));
    }
  });
  process.stdin.on("end", () => {
    ws.close();
  });
}

main().catch((error) => {
  log(error);
  process.exit(1);
});
