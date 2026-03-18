import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { StoredAccount, CodexAuthFile } from "./types.js";
import { extractEmail } from "./jwt.js";

const STORE_DIR = join(homedir(), ".codex-accounts");
const ACCOUNTS_DIR = join(STORE_DIR, "accounts");
const CODEX_AUTH_PATH = join(homedir(), ".codex", "auth.json");

function ensureDirs(): void {
  mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

/** Sanitize email for use as filename */
function emailToFilename(email: string): string {
  return email.replace(/[^a-zA-Z0-9._@-]/g, "_") + ".json";
}

/** Read the current active auth from ~/.codex/auth.json */
export function readActiveAuth(): CodexAuthFile | null {
  try {
    const raw = readFileSync(CODEX_AUTH_PATH, "utf-8");
    return JSON.parse(raw) as CodexAuthFile;
  } catch {
    return null;
  }
}

/** Write auth to ~/.codex/auth.json (with backup) */
export function writeActiveAuth(auth: CodexAuthFile): void {
  // Backup existing
  if (existsSync(CODEX_AUTH_PATH)) {
    const backupPath = CODEX_AUTH_PATH + ".bak";
    try {
      renameSync(CODEX_AUTH_PATH, backupPath);
    } catch {
      // Ignore backup failures
    }
  }
  // Atomic write via temp file
  const tmpPath = CODEX_AUTH_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(auth, null, 2), { mode: 0o600 });
  renameSync(tmpPath, CODEX_AUTH_PATH);
}

/** Save an account to the store */
export function saveAccount(account: StoredAccount): void {
  ensureDirs();
  const filename = emailToFilename(account.email);
  const filepath = join(ACCOUNTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(account, null, 2), { mode: 0o600 });
}

/** List all stored accounts */
export function listAccounts(): StoredAccount[] {
  ensureDirs();
  const files = readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith(".json"));
  const accounts: StoredAccount[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(ACCOUNTS_DIR, file), "utf-8");
      accounts.push(JSON.parse(raw) as StoredAccount);
    } catch {
      // Skip corrupted files
    }
  }
  return accounts.sort((a, b) => a.email.localeCompare(b.email));
}

/** Find a stored account by email */
export function findAccount(email: string): StoredAccount | null {
  const filename = emailToFilename(email);
  const filepath = join(ACCOUNTS_DIR, filename);
  try {
    const raw = readFileSync(filepath, "utf-8");
    return JSON.parse(raw) as StoredAccount;
  } catch {
    return null;
  }
}

/** Remove an account from the store */
export function removeAccount(email: string): boolean {
  const filename = emailToFilename(email);
  const filepath = join(ACCOUNTS_DIR, filename);
  try {
    unlinkSync(filepath);
    return true;
  } catch {
    return false;
  }
}

/** Detect which stored account is currently active */
export function detectActiveAccount(): string | null {
  const active = readActiveAuth();
  if (!active) return null;

  // OAuth account: match by email from id_token
  if (active.tokens?.id_token) {
    const email = extractEmail(active.tokens.id_token);
    if (email && findAccount(email)) return email;
  }

  // API key account: match by key prefix
  if (active.OPENAI_API_KEY) {
    const accounts = listAccounts();
    const match = accounts.find(a => a.auth.OPENAI_API_KEY === active.OPENAI_API_KEY);
    if (match) return match.email;
  }

  return null;
}

/** Save-back the current active auth to the stored account (preserves token rotations) */
export function syncActiveToStore(): void {
  const active = readActiveAuth();
  if (!active) return;

  if (active.tokens?.id_token) {
    const email = extractEmail(active.tokens.id_token);
    if (!email) return;
    const existing = findAccount(email);
    if (existing) {
      existing.auth = active;
      saveAccount(existing);
    }
  }
}
