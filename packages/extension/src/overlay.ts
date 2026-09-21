(() => {
  if (document.getElementById("cursor-browser-overlay")) {
    return;
  }
  const root = document.createElement("div");
  root.id = "cursor-browser-overlay";
  root.textContent = "Cursor";
  root.setAttribute(
    "style",
    [
      "position:fixed",
      "top:12px",
      "right:12px",
      "z-index:2147483646",
      "padding:4px 8px",
      "border-radius:999px",
      "background:#0f172a",
      "color:#7dd3fc",
      "font:12px/1 ui-sans-serif,system-ui,sans-serif",
      "border:1px solid #38bdf8",
      "pointer-events:none",
    ].join(";"),
  );
  const style = document.createElement("style");
  style.textContent = "#cursor-browser-overlay[data-hidden='true']{display:none!important}";
  document.documentElement.append(style, root);
})();
