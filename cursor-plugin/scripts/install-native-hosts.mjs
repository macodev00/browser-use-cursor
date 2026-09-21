import { chmod, mkdir, writeFile, copyFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const relayDir = join(homedir(), ".cursor", "browser-relay");
const hostDir = join(relayDir, "host");
const nodePath = process.execPath;
const hostSourceCandidates = [
  join(repo, "cursor-plugin", "host", "index.cjs"),
  join(repo, "cursor-plugin", "host", "index.js"),
  join(repo, "packages", "native-host", "dist", "index.js"),
];

const CHROMIUM_ID = "ibjlphjckbnfgcgnbacghiiicnnodonb";
const FIREFOX_ID = "cursor-browser@browser-use-cursor.local";
const HOST_NAME = "com.cursor.browser";

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // continue
    }
  }
  throw new Error("Build the project first so cursor-plugin/host/index.js exists.");
}

function macChromeDirs() {
  const support = join(homedir(), "Library", "Application Support");
  return [
    ["chrome", join(support, "Google", "Chrome", "NativeMessagingHosts")],
    ["chrome-beta", join(support, "Google", "Chrome Beta", "NativeMessagingHosts")],
    ["chrome-canary", join(support, "Google", "Chrome Canary", "NativeMessagingHosts")],
    ["chromium", join(support, "Chromium", "NativeMessagingHosts")],
    ["edge", join(support, "Microsoft Edge", "NativeMessagingHosts")],
    ["edge-beta", join(support, "Microsoft Edge Beta", "NativeMessagingHosts")],
    ["brave", join(support, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts")],
    ["opera", join(support, "com.operasoftware.Opera", "NativeMessagingHosts")],
    ["opera-gx", join(support, "com.operasoftware.OperaGX", "NativeMessagingHosts")],
    ["vivaldi", join(support, "Vivaldi", "NativeMessagingHosts")],
    ["arc", join(support, "Arc", "User Data", "NativeMessagingHosts")],
  ];
}

function linuxChromeDirs() {
  const config = join(homedir(), ".config");
  return [
    ["chrome", join(config, "google-chrome", "NativeMessagingHosts")],
    ["chromium", join(config, "chromium", "NativeMessagingHosts")],
    ["edge", join(config, "microsoft-edge", "NativeMessagingHosts")],
    ["brave", join(config, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts")],
    ["opera", join(config, "opera", "NativeMessagingHosts")],
    ["vivaldi", join(config, "vivaldi", "NativeMessagingHosts")],
  ];
}

function firefoxDirs() {
  if (platform() === "darwin") {
    return [["firefox", join(homedir(), "Library", "Application Support", "Mozilla", "NativeMessagingHosts")]];
  }
  if (platform() === "linux") {
    return [["firefox", join(homedir(), ".mozilla", "native-messaging-hosts")]];
  }
  return [];
}

function chromeManifest(hostPath) {
  return {
    name: HOST_NAME,
    description: "Cursor Browser native messaging host",
    path: hostPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${CHROMIUM_ID}/`],
  };
}

function firefoxManifest(hostPath) {
  return {
    name: HOST_NAME,
    description: "Cursor Browser native messaging host",
    path: hostPath,
    type: "stdio",
    allowed_extensions: [FIREFOX_ID],
  };
}

async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function installWindowsRegistry(manifestPath, product) {
  const keys = {
    chrome: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    edge: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
    brave: `HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts\\${HOST_NAME}`,
    firefox: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`,
  };
  const key = keys[product];
  if (!key) {
    return;
  }
  await exec("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"]);
}

const hostSource = await firstExisting(hostSourceCandidates);
await mkdir(hostDir, { recursive: true });
const hostJs = join(hostDir, "index.js");
const runner = join(hostDir, platform() === "win32" ? "run.cmd" : "run.sh");
await copyFile(hostSource, hostJs);

if (platform() === "win32") {
  await writeFile(runner, `@echo off\r\n"${nodePath}" "${hostJs}"\r\n`);
} else {
  await writeFile(runner, `#!/bin/sh\nexec "${nodePath}" "${hostJs}"\n`);
  await chmod(runner, 0o755);
}

const chromeHostManifest = join(relayDir, "hosts", "chromium.json");
const firefoxHostManifest = join(relayDir, "hosts", "firefox.json");
await writeJson(chromeHostManifest, chromeManifest(runner));
await writeJson(firefoxHostManifest, firefoxManifest(runner));

const installed = [];

if (platform() === "win32") {
  await installWindowsRegistry(chromeHostManifest, "chrome");
  await installWindowsRegistry(chromeHostManifest, "edge");
  await installWindowsRegistry(chromeHostManifest, "brave");
  await installWindowsRegistry(firefoxHostManifest, "firefox");
  installed.push("windows-registry");
} else {
  const chromeDirs = platform() === "darwin" ? macChromeDirs() : linuxChromeDirs();
  for (const [name, dir] of chromeDirs) {
    await mkdir(dir, { recursive: true });
    await writeJson(join(dir, `${HOST_NAME}.json`), chromeManifest(runner));
    installed.push(name);
  }
  for (const [name, dir] of firefoxDirs()) {
    await mkdir(dir, { recursive: true });
    await writeJson(join(dir, `${HOST_NAME}.json`), firefoxManifest(runner));
    installed.push(name);
  }
}

const chromiumPath = join(repo, "extensions", "chromium");
const firefoxPath = join(repo, "extensions", "firefox");

console.log(
  JSON.stringify(
    {
      host: runner,
      installed,
      loadUnpacked: {
        chromeEdgeBraveOperaVivaldi: chromiumPath,
        firefox: join(firefoxPath, "manifest.json"),
      },
      chromeExtensionId: CHROMIUM_ID,
      firefoxExtensionId: FIREFOX_ID,
    },
    null,
    2,
  ),
);
