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
interface PendingTokenRequest<T> {
  entityId: string;
  generation: number;
  promise: Promise<T>;
}

let inFlight: PendingTokenRequest<string> | null = null;
let refreshPromise: PendingTokenRequest<void> | null = null;
let started = false;
let authGeneration = 0;

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
  const entityId = getActiveEntityId();
  if (inFlight?.entityId === entityId && inFlight.generation === authGeneration) return inFlight.promise;
  return refreshAccessToken();
}

/* ── Core refresh logic ─────────────────────────────────────────────── */

async function requestToken(entityId: string): Promise<TokenEndpointResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    headers: { Accept: 'application/json', ...(entityId ? { 'X-Concur-Entity': entityId } : {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token request failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  const data = (await res.json()) as TokenEndpointResponse;
  if (data.error) throw new Error(data.error);
  if (!data.access_token || !data.expires_at) throw new Error('Token endpoint returned an invalid payload');
  return data;
}

function isCurrentRequest(entityId: string, generation: number): boolean {
  return generation === authGeneration && entityId === getActiveEntityId();
}

function applyToken(data: TokenEndpointResponse) {
  setState({ accessToken: data.access_token, expiresAt: data.expires_at, status: 'ready', error: null });
}

/** Perform the refresh immediately. Dedupes concurrent callers. */
export function refreshAccessToken(): Promise<string> {
  const entityId = getActiveEntityId();
  const generation = authGeneration;
  if (inFlight?.entityId === entityId && inFlight.generation === generation) return inFlight.promise;
  if (snapshot.status === 'ready') setState({ status: 'refreshing' });
  const pending = {} as PendingTokenRequest<string>;
  pending.entityId = entityId;
  pending.generation = generation;
  pending.promise = (async () => {
    try {
      const data = await requestToken(entityId);
      if (!isCurrentRequest(entityId, generation)) throw new Error('Token request was superseded by an entity change.');
      applyToken(data);
      scheduleAutoRefresh();
      return snapshot.accessToken!;
    } finally {
      if (inFlight === pending) inFlight = null;
    }
  })().catch((err: Error) => {
    if (isCurrentRequest(entityId, generation)) setState({ status: 'error', error: err.message });
    throw err;
  });
  inFlight = pending;
  return pending.promise;
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
  const entityId = getActiveEntityId();
  const generation = authGeneration;
  if (refreshPromise?.entityId === entityId && refreshPromise.generation === generation) return refreshPromise.promise;
  const pending = {} as PendingTokenRequest<void>;
  pending.entityId = entityId;
  pending.generation = generation;
  pending.promise = (async () => {
    let nextAttempt = attempt;
    while (isCurrentRequest(entityId, generation)) {
      try {
        setState({ status: 'refreshing' });
        const data = await requestToken(entityId);
        if (!isCurrentRequest(entityId, generation)) return;
        applyToken(data);
        return;
      } catch (err) {
        if (!isCurrentRequest(entityId, generation)) return;
        const message = err instanceof Error ? err.message : String(err);
        if (hasUsableToken() && nextAttempt < MAX_RETRIES - 1) {
          setState({ status: 'ready', error: `Auto-refresh retry ${nextAttempt + 1}: ${message}` });
          await wait(RETRY_DELAYS_MS[nextAttempt]);
          nextAttempt += 1;
          continue;
        }
        setState({ status: 'error', error: message });
        return;
      }
    }
  })().finally(() => {
    if (refreshPromise === pending) refreshPromise = null;
    if (isCurrentRequest(entityId, generation)) scheduleAutoRefresh();
  });
  refreshPromise = pending;
  return pending.promise;
}

/* ── Lifecycle ──────────────────────────────────────────────────────── */

/**
 * Fetch the first token and start the auto-refresh loop. Idempotent.
 *
 * The very first fetch gets bounded backoff retries: a single transient
 * failure (network blip, dev server still warming up) must not leave the app
 * stuck in the error state until someone clicks Retry.
 */
export async function initAuth(): Promise<void> {
  if (started) return;
  started = true;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await refreshAccessToken();
      return;
    } catch {
      if (attempt === MAX_RETRIES) break;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
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
  authGeneration += 1;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  inFlight = null;
  refreshPromise = null;
  started = false;
  setState({ accessToken: null, expiresAt: null, status: 'initializing', error: null });
}
