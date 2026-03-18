#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readActiveAuth, writeActiveAuth, listAccounts, saveAccount, findAccount, removeAccount, detectActiveAccount, syncActiveToStore } from "./store.js";
import { extractEmail } from "./jwt.js";
import { refreshIfExpired } from "./token-refresh.js";
import { fetchUsage, formatUsage, ensureFreshAuth } from "./usage.js";
import { displayAllUsage, displayAllUsageNumbered, displayAccountList } from "./display.js";
import type { StoredAccount, CodexAuthFile } from "./types.js";

const HELP = `cx - Manage multiple OpenAI Codex accounts

Usage:
  cx                    Show usage for all accounts and switch
  cx add                Add a new account (opens OAuth login)
  cx add-key            Add an API key account
  cx import             Import current ~/.codex/auth.json account
  cx list               List all accounts
  cx switch [email]     Switch active account
  cx remove <email>     Remove an account
  cx status             Show usage (non-interactive)
  cx help               Show this help message
`;

/** Run codex login and capture the resulting auth */
async function runCodexLogin(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["login"], {
      stdio: "inherit",
    });
    child.on("error", (err) => {
      reject(new Error(`Failed to run 'codex login': ${err.message}. Is codex installed?`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex login exited with code ${code}`));
      }
    });
  });
}

async function cmdAdd(): Promise<void> {
  // Save current active auth before login overwrites it
  syncActiveToStore();

  console.log("Opening Codex OAuth login...\n");
  await runCodexLogin();

  // Read the new auth that codex login wrote
  const auth = readActiveAuth();
  if (!auth?.tokens?.id_token) {
    console.error("Error: No auth found after login. Make sure codex login completed successfully.");
    process.exit(1);
  }

  const email = extractEmail(auth.tokens.id_token);
  if (!email) {
    console.error("Error: Could not extract email from auth token.");
    process.exit(1);
  }

  // Check if account already exists
  const existing = findAccount(email);
  if (existing) {
    // Update existing account with fresh tokens
    existing.auth = auth;
    saveAccount(existing);
    console.log(`\nUpdated account: ${email}`);
  } else {
    const account: StoredAccount = {
      email,
      addedAt: new Date().toISOString(),
      auth,
    };
    saveAccount(account);
    console.log(`\nAdded account: ${email}`);
  }
}

async function cmdAddKey(): Promise<void> {
  syncActiveToStore();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const label = await new Promise<string>((resolve) => {
    rl.question("Label (e.g. work, personal): ", resolve);
  });
  const key = await new Promise<string>((resolve) => {
    rl.question("API key (sk-...): ", resolve);
  });
  rl.close();

  const trimmedLabel = label.trim();
  const trimmedKey = key.trim();

  if (!trimmedLabel) {
    console.error("Label is required.");
    process.exit(1);
  }
  if (!trimmedKey.startsWith("sk-")) {
    console.error("Invalid API key format (expected sk-...).");
    process.exit(1);
  }

  const auth: CodexAuthFile = {
    tokens: { access_token: "", refresh_token: "", id_token: "" },
    last_refresh: new Date().toISOString(),
    auth_mode: "apikey",
    OPENAI_API_KEY: trimmedKey,
  };

  // Use label as the identifier (prefixed to distinguish from emails)
  const identifier = `apikey:${trimmedLabel}`;
  const existing = findAccount(identifier);
  if (existing) {
    existing.auth = auth;
    saveAccount(existing);
    console.log(`Updated API key account: ${trimmedLabel}`);
  } else {
    const account: StoredAccount = {
      email: identifier,
      addedAt: new Date().toISOString(),
      auth,
    };
    saveAccount(account);
    console.log(`Added API key account: ${trimmedLabel}`);
  }
}

/** Import the currently active account from ~/.codex/auth.json without re-logging in */
async function cmdImport(): Promise<void> {
  const auth = readActiveAuth();
  if (!auth?.tokens?.id_token) {
    console.error("No active Codex auth found in ~/.codex/auth.json.");
    console.error("Run 'codex-accounts add' to log in first.");
    process.exit(1);
  }

  const email = extractEmail(auth.tokens.id_token);
  if (!email) {
    console.error("Could not extract email from current auth token.");
    process.exit(1);
  }

  const existing = findAccount(email);
  if (existing) {
    existing.auth = auth;
    saveAccount(existing);
    console.log(`Updated existing account: ${email}`);
  } else {
    const account: StoredAccount = {
      email,
      addedAt: new Date().toISOString(),
      auth,
    };
    saveAccount(account);
    console.log(`Imported account: ${email}`);
  }
}

/** Auto-import current auth if no accounts stored yet */
function autoImportIfEmpty(): void {
  const accounts = listAccounts();
  if (accounts.length > 0) return;

  const auth = readActiveAuth();
  if (!auth?.tokens?.id_token) return;

  const email = extractEmail(auth.tokens.id_token);
  if (!email) return;

  const account: StoredAccount = {
    email,
    addedAt: new Date().toISOString(),
    auth,
  };
  saveAccount(account);
  console.log(`Auto-imported active account: ${email}\n`);
}

async function cmdList(): Promise<void> {
  const accounts = listAccounts();
  const activeEmail = detectActiveAccount();

  displayAccountList(
    accounts.map(a => ({
      email: a.email,
      isActive: a.email === activeEmail,
      addedAt: a.addedAt,
    }))
  );
}

async function promptSwitch(): Promise<void> {
  const accounts = listAccounts();
  if (accounts.length === 0) {
    console.error("No accounts configured. Run 'codex-accounts add' to add one.");
    process.exit(1);
  }

  const activeEmail = detectActiveAccount();
  console.log();
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i]!;
    const marker = a.email === activeEmail ? " \x1b[36m(active)\x1b[0m" : "";
    const displayName = a.email.startsWith("apikey:")
      ? `${a.email.slice(7)} \x1b[2m(api key)\x1b[0m`
      : a.email;
    console.log(`  ${i + 1}) ${displayName}${marker}`);
  }
  console.log();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question("Switch to (#): ", resolve);
  });
  rl.close();

  const idx = parseInt(answer.trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= accounts.length) {
    // Try as email/partial match
    if (answer.trim()) {
      return cmdSwitch(answer.trim());
    }
    console.error("Invalid selection.");
    process.exit(1);
  }

  return cmdSwitch(accounts[idx]!.email);
}

async function cmdSwitch(email: string): Promise<void> {
  const account = findAccount(email);
  if (!account) {
    // Try partial match
    const all = listAccounts();
    const matches = all.filter(a => a.email.toLowerCase().includes(email.toLowerCase()));
    if (matches.length === 0) {
      console.error(`No account found matching "${email}".`);
      console.error("Run 'codex-accounts list' to see all accounts.");
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Multiple accounts match "${email}":`);
      for (const m of matches) {
        console.error(`  ${m.email}`);
      }
      process.exit(1);
    }
    return cmdSwitch(matches[0]!.email);
  }

  // Save current active auth before switching
  syncActiveToStore();

  // Refresh tokens if needed
  try {
    const { auth, refreshed } = await refreshIfExpired(account.auth);
    if (refreshed) {
      account.auth = auth;
      saveAccount(account);
    }
    writeActiveAuth(auth);
  } catch (err) {
    // Write anyway even if refresh fails
    writeActiveAuth(account.auth);
    console.warn(`Warning: token refresh failed, using cached tokens: ${(err as Error).message}`);
  }

  console.log(`Switched to ${account.email}`);
  console.log("Restart any running Codex sessions to use the new account.");
}

async function cmdRemove(email: string): Promise<void> {
  if (!findAccount(email)) {
    // Try partial match
    const all = listAccounts();
    const matches = all.filter(a => a.email.toLowerCase().includes(email.toLowerCase()));
    if (matches.length === 0) {
      console.error(`No account found matching "${email}".`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Multiple accounts match "${email}":`);
      for (const m of matches) {
        console.error(`  ${m.email}`);
      }
      process.exit(1);
    }
    email = matches[0]!.email;
  }

  removeAccount(email);
  console.log(`Removed account: ${email}`);
}

async function cmdStatus(): Promise<void> {
  autoImportIfEmpty();
  const accounts = listAccounts();
  if (accounts.length === 0) {
    console.log("No accounts configured. Run 'codex-accounts add' to add one.");
    return;
  }

  const activeEmail = detectActiveAccount();

  // Split into OAuth and API key accounts
  const oauthAccounts = accounts.filter(a => a.auth.auth_mode !== "apikey");
  const apiKeyAccounts = accounts.filter(a => a.auth.auth_mode === "apikey");

  // Phase 1: Refresh all OAuth tokens in parallel
  const refreshed = await Promise.all(
    oauthAccounts.map(async (account) => {
      try {
        const freshAuth = await ensureFreshAuth(account.auth);
        return { account, freshAuth, error: undefined };
      } catch (err) {
        return { account, freshAuth: account.auth, error: (err as Error).message };
      }
    })
  );

  // Phase 2: Fetch all OAuth usage in parallel
  const oauthUsages = await Promise.all(
    refreshed.map(async ({ account, freshAuth, error: refreshError }) => {
      if (refreshError) {
        return {
          email: account.email,
          isActive: account.email === activeEmail,
          error: refreshError,
        };
      }
      try {
        const raw = await fetchUsage(freshAuth);
        return formatUsage(account.email, account.email === activeEmail, raw);
      } catch (err) {
        return {
          email: account.email,
          isActive: account.email === activeEmail,
          error: (err as Error).message,
        };
      }
    })
  );

  // API key accounts: no usage available
  const apiKeyUsages = apiKeyAccounts.map(account => ({
    email: account.email,
    isActive: account.email === activeEmail,
    planType: "api key",
  }));

  const usageByEmail = new Map(
    [...oauthUsages, ...apiKeyUsages].map(u => [u.email, u])
  );
  const usages = accounts.map(a => usageByEmail.get(a.email)!);

  displayAllUsage(usages);
}

/** Default interactive mode: show all usage, prompt to switch */
async function cmdDefault(): Promise<void> {
  autoImportIfEmpty();
  const accounts = listAccounts();
  if (accounts.length === 0) {
    console.log("No accounts configured. Run 'cx add' to add one.");
    return;
  }

  const activeEmail = detectActiveAccount();

  const oauthAccounts = accounts.filter(a => a.auth.auth_mode !== "apikey");
  const apiKeyAccounts = accounts.filter(a => a.auth.auth_mode === "apikey");

  const refreshed = await Promise.all(
    oauthAccounts.map(async (account) => {
      try {
        const freshAuth = await ensureFreshAuth(account.auth);
        return { account, freshAuth, error: undefined };
      } catch (err) {
        return { account, freshAuth: account.auth, error: (err as Error).message };
      }
    })
  );

  const oauthUsages = await Promise.all(
    refreshed.map(async ({ account, freshAuth, error: refreshError }) => {
      if (refreshError) {
        return { email: account.email, isActive: account.email === activeEmail, error: refreshError };
      }
      try {
        const raw = await fetchUsage(freshAuth);
        return formatUsage(account.email, account.email === activeEmail, raw);
      } catch (err) {
        return { email: account.email, isActive: account.email === activeEmail, error: (err as Error).message };
      }
    })
  );

  const apiKeyUsages = apiKeyAccounts.map(account => ({
    email: account.email,
    isActive: account.email === activeEmail,
    planType: "api key",
  }));

  // Keep display order consistent: same order as accounts
  const usageByEmail = new Map(
    [...oauthUsages, ...apiKeyUsages].map(u => [u.email, u])
  );
  const usages = accounts.map(a => usageByEmail.get(a.email)!);
  displayAllUsageNumbered(usages);

  // Prompt to switch
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`Switch to (#): `, resolve);
  });
  rl.close();

  const trimmed = answer.trim();
  if (!trimmed) return;

  const idx = parseInt(trimmed, 10) - 1;
  if (idx >= 0 && idx < accounts.length) {
    return cmdSwitch(accounts[idx]!.email);
  }

  // Try as email/partial match
  if (trimmed) {
    return cmdSwitch(trimmed);
  }

  console.error("Invalid selection.");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    await cmdDefault();
    return;
  }

  switch (command) {
    case "add":
    case "login":
      await cmdAdd();
      break;
    case "add-key":
    case "add-api-key":
      await cmdAddKey();
      break;
    case "import":
      await cmdImport();
      break;
    case "list":
    case "ls":
      await cmdList();
      break;
    case "switch":
    case "use":
      if (!args[1]) {
        await promptSwitch();
      } else {
        await cmdSwitch(args[1]);
      }
      break;
    case "remove":
    case "rm":
      if (!args[1]) {
        console.error("Usage: cx remove <email>");
        process.exit(1);
      }
      await cmdRemove(args[1]);
      break;
    case "status":
    case "usage":
      await cmdStatus();
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    default:
      // If arg looks like an email, treat as status for that account
      if (command.includes("@")) {
        const account = findAccount(command);
        if (account) {
          try {
            const fresh = await ensureFreshAuth(account.auth);
            const raw = await fetchUsage(fresh);
            const usage = formatUsage(account.email, account.email === detectActiveAccount(), raw);
            displayAllUsage([usage]);
          } catch (err) {
            console.error(`Error fetching usage for ${command}: ${(err as Error).message}`);
            process.exit(1);
          }
        } else {
          console.error(`No account found for ${command}.`);
          process.exit(1);
        }
      } else {
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
      }
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
