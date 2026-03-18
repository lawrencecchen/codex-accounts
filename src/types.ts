/** Stored account on disk */
export interface StoredAccount {
  /** Email extracted from JWT id_token */
  email: string;
  /** When this account was added */
  addedAt: string;
  /** The auth credentials */
  auth: CodexAuthFile;
}

/** Format of ~/.codex/auth.json */
export interface CodexAuthFile {
  tokens: {
    access_token: string;
    refresh_token: string;
    id_token: string;
    account_id?: string;
  };
  last_refresh: string;
  auth_mode?: string;
  OPENAI_API_KEY?: string;
}

/** JWT claims from id_token */
export interface IdTokenClaims {
  email?: string;
  sub?: string;
  "https://api.openai.com/auth"?: {
    user_id?: string;
    account_id?: string;
  };
  "https://api.openai.com/profile"?: {
    email?: string;
  };
  exp?: number;
  iat?: number;
}

/** Rate limit window from /wham/usage */
export interface RateLimitWindow {
  used_percent: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

/** Rate limit details from /wham/usage */
export interface RateLimitDetails {
  allowed: boolean;
  limit_reached: boolean;
  primary_window?: RateLimitWindow;
  secondary_window?: RateLimitWindow;
}

/** Additional rate limit entry */
export interface AdditionalRateLimit {
  metered_feature?: string;
  limit_name?: string;
  rate_limit: RateLimitDetails;
}

/** Credits info */
export interface CreditsInfo {
  has_credits: boolean;
  unlimited: boolean;
  balance?: string;
}

/** Full response from /wham/usage */
export interface UsageResponse {
  plan_type?: string;
  rate_limit: RateLimitDetails;
  credits?: CreditsInfo;
  additional_rate_limits?: AdditionalRateLimit[];
}

/** Formatted usage for display */
export interface AccountUsage {
  email: string;
  isActive: boolean;
  planType?: string;
  primary?: {
    usedPercent: number;
    windowMinutes: number;
    resetsIn?: string;
  };
  secondary?: {
    usedPercent: number;
    windowMinutes?: number;
    resetsIn?: string;
  };
  additionalLimits?: {
    name: string;
    primary?: { usedPercent: number; resetsIn?: string };
    secondary?: { usedPercent: number; resetsIn?: string };
  }[];
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string;
  };
  error?: string;
}
