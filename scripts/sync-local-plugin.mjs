import { cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(homedir(), ".cursor", "plugins", "local", "cursor-browser");

await mkdir(dirname(dest), { recursive: true });
await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(join(repo, "cursor-plugin"), dest, { recursive: true });

console.log(`synced plugin to ${dest}`);
console.log("Reload Cursor (Developer: Reload Window), then open Customize and confirm cursor-browser.");
