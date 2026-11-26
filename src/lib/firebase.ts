import { getAuthHeaders, getAuthToken, setActiveUserId, setAuthToken } from "./user";

export interface AuraUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  keyPrefix?: string;
  provider?: string;
  createdAt?: string;
}

// In-memory auth session state (cleared automatically on logout or refresh)
let currentMemoryUser: AuraUser | null = null;
const authListeners: Set<(user: AuraUser | null) => void> = new Set();

export function getCachedUser(): AuraUser | null {
  return currentMemoryUser;
}

export function setCachedUser(user: AuraUser | null) {
  currentMemoryUser = user;
  setActiveUserId(user ? user.uid : null);
  authListeners.forEach((fn) => fn(user));
}

export async function loginWithEmail(email: string, pass: string): Promise<AuraUser> {
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }
  if (!pass || pass.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: cleanEmail,
      password: pass
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.user || !data?.accessToken) {
    throw new Error(data?.error || "Invalid email or password.");
  }

  const auraUser: AuraUser = {
    uid: data.user.uid,
    email: data.user.email,
    displayName: data.user.displayName || cleanEmail.split("@")[0] || "User",
    photoURL: null,
    keyPrefix: data.user.keyPrefix,
    provider: "email",
    createdAt: data.user.createdAt
  };

  setAuthToken(data.accessToken);
  setCachedUser(auraUser);
  return auraUser;
}

export function cleanAuthErrorMessage(err: any): string {
  if (!err) return "Authentication failed. Please verify credentials.";
  const msg = typeof err.message === "string" ? err.message : String(err);
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return "Network connection slow or unavailable. Please check your connection and try again.";
  }
  return msg.replace(/^Firebase:\s*Error\s*\((.*?)\)\.?/i, "$1").trim() || "Authentication failed.";
}

export async function logoutUser() {
  const token = getAuthToken();
  try {
    if (token) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          ...getAuthHeaders()
        }
      }).catch(() => {});
    }
  } finally {
    setAuthToken(null);
    setCachedUser(null);
  }
}

export function subscribeToAuth(callback: (user: AuraUser | null) => void): () => void {
  callback(currentMemoryUser);
  authListeners.add(callback);
  return () => {
    authListeners.delete(callback);
  };
}
