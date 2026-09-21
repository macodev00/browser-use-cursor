interface PopupState {
  connection: { mode: string; browserId?: string; error?: string };
  permissions: {
    allowedHosts: string[];
    blockedHosts: string[];
    pendingHosts: string[];
    allowAll: boolean;
  };
}

async function request<T>(message: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function renderList(id: string, hosts: string[], actions: Array<{ label: string; type: string }>): void {
  const root = el<HTMLUListElement>(id);
  root.replaceChildren();
  if (hosts.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "None";
    root.append(empty);
    return;
  }
  for (const host of hosts) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = host;
    const wrap = document.createElement("span");
    for (const action of actions) {
      const button = document.createElement("button");
      button.className = "tiny ghost";
      button.textContent = action.label;
      button.addEventListener("click", async () => {
        await request({ type: action.type, host });
        await refresh();
      });
      wrap.append(button);
    }
    item.append(name, wrap);
    root.append(item);
  }
}

async function refresh(): Promise<void> {
  const state = await request<PopupState>({ type: "get_state" });
  const connected = state.connection.mode !== "disconnected";
  el<HTMLElement>("dot").className = `dot ${connected ? "on" : "off"}`;
  el<HTMLElement>("status-label").textContent = connected
    ? `Connected · ${state.connection.mode}`
    : "Disconnected";
  el<HTMLElement>("status-detail").textContent = connected
    ? `Browser id ${state.connection.browserId?.slice(0, 8) ?? "pending"}`
    : state.connection.error ?? "Enable the cursor-browser plugin in Cursor, then connect.";
  renderList("pending", state.permissions.pendingHosts, [
    { label: "Allow", type: "allow_host" },
    { label: "Block", type: "block_host" },
  ]);
  renderList("allowed", state.permissions.allowedHosts, [{ label: "Block", type: "block_host" }]);
  renderList("blocked", state.permissions.blockedHosts, [{ label: "Allow", type: "allow_host" }]);
  el<HTMLInputElement>("allow-all").checked = state.permissions.allowAll;
}

el<HTMLButtonElement>("connect").addEventListener("click", async () => {
  await request({ type: "connect" });
  await refresh();
});

el<HTMLButtonElement>("disconnect").addEventListener("click", async () => {
  await request({ type: "disconnect" });
  await refresh();
});

el<HTMLInputElement>("allow-all").addEventListener("change", async (event) => {
  await request({ type: "allow_all", value: (event.target as HTMLInputElement).checked });
  await refresh();
});

void refresh();
