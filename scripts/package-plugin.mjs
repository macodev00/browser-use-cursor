import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(repo, "cursor-plugin");
await mkdir(join(plugin, "server"), { recursive: true });
await mkdir(join(plugin, "host"), { recursive: true });
await mkdir(join(plugin, "scripts"), { recursive: true });

const nodeBundle = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  packages: "bundle",
  logLevel: "info",
};

await esbuild.build({
  ...nodeBundle,
  entryPoints: [join(repo, "packages", "mcp-server", "src", "index.ts")],
  outfile: join(plugin, "server", "index.cjs"),
});

await esbuild.build({
  ...nodeBundle,
  entryPoints: [join(repo, "packages", "native-host", "src", "index.ts")],
  outfile: join(plugin, "host", "index.cjs"),
});

await writeFile(
  join(plugin, "server", "run.cjs"),
  `#!/usr/bin/env node
"use strict";
require("./index.cjs");
`,
);

await cp(join(repo, "extensions"), join(plugin, "extensions"), { recursive: true });
await cp(join(repo, "scripts", "install-native-hosts.mjs"), join(plugin, "scripts", "install-native-hosts.mjs"));

console.log("packaged cursor-plugin server, host, and extensions");
