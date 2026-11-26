import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export interface UserRecord {
  uid: string;
  email: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  keyHash: string;
  keyPrefix: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface AuthenticatedUser {
  uid: string;
  email: string;
  displayName: string;
  keyPrefix: string;
  createdAt: string;
}

export interface StoredChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: string;
  modelUsed?: string;
}

export interface StoredTranscriptRecord {
  id: string;
  transcription: string;
  timestamp: string;
  durationSeconds?: number;
  fileName?: string;
  modelUsed: string;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const USERS_REGISTRY_PATH = path.resolve(DATA_DIR, "users_registry.json");

function ensureContainedPath(baseDir: string, filename: string): string {
  const safeName = path.basename(filename);
  const resolved = path.resolve(baseDir, safeName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error("Invalid file path boundary.");
  }
  return resolved;
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
  await ensureDataDir();
  const tempPath = `${targetPath}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw err;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function deriveUidForEmail(email: string): string {
  const clean = normalizeEmail(email);
  const safePrefix =
    clean
      .split("@")[0]
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 12) || "user";
  const digest = crypto.createHash("sha256").update(clean).digest("hex").slice(0, 12);
  return `aura_${safePrefix}_${digest}`;
}

function hashPasswordScrypt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPasswordScrypt(password: string, salt: string, expectedHex: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function hashApiKey(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generatePersonalApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `aura_key_${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = `${rawKey.slice(0, 14)}••••${rawKey.slice(-4)}`;
  return { rawKey, keyHash, keyPrefix };
}

async function loadUsersRegistry(): Promise<UserRecord[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(USERS_REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function saveUsersRegistry(records: UserRecord[]): Promise<void> {
  await atomicWriteJson(USERS_REGISTRY_PATH, records);
}

// Simple serialized write queue for registry mutations to avoid race conditions
let registryLock: Promise<void> = Promise.resolve();
function withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = registryLock.then(fn, fn);
  registryLock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function authenticateOrProvisionEmailUser(
  rawEmail: string,
  rawPassword: string
): Promise<{ user: AuthenticatedUser; accessToken: string; isNewAccount: boolean }> {
  if (typeof rawEmail !== "string" || typeof rawPassword !== "string") {
    throw new AuthError("Email and password are required.", 400);
  }

  const email = normalizeEmail(rawEmail);
  if (!isValidEmailFormat(email)) {
    throw new AuthError("Please enter a valid email address.", 400);
  }

  if (rawPassword.length < 6 || rawPassword.length > 256) {
    throw new AuthError("Password must be between 6 and 256 characters.", 400);
  }

  return withRegistryLock(async () => {
    const records = await loadUsersRegistry();
    const existingIndex = records.findIndex((r) => r.email === email);
    const now = new Date().toISOString();

    if (existingIndex !== -1) {
      const existing = records[existingIndex];
      const valid = verifyPasswordScrypt(rawPassword, existing.passwordSalt, existing.passwordHash);
      if (!valid) {
        throw new AuthError("Invalid email or password.", 401);
      }

      const { rawKey, keyHash, keyPrefix } = generatePersonalApiKey();
      const updated: UserRecord = {
        ...existing,
        keyHash,
        keyPrefix,
        lastLoginAt: now
      };
      records[existingIndex] = updated;
      await saveUsersRegistry(records);

      return {
        user: {
          uid: updated.uid,
          email: updated.email,
          displayName: updated.displayName,
          keyPrefix: updated.keyPrefix,
          createdAt: updated.createdAt
        },
        accessToken: rawKey,
        isNewAccount: false
      };
    }

    // First-time login with this Gmail/email automatically provisions an isolated identity + unique API key
    const uid = deriveUidForEmail(email);
    const displayName = email.split("@")[0] || "User";
    const passwordSalt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPasswordScrypt(rawPassword, passwordSalt);
    const { rawKey, keyHash, keyPrefix } = generatePersonalApiKey();

    const newRecord: UserRecord = {
      uid,
      email,
      displayName,
      passwordHash,
      passwordSalt,
      keyHash,
      keyPrefix,
      createdAt: now,
      lastLoginAt: now
    };

    records.push(newRecord);
    await saveUsersRegistry(records);

    return {
      user: {
        uid: newRecord.uid,
        email: newRecord.email,
        displayName: newRecord.displayName,
        keyPrefix: newRecord.keyPrefix,
        createdAt: newRecord.createdAt
      },
      accessToken: rawKey,
      isNewAccount: true
    };
  });
}

export async function verifyBearerToken(token: string | undefined | null): Promise<AuthenticatedUser | null> {
  if (!token || typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed.startsWith("aura_key_") || trimmed.length < 32) return null;

  const candidateHash = hashApiKey(trimmed);
  const candidateBuf = Buffer.from(candidateHash, "hex");
  const records = await loadUsersRegistry();

  for (const record of records) {
    if (!record.keyHash) continue;
    const storedBuf = Buffer.from(record.keyHash, "hex");
    if (storedBuf.length === candidateBuf.length && crypto.timingSafeEqual(storedBuf, candidateBuf)) {
      return {
        uid: record.uid,
        email: record.email,
        displayName: record.displayName,
        keyPrefix: record.keyPrefix,
        createdAt: record.createdAt
      };
    }
  }
  return null;
}

export async function revokeBearerToken(token: string | undefined | null): Promise<void> {
  if (!token || typeof token !== "string") return;
  const trimmed = token.trim();
  if (!trimmed.startsWith("aura_key_")) return;
  const candidateHash = hashApiKey(trimmed);
  const candidateBuf = Buffer.from(candidateHash, "hex");

  await withRegistryLock(async () => {
    const records = await loadUsersRegistry();
    let changed = false;
    for (let i = 0; i < records.length; i++) {
      const storedHex = records[i].keyHash;
      if (!storedHex) continue;
      const storedBuf = Buffer.from(storedHex, "hex");
      if (storedBuf.length === candidateBuf.length && crypto.timingSafeEqual(storedBuf, candidateBuf)) {
        records[i] = { ...records[i], keyHash: "" };
        changed = true;
      }
    }
    if (changed) {
      await saveUsersRegistry(records);
    }
  });
}

function getSafeUidFileId(uid: string): string {
  const cleanUid = uid.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleanUid || cleanUid.length < 4) {
    throw new Error("Invalid user identifier.");
  }
  return cleanUid;
}

export async function loadChatHistory(uid: string): Promise<StoredChatMessage[]> {
  await ensureDataDir();
  const cleanUid = getSafeUidFileId(uid);
  const filePath = ensureContainedPath(DATA_DIR, `chat_history_${cleanUid}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    return [];
  }
}

export async function saveChatHistory(uid: string, messages: StoredChatMessage[]): Promise<void> {
  const cleanUid = getSafeUidFileId(uid);
  const filePath = ensureContainedPath(DATA_DIR, `chat_history_${cleanUid}.json`);
  await atomicWriteJson(filePath, messages.slice(-200));
}

export async function loadTranscripts(uid: string): Promise<StoredTranscriptRecord[]> {
  await ensureDataDir();
  const cleanUid = getSafeUidFileId(uid);
  const filePath = ensureContainedPath(DATA_DIR, `transcripts_${cleanUid}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    return [];
  }
}

export async function saveTranscripts(uid: string, records: StoredTranscriptRecord[]): Promise<void> {
  const cleanUid = getSafeUidFileId(uid);
  const filePath = ensureContainedPath(DATA_DIR, `transcripts_${cleanUid}.json`);
  await atomicWriteJson(filePath, records.slice(0, 100));
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
