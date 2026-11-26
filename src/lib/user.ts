// Strictly in-memory session token & active user ID storage
// Never persisted in localStorage or sessionStorage for credential safety.

let currentActiveUid: string | null = null;
let currentAuthToken: string | null = null;

// Clear any legacy localStorage account keys left over from earlier versions
try {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.removeItem("aura_active_user");
    localStorage.removeItem("aura_active_uid");
    localStorage.removeItem("aura_local_accounts");
    localStorage.removeItem("aura_google_account_uid");
    localStorage.removeItem("aura_user_id");
  }
} catch {}

export function setAuthToken(token: string | null) {
  currentAuthToken = token;
}

export function getAuthToken(): string | null {
  return currentAuthToken;
}

export function getAuthHeaders(): Record<string, string> {
  if (!currentAuthToken) return {};
  return {
    Authorization: `Bearer ${currentAuthToken}`
  };
}

export function setActiveUserId(uid: string | null) {
  currentActiveUid = uid;
}

export function getActiveUserId(): string | null {
  return currentActiveUid;
}

export function getOrCreateUserId(): string {
  return currentActiveUid || "anonymous";
}
