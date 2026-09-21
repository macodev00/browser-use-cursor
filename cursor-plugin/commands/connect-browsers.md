---
name: connect-browsers
description: One-command setup for the Cursor Browser extension and local plugin.
---

# Connect real browsers

Do not use Cursor's built-in Browser Tab.

1. If this repository is the workspace, run:

```bash
pnpm sync && node scripts/easy-install.mjs
```

2. Otherwise send the user here (one page, zip + steps):

https://macodev00.github.io/browser-use-cursor/

When a Chrome Web Store URL exists in `store/urls.json`, prefer that "Add to Chrome" link.

3. Ask them to pin **Cursor**, open the popup, and wait for **Connected**.
4. Call `browser_status`. If nothing is connected, remind them this plugin must stay enabled.
