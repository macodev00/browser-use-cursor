import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "./log.js";
import { BrowserRelay } from "./relay.js";
import { registerTools } from "./tools.js";

const relayOnly = process.argv.includes("--relay-only");

async function main(): Promise<void> {
  const relay = new BrowserRelay();
  await relay.start();

  if (relayOnly) {
    log("relay-only mode; MCP stdio disabled");
    return;
  }

  const server = new McpServer({
    name: "cursor-browser",
    version: "0.1.0",
  });
  registerTools(server, relay);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server connected over stdio");
}

main().catch((error) => {
  log("fatal", error);
  process.exit(1);
});
