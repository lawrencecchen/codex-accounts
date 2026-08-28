import type { AdditionalRateLimit, CodexAuthFile, UsageResponse, AccountUsage } from "./types.js";
import { extractEmail } from "./jwt.js";
import { refreshIfExpired } from "./token-refresh.js";
import { saveAccount, findAccount } from "./store.js";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

/** Format seconds into human-readable duration */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  return parts.length > 0 ? parts.join(" ") : "<1m";
}

function resetAfterSeconds(window: { reset_after_seconds?: number; reset_at?: number }): number | undefined {
  if (window.reset_after_seconds !== undefined) return window.reset_after_seconds;
  if (window.reset_at === undefined) return undefined;
  return Math.max(0, window.reset_at - Math.floor(Date.now() / 1000));
}

/** Refresh auth and persist if needed, returns fresh auth */
export async function ensureFreshAuth(auth: CodexAuthFile): Promise<CodexAuthFile> {
  const { auth: freshAuth, refreshed } = await refreshIfExpired(auth);
  if (refreshed && freshAuth.tokens) {
    const email = extractEmail(freshAuth.tokens.id_token);
    if (email) {
      const stored = findAccount(email);
      if (stored) {
        stored.auth = freshAuth;
        saveAccount(stored);
      }
    }
  }
  return freshAuth;
}

/** Fetch usage for a single (already-refreshed) auth credential */
export async function fetchUsage(auth: CodexAuthFile): Promise<UsageResponse> {
  if (!auth.tokens) {
    throw new Error("Cannot fetch ChatGPT usage for an API-key account; use 'cx usage' instead.");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.tokens.access_token}`,
  };
  if (auth.tokens.account_id) {
    headers["ChatGPT-Account-ID"] = auth.tokens.account_id;
  }

  const res = await fetch(USAGE_URL, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Usage fetch failed (${res.status}): ${body}`);
  }

  return (await res.json()) as UsageResponse;
}

/** Refresh + fetch in one call (convenience for single-account use) */
export async function refreshAndFetchUsage(auth: CodexAuthFile): Promise<UsageResponse> {
  const fresh = await ensureFreshAuth(auth);
  return fetchUsage(fresh);
}

/** Convert raw usage response to display format */
export function formatUsage(
  email: string,
  isActive: boolean,
  usage: UsageResponse
): AccountUsage {
  const result: AccountUsage = {
    email,
    isActive,
    planType: usage.plan_type,
  };

  const rl = usage.rate_limit;

  if (rl.primary_window) {
    const windowMin = rl.primary_window.limit_window_seconds
      ? Math.round(rl.primary_window.limit_window_seconds / 60)
      : 300;
    const resetSeconds = resetAfterSeconds(rl.primary_window);
    result.primary = {
      usedPercent: rl.primary_window.used_percent,
      windowMinutes: windowMin,
      resetsIn: resetSeconds !== undefined ? formatDuration(resetSeconds) : undefined,
      resetAfterSeconds: resetSeconds,
    };
  }

  if (rl.secondary_window) {
    const windowMin = rl.secondary_window.limit_window_seconds
      ? Math.round(rl.secondary_window.limit_window_seconds / 60)
      : undefined;
    const resetSeconds = resetAfterSeconds(rl.secondary_window);
    result.secondary = {
      usedPercent: rl.secondary_window.used_percent,
      windowMinutes: windowMin,
      resetsIn: resetSeconds !== undefined ? formatDuration(resetSeconds) : undefined,
      resetAfterSeconds: resetSeconds,
    };
  }

  const extraLimits = (usage.additional_rate_limits ?? []).filter(arl =>
    shouldShowAdditionalLimit(arl, usage.plan_type),
  );
  if (extraLimits.length) {
    result.additionalLimits = extraLimits.map(arl => ({
      name: arl.limit_name || arl.metered_feature || "unknown",
      primary: arl.rate_limit.primary_window
        ? formatLimitWindow(arl.rate_limit.primary_window)
        : undefined,
      secondary: arl.rate_limit.secondary_window
        ? formatLimitWindow(arl.rate_limit.secondary_window)
        : undefined,
    }));
  }

  if (usage.credits) {
    result.credits = {
      hasCredits: usage.credits.has_credits,
      unlimited: usage.credits.unlimited,
      balance: usage.credits.balance,
    };
  }

  return result;
}

/** Spark is a ChatGPT Pro research preview. /wham/usage still returns a 0% Spark bucket for Plus. */
export function planHasSparkAccess(planType?: string): boolean {
  const plan = (planType ?? "").trim().toLowerCase();
  return plan === "pro" || plan.startsWith("pro_") || plan.startsWith("pro-");
}

export function isSparkAdditionalLimit(limit: AdditionalRateLimit): boolean {
  const haystack = `${limit.limit_name ?? ""} ${limit.metered_feature ?? ""}`.toLowerCase();
  return haystack.includes("spark") || haystack.includes("bengalfox");
}

export function shouldShowAdditionalLimit(limit: AdditionalRateLimit, planType?: string): boolean {
  if (!isSparkAdditionalLimit(limit)) return true;
  return planHasSparkAccess(planType);
}

function formatLimitWindow(window: { used_percent: number; reset_after_seconds?: number; reset_at?: number }) {
  const resetSeconds = resetAfterSeconds(window);
  return {
    usedPercent: window.used_percent,
    resetsIn: resetSeconds !== undefined ? formatDuration(resetSeconds) : undefined,
    resetAfterSeconds: resetSeconds,
  };
}
