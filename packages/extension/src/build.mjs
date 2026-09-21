import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..", "..");
const keyInfo = JSON.parse(await readFile(join(root, "chromium-key.json"), "utf8"));

const sharedPermissions = [
  "tabs",
  "tabGroups",
  "scripting",
  "storage",
  "alarms",
  "nativeMessaging",
];

const chromiumManifest = {
  manifest_version: 3,
  name: "Cursor Browser",
  version: "0.1.0",
  description: "Let Cursor agents use this real browser with your signed-in profile and a visible Cursor tab group.",
  homepage_url: "https://macodev00.github.io/browser-use-cursor/",
  key: keyInfo.key,
  action: {
    default_title: "Cursor Browser",
    default_popup: "popup.html",
    default_icon: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
  },
  icons: {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  },
  background: {
    service_worker: "background.js",
  },
  permissions: [...sharedPermissions, "debugger"],
  host_permissions: ["<all_urls>"],
};

const firefoxManifest = {
  manifest_version: 3,
  name: "Cursor Browser",
  version: "0.1.0",
  description: "Let Cursor agents use this real browser with your signed-in profile and a visible Cursor tab group.",
  browser_specific_settings: {
    gecko: {
      id: "cursor-browser@browser-use-cursor.local",
      strict_min_version: "115.0",
    },
  },
  action: chromiumManifest.action,
  icons: chromiumManifest.icons,
  background: {
    scripts: ["background.js"],
  },
  permissions: sharedPermissions,
  host_permissions: ["<all_urls>"],
};

async function bundle(outfile) {
  await esbuild.build({
    entryPoints: [join(root, "src", `${basename(outfile)}.ts`)],
    outfile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome115", "firefox115"],
    keepNames: true,
    minify: false,
    legalComments: "none",
  });
}

function basename(file) {
  return file.split("/").pop().replace(/\.js$/, "");
}

async function writeExtension(dir, manifest) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await copyFile(join(root, "src", "popup.html"), join(dir, "popup.html"));
  await copyFile(join(root, "src", "popup.css"), join(dir, "popup.css"));
  await bundle(join(dir, "background.js"));
  await bundle(join(dir, "popup.js"));
  await bundle(join(dir, "overlay.js"));
}

await writeExtension(join(repo, "extensions", "chromium"), chromiumManifest);
await writeExtension(join(repo, "extensions", "firefox"), firefoxManifest);
console.log(`chromium extension id ${keyInfo.id}`);
