import { API_PREFIX } from '../auth/config';
import { getValidToken } from '../auth/tokenStore';
import { entityRequestHeaders } from '../entities/entityStore';

/**
 * Authenticated fetch for the Concur API.
 *
 * Every API call goes through this — it guarantees a valid access token is
 * present (awaiting/refreshing one if needed) before the request is sent. The
 * token is attached to the same-origin local proxy (`/api/concur/*`), which
 * forwards to Concur. The real client_secret never reaches the browser.
 *
 * The token-availability check happens here even though the proxy also
 * attaches a token server-side: keeping the check client-side lets the UI
 * surface auth state early and keeps a single consistent token in the store.
 *
 * Usage:  const res = await concurFetch('/list/v4/lists');
 */
export async function concurFetch(path: string, init: RequestInit = {}, _retried = false): Promise<Response> {
  const token = await getValidToken(); // checks availability; throws if unavailable
  const p = path.startsWith('http') ? new URL(path).pathname : path;
  const url = `${API_PREFIX}${p.startsWith('/') ? p : `/${p}`}`;

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  for (const [name, value] of Object.entries(entityRequestHeaders())) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const res = await fetch(url, { ...init, headers, cache: 'no-store' });
  return res;
}

/** concurFetch + JSON parse, throwing a descriptive error on non-OK. */
export async function concurGet<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await concurFetch(path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Concur API ${path} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as T;
}
