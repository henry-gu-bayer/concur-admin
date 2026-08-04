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

/**
 * Corporate environments route outbound traffic through a proxy (HTTPS_PROXY).
 * Node's global fetch ignores those env vars; undici's ProxyAgent honors them.
 * Build one dispatcher from the environment and use it for every upstream call.
 */
const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const upstreamFetch = (url: string, init: Record<string, unknown>) =>
  undiciFetch(url, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1]);

export interface ServerAuthConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  refreshToken: string;
}

let cached: { accessToken: string; expiresAt: number; refreshToken: string } | null = null;
let inFlight: Promise<string> | null = null;

const REFRESH_LEEWAY_MS = 5 * 60 * 1000; // refresh 5 min before expiry (matches SPA)

function readConfig(): ServerAuthConfig {
  const cfg = {
    clientId: process.env.CLIENT_ID ?? '',
    clientSecret: process.env.CLIENT_SECRET ?? '',
    baseUrl: (process.env.BASE_URL ?? '').replace(/\/+$/, ''),
    refreshToken: process.env.REFRESH_TOKEN ?? '',
  };
  if (!cfg.clientId || !cfg.clientSecret || !cfg.baseUrl || !cfg.refreshToken) {
    throw new Error('Server auth not configured: set CLIENT_ID, CLIENT_SECRET, BASE_URL, REFRESH_TOKEN in .env');
  }
  return cfg;
}

/** Extract a plain header map from an undici Response. */
function headerMap(headers: { forEach: (cb: (v: string, k: string) => void) => void }): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

async function exchange(cfg: ServerAuthConfig, refreshToken: string) {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const url = `${cfg.baseUrl}/oauth2/v0/token`;
  const requestHeaders = { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Encoding': 'application/json' };

  const start = Date.now();
  const res = await upstreamFetch(url, { method: 'POST', headers: requestHeaders, body: body.toString() });
  const responseTimeMs = Date.now() - start;
  const text = await res.text();

  logTokenExchange(url, {
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

/** Get a valid server-side access token (cached; refreshes near expiry). */
export async function getServerAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - REFRESH_LEEWAY_MS) return cached.accessToken;
  if (inFlight) return inFlight;
  const cfg = readConfig();
  inFlight = (async () => {
    const next = await exchange(cfg, cached?.refreshToken ?? cfg.refreshToken);
    cached = next;
    return next.accessToken;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Force a fresh token (used on 401 retry from the API proxy). */
export async function refreshServerAccessToken(): Promise<string> {
  cached = null;
  return getServerAccessToken();
}

/** Handle GET /auth/token — hand the SPA a valid access token + expiry. */
export async function handleTokenRequest(res: {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
}): Promise<void> {
  try {
    const token = await getServerAccessToken();
    const expiresAt = cached?.expiresAt ?? 0;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ access_token: token, expires_at: expiresAt }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
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
  retried = false
): Promise<void> {
  try {
    const cfg = readConfig();
    const path = (req.url ?? '').replace(/^\/api\/concur/, '') || '/';
    const token = await getServerAccessToken();
    const method = req.method ?? 'GET';
    const upstreamUrl = `${cfg.baseUrl}${path}`;
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

    logApiCall({
      method,
      url: upstreamUrl,
      requestHeaders,
      requestBody: body.toString(),
      response: { status: upstream.status, headers: headerMap(upstream.headers), body: text },
      responseTimeMs,
    });

    if (upstream.status === 401 && !retried) {
      await refreshServerAccessToken();
      return handleApiRequest(req, res, body, true);
    }

    res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: message }));
  }
}
