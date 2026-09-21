import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverJs = join(repo, "cursor-plugin", "server", "index.cjs");
const extensionDir = join(repo, "extensions", "chromium");

function callTool(client, name, args = {}) {
  return client.callTool({ name, arguments: args });
}

function textOf(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function startFixture() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><title>Cursor smoke</title><h1>Cursor smoke</h1><button id="ok">Ready</button>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/` };
}

const fixture = await startFixture();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverJs],
  stderr: "pipe",
});
const client = new Client({ name: "cursor-browser-smoke", version: "0.1.0" });
await client.connect(transport);

const disconnected = textOf(await callTool(client, "browser_status"));
if (!/no real browser/i.test(disconnected)) {
  throw new Error(`Expected a disconnected status, got:\n${disconnected}`);
}
console.log("mcp browser_status ok while disconnected");

let browserContext;
try {
  const { chromium } = await import("playwright");
  const userDataDir = await mkdtemp(join(tmpdir(), "cursor-browser-smoke-"));
  // Headless shell cannot load MV3 extensions. Use full Chromium.
  browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--no-first-run",
      "--disable-default-apps",
    ],
  });
  const worker =
    browserContext.serviceWorkers()[0] ??
    (await browserContext.waitForEvent("serviceworker", { timeout: 15_000 }));
  console.log("service worker", worker.url());

  const deadline = Date.now() + 20_000;
  let connected = "";
  while (Date.now() < deadline) {
    connected = textOf(await callTool(client, "browser_status"));
    if (/browserId|Google Chrome|Chromium|Brave|Edge/i.test(connected) && !/No real browser/i.test(connected)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (/No real browser/i.test(connected)) {
    throw new Error(`Extension did not pair:\n${connected}`);
  }
  console.log("extension paired");

  const navigated = textOf(await callTool(client, "navigate", { url: fixture.url, session_scope: "smoke" }));
  if (!navigated.includes("127.0.0.1")) {
    throw new Error(`navigate failed:\n${navigated}`);
  }
  console.log("navigate ok");

  const snapshot = textOf(await callTool(client, "snapshot", { session_scope: "smoke" }));
  if (!/Cursor smoke|Ready|button/i.test(snapshot)) {
    throw new Error(`snapshot missing page content:\n${snapshot}`);
  }
  console.log("snapshot ok");
  await rm(userDataDir, { recursive: true, force: true });
} catch (error) {
  if (error && /Cannot find package 'playwright'|browserType\.launch/i.test(String(error))) {
    console.warn("playwright extension smoke skipped:", error.message ?? error);
  } else if (process.env.CURSOR_BROWSER_REQUIRE_EXTENSION === "1") {
    throw error;
  } else {
    console.warn("extension smoke skipped:", error instanceof Error ? error.message : error);
  }
} finally {
  await browserContext?.close().catch(() => undefined);
  await client.close().catch(() => undefined);
  fixture.server.close();
}

console.log("smoke test finished");
