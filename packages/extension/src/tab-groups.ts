import type { TabInfo } from "@cursor-browser/protocol";

const GROUP_COLOR = "cyan" as const;

interface GroupRecord {
  groupId: number;
  windowId: number;
}

export function groupTitle(sessionScope: string): string {
  return sessionScope === "default" ? "Cursor" : `Cursor · ${sessionScope}`;
}

export async function ensureCursorGroup(sessionScope: string): Promise<number> {
  const key = `group:${sessionScope}`;
  const stored = (await chrome.storage.local.get(key))[key] as GroupRecord | undefined;
  if (stored?.groupId != null && chrome.tabGroups) {
    try {
      await chrome.tabGroups.get(stored.groupId);
      await chrome.tabGroups.update(stored.groupId, {
        title: groupTitle(sessionScope),
        color: GROUP_COLOR,
        collapsed: false,
      });
      return stored.groupId;
    } catch {
      await chrome.storage.local.remove(key);
    }
  }

  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  if (tab.id == null) {
    throw new Error("Could not create a Cursor tab");
  }
  if (!chrome.tabs.group || !chrome.tabGroups) {
    await chrome.storage.local.set({ [key]: { groupId: -1, windowId: tab.windowId } });
    return -1;
  }
  const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
  await chrome.tabGroups.update(groupId, {
    title: groupTitle(sessionScope),
    color: GROUP_COLOR,
    collapsed: false,
  });
  await chrome.storage.local.set({ [key]: { groupId, windowId: tab.windowId } });
  await injectOverlay(tab.id);
  return groupId;
}

export async function listGroupTabs(sessionScope: string): Promise<TabInfo[]> {
  const groupId = await ensureCursorGroup(sessionScope);
  const query = groupId >= 0 ? { groupId } : {};
  const tabs = await chrome.tabs.query(query);
  const scoped =
    groupId >= 0
      ? tabs
      : tabs.filter((tab) => tab.url && !tab.url.startsWith("chrome://") && tab.openerTabId == null);
  return scoped
    .filter((tab) => tab.id != null)
    .map((tab) => ({
      id: tab.id!,
      url: tab.url ?? "",
      title: tab.title ?? "",
      groupId: tab.groupId,
      active: tab.active,
    }));
}

export async function createGroupTab(sessionScope: string, url?: string): Promise<TabInfo> {
  const groupId = await ensureCursorGroup(sessionScope);
  const record = (await chrome.storage.local.get(`group:${sessionScope}`))[`group:${sessionScope}`] as
    | GroupRecord
    | undefined;
  const tab = await chrome.tabs.create({
    url: url ?? "about:blank",
    active: false,
    windowId: record?.windowId,
  });
  if (tab.id == null) {
    throw new Error("Could not create tab");
  }
  if (groupId >= 0 && chrome.tabs.group) {
    await chrome.tabs.group({ groupId, tabIds: [tab.id] });
  }
  await injectOverlay(tab.id);
  return {
    id: tab.id,
    url: tab.url ?? url ?? "",
    title: tab.title ?? "",
    groupId,
    active: false,
  };
}

export async function requireGroupTab(sessionScope: string, tabId?: number): Promise<chrome.tabs.Tab> {
  const tabs = await listGroupTabs(sessionScope);
  if (tabId != null) {
    const match = tabs.find((tab) => tab.id === tabId);
    if (!match) {
      throw new Error(`Tab ${tabId} is not in the Cursor tab group. Use tabs_context.`);
    }
    const tab = await chrome.tabs.get(tabId);
    return tab;
  }
  if (tabs[0]) {
    return chrome.tabs.get(tabs[0].id);
  }
  const created = await createGroupTab(sessionScope);
  return chrome.tabs.get(created.id);
}

export async function closeGroupTab(sessionScope: string, tabId: number): Promise<void> {
  await requireGroupTab(sessionScope, tabId);
  await chrome.tabs.remove(tabId);
}

async function injectOverlay(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["overlay.js"],
    });
  } catch {
    // about:blank and privileged pages cannot receive scripts
  }
}
