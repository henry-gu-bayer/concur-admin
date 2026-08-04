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

/** Retry delays for a failed proactive refresh (exponential backoff). */
export const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];
