import type { CodexAuthFile, UsageResponse, AccountUsage } from "./types.js";
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

/** Refresh auth and persist if needed, returns fresh auth */
export async function ensureFreshAuth(auth: CodexAuthFile): Promise<CodexAuthFile> {
  const { auth: freshAuth, refreshed } = await refreshIfExpired(auth);
  if (refreshed) {
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
    result.primary = {
      usedPercent: rl.primary_window.used_percent,
      windowMinutes: windowMin,
      resetsIn: rl.primary_window.reset_after_seconds
        ? formatDuration(rl.primary_window.reset_after_seconds)
        : rl.primary_window.reset_at
          ? formatDuration(rl.primary_window.reset_at - Math.floor(Date.now() / 1000))
          : undefined,
    };
  }

  if (rl.secondary_window) {
    const windowMin = rl.secondary_window.limit_window_seconds
      ? Math.round(rl.secondary_window.limit_window_seconds / 60)
      : undefined;
    result.secondary = {
      usedPercent: rl.secondary_window.used_percent,
      windowMinutes: windowMin,
      resetsIn: rl.secondary_window.reset_after_seconds
        ? formatDuration(rl.secondary_window.reset_after_seconds)
        : rl.secondary_window.reset_at
          ? formatDuration(rl.secondary_window.reset_at - Math.floor(Date.now() / 1000))
          : undefined,
    };
  }

  if (usage.additional_rate_limits?.length) {
    result.additionalLimits = usage.additional_rate_limits.map(arl => ({
      name: arl.limit_name || arl.metered_feature || "unknown",
      primary: arl.rate_limit.primary_window
        ? {
            usedPercent: arl.rate_limit.primary_window.used_percent,
            resetsIn: arl.rate_limit.primary_window.reset_after_seconds
              ? formatDuration(arl.rate_limit.primary_window.reset_after_seconds)
              : undefined,
          }
        : undefined,
      secondary: arl.rate_limit.secondary_window
        ? {
            usedPercent: arl.rate_limit.secondary_window.used_percent,
            resetsIn: arl.rate_limit.secondary_window.reset_after_seconds
              ? formatDuration(arl.rate_limit.secondary_window.reset_after_seconds)
              : undefined,
          }
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
