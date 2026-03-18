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
  const remaining = 100 - usedPercent;
  const filled = Math.round((usedPercent / 100) * width);
  const empty = width - filled;
  const bg = barBgColor(usedPercent);
  return `${bg}${" ".repeat(filled)}${BG_GRAY}${" ".repeat(empty)}${RESET}`;
}

/** Display a single account's usage */
function displayAccount(usage: AccountUsage): void {
  const activeMarker = usage.isActive ? ` ${CYAN}(active)${RESET}` : "";
  const plan = usage.planType ? ` ${DIM}[${usage.planType}]${RESET}` : "";

  console.log(`${BOLD}${WHITE}${usage.email}${RESET}${plan}${activeMarker}`);

  if (usage.error) {
    console.log(`  ${RED}Error: ${usage.error}${RESET}`);
    console.log();
    return;
  }

  if (usage.primary) {
    const pct = usage.primary.usedPercent;
    const remaining = (100 - pct).toFixed(1);
    const windowLabel = usage.primary.windowMinutes >= 60
      ? `${Math.round(usage.primary.windowMinutes / 60)}h`
      : `${usage.primary.windowMinutes}m`;
    const resetStr = usage.primary.resetsIn ? ` ${DIM}resets in ${usage.primary.resetsIn}${RESET}` : "";
    const color = usageColor(pct);
    console.log(`  ${windowLabel} limit:  ${renderBar(pct)} ${color}${remaining}% left${RESET}${resetStr}`);
  }

  if (usage.secondary) {
    const pct = usage.secondary.usedPercent;
    const remaining = (100 - pct).toFixed(1);
    const windowLabel = usage.secondary.windowMinutes
      ? usage.secondary.windowMinutes >= 1440
        ? `${Math.round(usage.secondary.windowMinutes / 1440)}d`
        : `${Math.round(usage.secondary.windowMinutes / 60)}h`
      : "Weekly";
    const resetStr = usage.secondary.resetsIn ? ` ${DIM}resets in ${usage.secondary.resetsIn}${RESET}` : "";
    const color = usageColor(pct);
    console.log(`  ${windowLabel} limit: ${renderBar(pct)} ${color}${remaining}% left${RESET}${resetStr}`);
  }

  if (usage.additionalLimits?.length) {
    for (const limit of usage.additionalLimits) {
      if (limit.primary) {
        const pct = limit.primary.usedPercent;
        const remaining = (100 - pct).toFixed(1);
        const color = usageColor(pct);
        const resetStr = limit.primary.resetsIn ? ` ${DIM}resets in ${limit.primary.resetsIn}${RESET}` : "";
        console.log(`  ${DIM}${limit.name}:${RESET} ${renderBar(pct)} ${color}${remaining}% left${RESET}${resetStr}`);
      }
      if (limit.secondary) {
        const pct = limit.secondary.usedPercent;
        const remaining = (100 - pct).toFixed(1);
        const color = usageColor(pct);
        const resetStr = limit.secondary.resetsIn ? ` ${DIM}resets in ${limit.secondary.resetsIn}${RESET}` : "";
        console.log(`  ${DIM}${limit.name} (weekly):${RESET} ${renderBar(pct)} ${color}${remaining}% left${RESET}${resetStr}`);
      }
    }
  }

  if (usage.credits) {
    if (usage.credits.unlimited) {
      console.log(`  ${DIM}Credits:${RESET} ${GREEN}Unlimited${RESET}`);
    } else if (usage.credits.balance) {
      console.log(`  ${DIM}Credits:${RESET} $${usage.credits.balance}`);
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

  console.log();
  for (const usage of usages) {
    displayAccount(usage);
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
    console.log(`  ${WHITE}${acct.email}${RESET}${marker} ${DIM}(added ${date})${RESET}`);
  }
  console.log();
  console.log(`${DIM}* = currently active in ~/.codex/auth.json${RESET}`);
  console.log();
}
