import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(repo, "dist");
const staging = join(dist, "staging");

await mkdir(dist, { recursive: true });
await rm(staging, { recursive: true, force: true });
await mkdir(join(staging, "chrome"), { recursive: true });
await mkdir(join(staging, "firefox"), { recursive: true });
await mkdir(join(staging, "plugin"), { recursive: true });

await cp(join(repo, "extensions", "chromium"), join(staging, "chrome"), { recursive: true });
await cp(join(repo, "extensions", "firefox"), join(staging, "firefox"), { recursive: true });
await cp(join(repo, "cursor-plugin"), join(staging, "plugin"), { recursive: true });

const chromeManifest = JSON.parse(await readFile(join(staging, "chrome", "manifest.json"), "utf8"));
delete chromeManifest.key;
await writeFile(join(staging, "chrome", "manifest.json"), `${JSON.stringify(chromeManifest, null, 2)}\n`);

async function zipDir(source, dest) {
  await rm(dest, { force: true });
  await exec("zip", ["-r", "-q", dest, "."], { cwd: source });
}

await zipDir(join(staging, "chrome"), join(dist, "cursor-browser-chrome.zip"));
await zipDir(join(staging, "firefox"), join(dist, "cursor-browser-firefox.zip"));
await zipDir(join(staging, "plugin"), join(dist, "cursor-plugin.zip"));

console.log(
  JSON.stringify(
    {
      chrome: join(dist, "cursor-browser-chrome.zip"),
      firefox: join(dist, "cursor-browser-firefox.zip"),
      plugin: join(dist, "cursor-plugin.zip"),
    },
    null,
    2,
  ),
);
