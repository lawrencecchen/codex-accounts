import type { AccountUsage } from "./types.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_GREEN = "\x1b[42m";
const BG_YELLOW = "\x1b[43m";
const BG_RED = "\x1b[41m";
const BG_GRAY = "\x1b[100m";

/** Get color based on usage percentage */
function usageColor(usedPercent: number): string {
  if (usedPercent >= 90) return RED;
  if (usedPercent >= 70) return YELLOW;
  return GREEN;
}

function barBgColor(usedPercent: number): string {
  if (usedPercent >= 90) return BG_RED;
  if (usedPercent >= 70) return BG_YELLOW;
  return BG_GREEN;
}

/** Render a usage bar */
function renderBar(usedPercent: number, width: number = 20): string {
  const filled = Math.round((usedPercent / 100) * width);
  const empty = width - filled;
  const bg = barBgColor(usedPercent);
  return `${bg}${" ".repeat(filled)}${BG_GRAY}${" ".repeat(empty)}${RESET}`;
}

interface Row {
  label: string;
  usedPercent: number;
  resetsIn?: string;
}

/** Collect all display rows for an account */
function collectRows(usage: AccountUsage): Row[] {
  const rows: Row[] = [];

  if (usage.primary) {
    const windowLabel = usage.primary.windowMinutes >= 60
      ? `${Math.round(usage.primary.windowMinutes / 60)}h limit`
      : `${usage.primary.windowMinutes}m limit`;
    rows.push({ label: windowLabel, usedPercent: usage.primary.usedPercent, resetsIn: usage.primary.resetsIn });
  }

  if (usage.secondary) {
    const windowLabel = usage.secondary.windowMinutes
      ? usage.secondary.windowMinutes >= 1440
        ? `${Math.round(usage.secondary.windowMinutes / 1440)}d limit`
        : `${Math.round(usage.secondary.windowMinutes / 60)}h limit`
      : "Weekly limit";
    rows.push({ label: windowLabel, usedPercent: usage.secondary.usedPercent, resetsIn: usage.secondary.resetsIn });
  }

  if (usage.additionalLimits?.length) {
    for (const limit of usage.additionalLimits) {
      if (limit.primary) {
        rows.push({ label: limit.name, usedPercent: limit.primary.usedPercent, resetsIn: limit.primary.resetsIn });
      }
      if (limit.secondary) {
        rows.push({ label: `${limit.name} (weekly)`, usedPercent: limit.secondary.usedPercent, resetsIn: limit.secondary.resetsIn });
      }
    }
  }

  return rows;
}

function formatDisplayName(email: string): string {
  return email.startsWith("apikey:")
    ? `${email.slice(7)} ${DIM}(api key)${RESET}`
    : email;
}

/** Display a single account's usage */
function displayAccount(usage: AccountUsage, globalLabelWidth: number, index?: number): void {
  const activeMarker = usage.isActive ? ` ${CYAN}(active)${RESET}` : "";
  const plan = usage.planType ? ` ${DIM}[${usage.planType}]${RESET}` : "";
  const prefix = index !== undefined ? `${DIM}${index})${RESET} ` : "";

  const displayName = formatDisplayName(usage.email);
  console.log(`${prefix}${BOLD}${WHITE}${displayName}${RESET}${plan}${activeMarker}`);

  if (usage.error) {
    console.log(`  ${RED}Error: ${usage.error}${RESET}`);
    console.log();
    return;
  }

  const rows = collectRows(usage);

  for (const row of rows) {
    const padded = row.label.padEnd(globalLabelWidth);
    const pct = row.usedPercent;
    const remaining = (100 - pct).toFixed(1);
    const color = usageColor(pct);
    const resetStr = row.resetsIn ? ` ${DIM}resets in ${row.resetsIn}${RESET}` : "";
    console.log(`  ${DIM}${padded}:${RESET} ${renderBar(pct)} ${color}${remaining}% left${RESET}${resetStr}`);
  }

  if (usage.credits) {
    const padded = "Credits".padEnd(globalLabelWidth);
    if (usage.credits.unlimited) {
      console.log(`  ${DIM}${padded}:${RESET} ${GREEN}Unlimited${RESET}`);
    } else if (usage.credits.balance) {
      console.log(`  ${DIM}${padded}:${RESET} $${usage.credits.balance}`);
    }
  }

  console.log();
}

/** Display usage for all accounts */
export function displayAllUsage(usages: AccountUsage[]): void {
  if (usages.length === 0) {
    console.log(`${DIM}No accounts configured. Run 'codex-accounts add' to add one.${RESET}`);
    return;
  }

  // Find the max label width across ALL accounts so everything aligns
  let maxLabelWidth = 0;
  for (const usage of usages) {
    if (usage.error) continue;
    const rows = collectRows(usage);
    for (const row of rows) {
      maxLabelWidth = Math.max(maxLabelWidth, row.label.length);
    }
    if (usage.credits) {
      maxLabelWidth = Math.max(maxLabelWidth, "Credits".length);
    }
  }

  console.log();
  for (const usage of usages) {
    displayAccount(usage, maxLabelWidth);
  }
}

/** Display usage for all accounts with numbered indices for interactive selection */
export function displayAllUsageNumbered(usages: AccountUsage[]): void {
  if (usages.length === 0) {
    console.log(`${DIM}No accounts configured. Run 'cx add' to add one.${RESET}`);
    return;
  }

  let maxLabelWidth = 0;
  for (const usage of usages) {
    if (usage.error) continue;
    const rows = collectRows(usage);
    for (const row of rows) {
      maxLabelWidth = Math.max(maxLabelWidth, row.label.length);
    }
    if (usage.credits) {
      maxLabelWidth = Math.max(maxLabelWidth, "Credits".length);
    }
  }

  console.log();
  for (let i = 0; i < usages.length; i++) {
    displayAccount(usages[i]!, maxLabelWidth, i + 1);
  }
}

/** Display a simple account list */
export function displayAccountList(accounts: { email: string; isActive: boolean; addedAt: string }[]): void {
  if (accounts.length === 0) {
    console.log(`${DIM}No accounts configured. Run 'codex-accounts add' to add one.${RESET}`);
    return;
  }

  console.log();
  for (const acct of accounts) {
    const marker = acct.isActive ? `${CYAN} *${RESET}` : "";
    const date = new Date(acct.addedAt).toLocaleDateString();
    const displayName = formatDisplayName(acct.email);
    console.log(`  ${WHITE}${displayName}${RESET}${marker} ${DIM}(added ${date})${RESET}`);
  }
  console.log();
  console.log(`${DIM}* = currently active in ~/.codex/auth.json${RESET}`);
  console.log();
}
