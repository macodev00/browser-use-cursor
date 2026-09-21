import { spawn } from "node:child_process";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const chromium = join(repo, "extensions", "chromium");
const firefox = join(repo, "extensions", "firefox", "manifest.json");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repo, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

function open(target) {
  if (platform() === "darwin") {
    spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (platform() === "win32") {
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
}

await run(process.execPath, [join(repo, "scripts", "sync-local-plugin.mjs")]);
await run(process.execPath, [join(repo, "scripts", "install-native-hosts.mjs")]);

open(chromium);
if (platform() === "darwin") {
  spawn("open", ["-a", "Google Chrome", "chrome://extensions"], { detached: true, stdio: "ignore" }).unref();
} else {
  open("https://macodev00.github.io/browser-use-cursor/");
}

console.log(`
Cursor Browser is ready to connect.

1. Reload Cursor (Developer: Reload Window).
2. In Chrome/Edge/Brave: Developer mode → Load unpacked →
   ${chromium}
3. In Firefox: about:debugging → This Firefox → Load Temporary Add-on →
   ${firefox}
4. Pin Cursor, open the popup, wait for Connected.

Plugin path: ${join(homedir(), ".cursor", "plugins", "local", "cursor-browser")}
Install page: https://macodev00.github.io/browser-use-cursor/
`);
