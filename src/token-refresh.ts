import type { CodexAuthFile } from "./types.js";
import { isTokenExpired } from "./jwt.js";

const AUTH_ENDPOINT = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
}

/** Refresh OAuth tokens if the access token is expired */
export async function refreshIfExpired(auth: CodexAuthFile): Promise<{ auth: CodexAuthFile; refreshed: boolean }> {
  if (!isTokenExpired(auth.tokens.access_token)) {
    return { auth, refreshed: false };
  }

  const res = await fetch(AUTH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: auth.tokens.refresh_token,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as RefreshResponse;
  if (!data.access_token || !data.refresh_token || !data.id_token) {
    throw new Error("Token refresh response missing required fields");
  }

  const refreshed: CodexAuthFile = {
    ...auth,
    tokens: {
      ...auth.tokens,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      id_token: data.id_token,
    },
    last_refresh: new Date().toISOString(),
  };

  return { auth: refreshed, refreshed: true };
}
