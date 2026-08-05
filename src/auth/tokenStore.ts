import { REFRESH_LEEWAY_SEC, RETRY_DELAYS_MS, TOKEN_ENDPOINT } from './config';
import { getActiveEntityId } from '../entities/entityStore';

/**
 * Token store — the single source of truth for the Concur access token.
 *
 * The OAuth exchange happens server-side; this store simply calls the local
 * `/auth/token` endpoint (which holds the real credentials) and manages:
 *  - global reactive access (subscribe/getSnapshot for useSyncExternalStore)
 *  - `getValidToken()` for imperative API calls — awaits a valid token
 *  - auto-refresh REFRESH_LEEWAY_SEC before expiry, with retry-on-failure
 *
 * Nothing else in the app should hold or refresh the token.
 */

export type TokenStatus = 'initializing' | 'ready' | 'refreshing' | 'error';

export interface TokenSnapshot {
  accessToken: string | null;
  /** epoch ms when the current access token expires (null until first token) */
  expiresAt: number | null;
  status: TokenStatus;
  error: string | null;
}

interface TokenEndpointResponse {
  access_token: string;
  /** epoch ms at which the access token expires */
  expires_at: number;
  error?: string;
}

const MAX_RETRIES = RETRY_DELAYS_MS.length;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let snapshot: TokenSnapshot = { accessToken: null, expiresAt: null, status: 'initializing', error: null };
const listeners = new Set<() => void>();

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<string> | null = null;
let refreshPromise: Promise<void> | null = null;
let started = false;

function setState(patch: Partial<TokenSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

/* ── React store API ─────────────────────────────────────────────────── */

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): TokenSnapshot {
  return snapshot;
}

/* ── Imperative API for other modules ───────────────────────────────── */

/** True when a token exists and is not within the refresh leeway of expiry. */
export function hasUsableToken(): boolean {
  if (!snapshot.accessToken || !snapshot.expiresAt) return false;
  return Date.now() < snapshot.expiresAt - REFRESH_LEEWAY_SEC * 1000;
}

/**
 * Returns a valid access token, waiting for one to be fetched if necessary.
 * Throws if the token cannot be obtained. Every API call should go through
 * this before issuing its request.
 */
export async function getValidToken(): Promise<string> {
  if (hasUsableToken()) return snapshot.accessToken!;
  if (inFlight) return inFlight;
  return refreshAccessToken();
}

/* ── Core refresh logic ─────────────────────────────────────────────── */

async function requestToken(): Promise<TokenEndpointResponse> {
  const entityId = getActiveEntityId();
  const endpoint = entityId ? `${TOKEN_ENDPOINT}?entity=${encodeURIComponent(entityId)}` : TOKEN_ENDPOINT;
  const res = await fetch(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token request failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  const data = (await res.json()) as TokenEndpointResponse;
  if (data.error) throw new Error(data.error);
  if (!data.access_token || !data.expires_at) throw new Error('Token endpoint returned an invalid payload');
  return data;
}

function applyToken(data: TokenEndpointResponse) {
  setState({ accessToken: data.access_token, expiresAt: data.expires_at, status: 'ready', error: null });
}

/** Perform the refresh immediately. Dedupes concurrent callers. */
export function refreshAccessToken(): Promise<string> {
  if (inFlight) return inFlight;
  if (snapshot.status === 'ready') setState({ status: 'refreshing' });
  inFlight = (async () => {
    try {
      const data = await requestToken();
      applyToken(data);
      scheduleAutoRefresh();
      return snapshot.accessToken!;
    } finally {
      inFlight = null;
    }
  })().catch((err: Error) => {
    setState({ status: 'error', error: err.message });
    throw err;
  });
  return inFlight;
}

/** Proactive refresh with bounded retries; keeps the old token on failure. */
function scheduleAutoRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!snapshot.expiresAt) return;
  const fireIn = Math.max(0, snapshot.expiresAt - REFRESH_LEEWAY_SEC * 1000 - Date.now());
  refreshTimer = setTimeout(() => {
    void proactiveRefresh(0);
  }, fireIn);
}

async function proactiveRefresh(attempt: number): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      setState({ status: 'refreshing' });
      const data = await requestToken();
      applyToken(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stillValid = hasUsableToken();
      if (stillValid && attempt < MAX_RETRIES - 1) {
        setState({ status: 'ready', error: `Auto-refresh retry ${attempt + 1}: ${message}` });
        await wait(RETRY_DELAYS_MS[attempt]);
        return proactiveRefresh(attempt + 1);
      }
      setState({ status: 'error', error: message });
    } finally {
      refreshPromise = null;
      scheduleAutoRefresh();
    }
  })();
  return refreshPromise;
}

/* ── Lifecycle ──────────────────────────────────────────────────────── */

/** Fetch the first token and start the auto-refresh loop. Idempotent. */
export async function initAuth(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await refreshAccessToken();
  } catch {
    /* error state already set by refreshAccessToken */
  }
}

/** Manual retry hook for the UI (e.g. an error banner button). */
export async function retryAuth(): Promise<void> {
  try {
    await refreshAccessToken();
  } catch {
    /* state already set */
  }
}

/** Reset client-side token state after selecting a different Concur entity. */
export function selectAuthEntity(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  inFlight = null;
  refreshPromise = null;
  started = false;
  setState({ accessToken: null, expiresAt: null, status: 'initializing', error: null });
}
