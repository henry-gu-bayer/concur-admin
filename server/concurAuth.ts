/**
 * Server-side Concur OAuth + API proxy (Node, runs inside the Vite dev server).
 *
 * Why this exists: the OAuth refresh-token exchange needs CLIENT_SECRET and
 * REFRESH_TOKEN, which must NOT ship to the browser. So the exchange happens
 * here, on the backend. The SPA calls same-origin `/auth/token` and
 * `/api/concur/*`; this module attaches the real credentials and forwards to
 * Concur. The browser only ever sees the short-lived access token.
 *
 * For production, host the same handlers in your real server (Express/Fastify/
 * a serverless function) — the logic is identical; only the transport changes.
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { logApiCall, logTokenExchange } from './logger';
import { createEntityRegistry, type ConcurEntity } from './entities';

/**
 * Corporate environments route outbound traffic through a proxy (HTTPS_PROXY).
 * Node's global fetch ignores those env vars; undici's ProxyAgent honors them.
 * Build one dispatcher from the environment and use it for every upstream call.
 */
const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const upstreamFetch = (url: string, init: Record<string, unknown>) =>
  undiciFetch(url, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1]);

export type TokenState = { accessToken: string; expiresAt: number; refreshToken: string };

const REFRESH_LEEWAY_MS = 5 * 60 * 1000; // refresh 5 min before expiry (matches SPA)

/** Extract a plain header map from an undici Response. */
function headerMap(headers: { forEach: (cb: (v: string, k: string) => void) => void }): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

async function exchange(entity: ConcurEntity, refreshToken: string): Promise<TokenState> {
  const body = new URLSearchParams({
    client_id: entity.clientId,
    client_secret: entity.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const url = `${entity.baseUrl}/oauth2/v0/token`;
  const requestHeaders = { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Encoding': 'application/json' };

  const start = Date.now();
  const res = await upstreamFetch(url, { method: 'POST', headers: requestHeaders, body: body.toString() });
  const responseTimeMs = Date.now() - start;
  const text = await res.text();

  logTokenExchange(entity.id, url, {
    requestHeaders,
    requestBody: body.toString(),
    response: { status: res.status, headers: headerMap(res.headers), body: text },
    responseTimeMs,
  });

  if (!res.ok) {
    throw new Error(`Concur token exchange failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }
  const data = JSON.parse(text) as {
    access_token: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    refresh_token?: string;
  };
  const lifetimeSec = data.refresh_token_expires_in ?? data.expires_in ?? 3600;
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + lifetimeSec * 1000,
    refreshToken: data.refresh_token ?? refreshToken,
  };
}

export function createTokenManager(
  exchangeToken: (entity: ConcurEntity, refreshToken: string) => Promise<TokenState>
): { get: (entity: ConcurEntity) => Promise<string>; refresh: (entity: ConcurEntity) => Promise<string>; expiresAt: (entityId: string) => number } {
  const cached = new Map<string, TokenState>();
  const inFlight = new Map<string, Promise<string>>();
  const get = async (entity: ConcurEntity): Promise<string> => {
    const current = cached.get(entity.id);
    if (current && Date.now() < current.expiresAt - REFRESH_LEEWAY_MS) return current.accessToken;
    const pending = inFlight.get(entity.id);
    if (pending) return pending;
    const next = exchangeToken(entity, current?.refreshToken ?? entity.refreshToken)
      .then((token) => {
        cached.set(entity.id, token);
        return token.accessToken;
      })
      .finally(() => inFlight.delete(entity.id));
    inFlight.set(entity.id, next);
    return next;
  };
  return {
    get,
    refresh: async (entity) => {
      cached.delete(entity.id);
      return get(entity);
    },
    expiresAt: (entityId) => cached.get(entityId)?.expiresAt ?? 0,
  };
}

const tokens = createTokenManager(exchange);
function entityFor(id?: string | null): ConcurEntity {
  return createEntityRegistry().require(id);
}

/** Get a valid server-side access token (cached independently per entity). */
export async function getServerAccessToken(entityId?: string): Promise<string> {
  return tokens.get(entityFor(entityId));
}

/** Force a fresh token for one entity (used on its 401 retry). */
export async function refreshServerAccessToken(entityId?: string): Promise<string> {
  return tokens.refresh(entityFor(entityId));
}

/** Handle GET /auth/token — hand the SPA a valid access token + expiry. */
export async function handleTokenRequest(req: { url?: string }, res: {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
}): Promise<void> {
  try {
    const entityId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('entity');
    if (!entityId?.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Missing required entity query parameter.' }));
      return;
    }
    const entity = entityFor(entityId);
    const token = await tokens.get(entity);
    const expiresAt = tokens.expiresAt(entity.id);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ access_token: token, expires_at: expiresAt }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /Unknown Concur entity/.test(message) ? 404 : 500;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: message }));
  }
}

/** Handle /api/concur/* — proxy to Concur with a server-side Bearer token. */
export async function handleApiRequest(
  req: { method?: string; url?: string; headers: Record<string, unknown> },
  res: {
    writeHead: (code: number, headers: Record<string, string>) => void;
    end: (body?: string) => void;
  },
  body: Buffer,
  retried = false,
  selectedEntity?: string
): Promise<void> {
  try {
    const headerEntity = req.headers['x-concur-entity'];
    const entityId = selectedEntity ?? (typeof headerEntity === 'string' ? headerEntity : '');
    const entity = entityFor(entityId);
    const path = (req.url ?? '').replace(/^\/api\/concur/, '') || '/';
    const token = await tokens.get(entity);
    const method = req.method ?? 'GET';
    const upstreamUrl = `${entity.baseUrl}${path}`;
    const requestHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    const start = Date.now();
    const upstream = await upstreamFetch(upstreamUrl, {
      method,
      headers: requestHeaders,
      body: body.length && method !== 'GET' && method !== 'HEAD' ? body : undefined,
    });
    const responseTimeMs = Date.now() - start;
    const text = await upstream.text();

    logApiCall(entity.id, {
      method,
      url: upstreamUrl,
      requestHeaders,
      requestBody: body.toString(),
      response: { status: upstream.status, headers: headerMap(upstream.headers), body: text },
      responseTimeMs,
    });

    if (upstream.status === 401 && !retried) {
      await tokens.refresh(entity);
      return handleApiRequest(req, res, body, true, entity.id);
    }

    res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /Unknown Concur entity/.test(message) ? 404 : 500;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: message }));
  }
}
