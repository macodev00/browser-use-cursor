# Cursor Browser

A Cursor plugin plus real-browser extensions so **every Cursor model** can drive the user's signed-in Chrome, Edge, Brave, Opera, Vivaldi, or Firefox. This is not Cursor's built-in Browser Tab.

**Install page:** https://macodev00.github.io/browser-use-cursor/

## Easiest install

```bash
pnpm install
pnpm easy-install
```

Then reload Cursor, Load unpacked in each browser you want, and wait for **Connected** in the popup.

Store listings (one-click Add to Chrome / Firefox) are the next step after Chrome Web Store and AMO review. Packaged zips for those dashboards:

```bash
pnpm package-store
```

Uploads `dist/cursor-browser-chrome.zip` and `dist/cursor-browser-firefox.zip`. Listing copy is in [`store/CHROME_WEB_STORE.md`](store/CHROME_WEB_STORE.md).

## What you get

- MCP tools for any Cursor model: `browser_status`, `navigate`, `snapshot`, `click`, `type`, `screenshot`
- A visible **Cursor** tab group
- Site allow/block in the popup

## Privacy

https://macodev00.github.io/browser-use-cursor/privacy.html
