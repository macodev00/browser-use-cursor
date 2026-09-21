export interface SnapshotOptions {
  filter?: "interactive" | "all";
  depth?: number;
  maxChars?: number;
}

export interface ResolvedRef {
  ref: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tag: string;
  type?: string;
  name?: string;
}

type CursorWindow = Window & {
  __cursorElementMap?: Map<string, WeakRef<Element>>;
  __cursorElementToRef?: WeakMap<Element, string>;
  __cursorRefSeq?: number;
};

const INTERACTIVE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "LABEL"]);

export function injectedSnapshot(options: SnapshotOptions = {}): string {
  const filter = options.filter ?? "interactive";
  const depth = options.depth ?? 15;
  const maxChars = options.maxChars ?? 50_000;
  const win = window as CursorWindow;
  win.__cursorElementMap ??= new Map();
  win.__cursorElementToRef ??= new WeakMap();
  win.__cursorRefSeq ??= 1;

  const interactiveRoles =
    /^(button|link|textbox|searchbox|checkbox|radio|combobox|listbox|menuitem|tab|switch|slider|spinbutton)$/i;

  const isInteractive = (el: Element): boolean => {
    if (INTERACTIVE_TAGS.has(el.tagName)) {
      return true;
    }
    const role = el.getAttribute("role");
    if (role && interactiveRoles.test(role)) {
      return true;
    }
    return (el as HTMLElement).tabIndex >= 0;
  };

  const getName = (el: Element): string => {
    const html = el as HTMLInputElement;
    const labelled = "labels" in html && html.labels?.[0] ? html.labels[0].innerText : "";
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      labelled ||
      html.value ||
      (el.textContent ?? "")
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
  };

  const getRole = (el: Element): string => {
    const explicit = el.getAttribute("role");
    if (explicit) {
      return explicit;
    }
    if (el.tagName === "INPUT") {
      const type = (el as HTMLInputElement).type;
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button") return "button";
      return "textbox";
    }
    const map: Record<string, string> = {
      A: "link",
      BUTTON: "button",
      SELECT: "combobox",
      TEXTAREA: "textbox",
      H1: "heading",
      H2: "heading",
      H3: "heading",
      IMG: "image",
    };
    return map[el.tagName] ?? el.tagName.toLowerCase();
  };

  const ensureRef = (el: Element): string => {
    const existing = win.__cursorElementToRef!.get(el);
    if (existing) {
      return existing;
    }
    const ref = `ref_${win.__cursorRefSeq!++}`;
    win.__cursorElementMap!.set(ref, new WeakRef(el));
    win.__cursorElementToRef!.set(el, ref);
    return ref;
  };

  const lines = [`Title: ${document.title}`, `URL: ${location.href}`];

  const walk = (el: Element, level: number, indent: string) => {
    if (level > depth || lines.join("\n").length > maxChars) {
      return;
    }
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) {
      return;
    }
    const show = filter === "all" || isInteractive(el);
    if (show) {
      const ref = ensureRef(el);
      const extras: string[] = [];
      const href = el.getAttribute("href");
      if (href) extras.push(`href="${href}"`);
      const type = el.getAttribute("type");
      if (type) extras.push(`type="${type}"`);
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) extras.push(`placeholder="${placeholder}"`);
      if ((el as HTMLInputElement).disabled) extras.push("disabled");
      if ((el as HTMLInputElement).checked) extras.push("checked");
      lines.push(`${indent}${getRole(el)} ${JSON.stringify(getName(el))} [${ref}] ${extras.join(" ")}`.trimEnd());
    }
    const nextIndent = show ? `${indent}  ` : indent;
    for (const child of Array.from(el.children)) {
      walk(child, level + (show ? 1 : 0), nextIndent);
    }
  };

  if (document.body) {
    walk(document.body, 0, "");
  }
  return lines.join("\n").slice(0, maxChars);
}

