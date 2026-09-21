# Chrome Web Store listing

Upload `dist/cursor-browser-chrome.zip` at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

A one-time $5 Google developer registration is required. Review usually takes a few days.

## Listing copy

**Name:** Cursor Browser

**Summary:** Let Cursor agents use your real Chrome with signed-in tabs and a visible Cursor group.

**Description:**

Cursor Browser connects the Cursor app to this Chrome profile. Agents can navigate, read the page, click, type, and take screenshots the way you would — using your cookies and SSO.

Work stays in a Cursor tab group. Your other tabs stay yours. New sites ask for permission in the popup. Password fields are blocked. The extension only talks to Cursor on your machine (127.0.0.1 / native messaging). It does not send browsing data to our servers.

Use this when Cursor needs Gmail, Salesforce, LinkedIn, or an internal tool you are already signed into. Do not confuse it with Cursor’s built-in Browser Tab.

**Category:** Developer Tools

**Language:** English

**Privacy policy:** https://macodev00.github.io/browser-use-cursor/privacy.html

**Homepage:** https://macodev00.github.io/browser-use-cursor/

## Permission justifications

- **Read and change all data on websites:** The agent must see and act on the page you asked it to use, after you allow that site.
- **Debugger:** Click, type, screenshot, console, and network use Chrome DevTools Protocol on Cursor-group tabs only.
- **Tabs / tab groups:** Create a visible Cursor group so the agent does not take over your active tab.
- **Native messaging:** Pair with the local Cursor plugin. No remote host.
- **Storage / alarms:** Remember allowed sites and reconnect to Cursor.

## After publish

1. Copy the store URL into `store/urls.json` → `chrome`.
2. Update `docs/index.html` so Add to Chrome points at the store (one click).
3. Put the assigned extension ID in native-host `allowed_origins` if it differs from the unpacked ID.
