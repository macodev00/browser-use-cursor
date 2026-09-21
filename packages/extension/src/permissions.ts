import { isForbiddenUrl, isLocalHost } from "@cursor-browser/protocol";

export interface PermissionState {
  allowedHosts: string[];
  blockedHosts: string[];
  pendingHosts: string[];
  allowAll: boolean;
}

const DEFAULT_STATE: PermissionState = {
  allowedHosts: [],
  blockedHosts: [],
  pendingHosts: [],
  allowAll: false,
};

export async function getPermissions(): Promise<PermissionState> {
  const stored = await chrome.storage.local.get("permissions");
  return { ...DEFAULT_STATE, ...(stored.permissions as PermissionState | undefined) };
}

export async function savePermissions(next: PermissionState): Promise<void> {
  await chrome.storage.local.set({ permissions: next });
}

export function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export async function assertAllowedUrl(url: string): Promise<void> {
  if (isForbiddenUrl(url)) {
    throw Object.assign(new Error(`Refusing to operate on privileged URL: ${url}`), {
      code: "forbidden_url",
    });
  }
  if (url === "about:blank" || url === "about:newtab") {
    return;
  }
  const host = hostFromUrl(url);
  if (!host) {
    return;
  }
  if (isLocalHost(host)) {
    return;
  }
  const state = await getPermissions();
  if (state.allowAll) {
    return;
  }
  if (state.blockedHosts.includes(host)) {
    throw Object.assign(new Error(`${host} is blocked in the Cursor Browser extension.`), {
      code: "blocked_host",
    });
  }
  if (state.allowedHosts.includes(host)) {
    return;
  }
  if (!state.pendingHosts.includes(host)) {
    await savePermissions({ ...state, pendingHosts: [...state.pendingHosts, host] });
  }
  throw Object.assign(
    new Error(
      `Allow ${host} in the Cursor Browser extension popup (Allow this site) before the agent can use it.`,
    ),
    { code: "permission_required" },
  );
}

export async function allowHost(host: string, forever = true): Promise<void> {
  const state = await getPermissions();
  await savePermissions({
    ...state,
    allowedHosts: forever ? unique([...state.allowedHosts, host]) : state.allowedHosts,
    pendingHosts: state.pendingHosts.filter((item) => item !== host),
    blockedHosts: state.blockedHosts.filter((item) => item !== host),
  });
}

export async function blockHost(host: string): Promise<void> {
  const state = await getPermissions();
  await savePermissions({
    ...state,
    blockedHosts: unique([...state.blockedHosts, host]),
    allowedHosts: state.allowedHosts.filter((item) => item !== host),
    pendingHosts: state.pendingHosts.filter((item) => item !== host),
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