export function injectedResolveRef(ref: string): ResolvedRef | null {
  const win = window as CursorWindow;
  const el = win.__cursorElementMap?.get(ref)?.deref();
  if (!el || !(el instanceof HTMLElement)) {
    return null;
  }
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }
  return {
    ref,
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    width: rect.width,
    height: rect.height,
    tag: el.tagName,
    type: el.getAttribute("type") ?? undefined,
    name: el.getAttribute("name") ?? el.getAttribute("aria-label") ?? undefined,
  };
}

export function injectedFill(ref: string, value: string | number | boolean): string {
  const win = window as CursorWindow;
  const el = win.__cursorElementMap?.get(ref)?.deref();
  if (!el || !(el instanceof HTMLElement)) {
    throw new Error(`Unknown ref ${ref}. Take a fresh snapshot.`);
  }
  if (el instanceof HTMLInputElement && (el.type === "password" || el.autocomplete === "current-password")) {
    throw new Error("Password fields are blocked in v1.");
  }
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  el.focus();

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      el.checked = Boolean(value);
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      descriptor?.set?.call(el, String(value));
      if (!descriptor?.set) {
        el.value = String(value);
      }
    }
  } else if (el instanceof HTMLSelectElement) {
    el.value = String(value);
  } else if (el.isContentEditable) {
    el.textContent = String(value);
  } else {
    throw new Error(`Ref ${ref} is not a fillable control`);
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return `Filled ${ref}`;
}

export function injectedClick(ref: string): string {
  const win = window as CursorWindow;
  const el = win.__cursorElementMap?.get(ref)?.deref();
  if (!el || !(el instanceof HTMLElement)) {
    throw new Error(`Unknown ref ${ref}. Take a fresh snapshot.`);
  }
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  el.focus();
  el.click();
  return `Clicked ${ref}`;
}

export function injectedType(ref: string | undefined, text: string, clear: boolean): string {
  const win = window as CursorWindow;
  const el = ref
    ? win.__cursorElementMap?.get(ref)?.deref()
    : (document.activeElement as Element | null);
  if (!el || !(el instanceof HTMLElement)) {
    throw new Error(ref ? `Unknown ref ${ref}` : "No focused element");
  }
  if (el instanceof HTMLInputElement && el.type === "password") {
    throw new Error("Password fields are blocked in v1.");
  }
  el.focus();
  if (clear && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, "");
    el.value = "";
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const next = clear ? text : `${el.value}${text}`;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, next);
    el.value = next;
  } else if (el.isContentEditable) {
    el.textContent = clear ? text : `${el.textContent ?? ""}${text}`;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return `Typed ${text.length} characters`;
}

export function injectedPressKey(key: string): string {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const parts = key.split("+");
  const code = parts[parts.length - 1] ?? key;
  const opts = {
    key: code,
    code: code.length === 1 ? `Key${code.toUpperCase()}` : code,
    bubbles: true,
    cancelable: true,
    metaKey: parts.some((part) => /meta|cmd|command/i.test(part)),
    ctrlKey: parts.some((part) => /ctrl|control/i.test(part)),
    altKey: parts.some((part) => /alt|option/i.test(part)),
    shiftKey: parts.some((part) => /shift/i.test(part)),
  };
  target.dispatchEvent(new KeyboardEvent("keydown", opts));
  target.dispatchEvent(new KeyboardEvent("keyup", opts));
  return `Pressed ${key}`;
}

export function injectedScroll(ref: string | undefined, direction: string, amount: number): string {
  if (ref) {
    const win = window as CursorWindow;
    const el = win.__cursorElementMap?.get(ref)?.deref();
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      return `Scrolled ${ref} into view`;
    }
  }
  const delta = amount * 100;
  const top = direction === "up" ? -delta : direction === "down" ? delta : 0;
  const left = direction === "left" ? -delta : direction === "right" ? delta : 0;
  window.scrollBy({ top, left, behavior: "instant" });
  return `Scrolled ${direction}`;
}

export function injectedHideOverlay(): void {
  document.getElementById("cursor-browser-overlay")?.setAttribute("data-hidden", "true");
}

export function injectedShowOverlay(): void {
  document.getElementById("cursor-browser-overlay")?.removeAttribute("data-hidden");
}
