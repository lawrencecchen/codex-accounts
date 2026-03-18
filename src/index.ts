#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readActiveAuth, writeActiveAuth, listAccounts, saveAccount, findAccount, removeAccount, detectActiveAccount, syncActiveToStore } from "./store.js";
import { extractEmail } from "./jwt.js";
import { refreshIfExpired } from "./token-refresh.js";
import { fetchUsage, formatUsage } from "./usage.js";
import { displayAllUsage, displayAccountList } from "./display.js";
import type { StoredAccount } from "./types.js";

const HELP = `codex-accounts - Manage multiple OpenAI Codex accounts

Usage:
  codex-accounts                  Show usage for all accounts
  codex-accounts add              Add a new account (opens OAuth login)
  codex-accounts import           Import current ~/.codex/auth.json account
  codex-accounts list             List all accounts
  codex-accounts switch <email>   Switch active account
  codex-accounts remove <email>   Remove an account
  codex-accounts status           Show detailed usage for all accounts
  codex-accounts help             Show this help message
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
  const usages = await Promise.all(
    accounts.map(async (account) => {
      try {
        const raw = await fetchUsage(account.auth);
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

  displayAllUsage(usages);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || "status";

  switch (command) {
    case "add":
    case "login":
      await cmdAdd();
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
        console.error("Usage: codex-accounts switch <email>");
        process.exit(1);
      }
      await cmdSwitch(args[1]);
      break;
    case "remove":
    case "rm":
      if (!args[1]) {
        console.error("Usage: codex-accounts remove <email>");
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
            const raw = await fetchUsage(account.auth);
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
