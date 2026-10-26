/**
 * Auth configuration.
 *
 * No secrets live here or anywhere in the client bundle. The OAuth
 * refresh-token exchange runs server-side (see `server/concurAuth.ts`, wired
 * into the Vite dev server), using plain CLIENT_ID / CLIENT_SECRET /
 * BASE_URL / REFRESH_TOKEN keys from `.env`. The SPA only talks to same-origin
 * local endpoints and only ever receives the short-lived access token.
 */

/** Local endpoint that returns { access_token, expires_at }. */
export const TOKEN_ENDPOINT = '/auth/token';

/** Local prefix that proxies to the Concur API with a server-side token. */
export const API_PREFIX = '/api/concur';

/** Seconds before actual expiry to proactively refresh (per requirement). */
export const REFRESH_LEEWAY_SEC = 5 * 60;

/**
 * Retry delays for a failed proactive refresh (exponential backoff).
 *
 * The budget has to outlast a real outage, not just a blip: an observed
 * corporate-proxy failure window lasted ~125 s (7 attempts over ~60 s used to
 * give up and leave the app in the error state mid-outage). These delays cover
 * ~165 s before the UI surfaces a failure the user has to clear manually.
 */
export const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000, 45_000, 60_000];

/**
 * Delay before retry `attempt` (0-based), with ±20 % jitter so parallel tabs
 * don't stampede the proxy in lockstep during a network transition.
 */
export function retryDelayMs(attempt: number): number {
  const base = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}
