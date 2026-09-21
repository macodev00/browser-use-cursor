import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { RELAY_NAME, type RelayState } from "@cursor-browser/protocol";

export function relayDir(): string {
  return join(homedir(), ".cursor", "browser-relay");
}

export function statePath(): string {
  return join(relayDir(), "state.json");
}

export function socketPath(): string {
  return join(relayDir(), "relay.sock");
}

export async function writeRelayState(state: RelayState): Promise<void> {
  await mkdir(relayDir(), { recursive: true });
  await writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export function createState(port: number, token: string, sock: string): RelayState {
  return {
    name: RELAY_NAME,
    port,
    token,
    startedAt: new Date().toISOString(),
    socketPath: sock,
    pid: process.pid,
  };
}
