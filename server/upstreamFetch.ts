import { EnvHttpProxyAgent, fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici';

export type NetworkMode = 'direct' | 'proxy';
export type FallbackPolicy = 'auto' | 'none';

interface NetworkConfig {
  mode: NetworkMode;
  proxyUrl?: string;
  dispatcherKey: string;
}

const dispatchers = new Map<string, Dispatcher>();

/**
 * CONNECT/TCP timeout for the proxy tunnel and for direct connections.
 * undici's default is long enough that a single stalled tunnel can eat the SPA's
 * whole startup retry budget (see RETRY_DELAYS_MS in src/auth/config.ts). A short
 * timeout turns a silent stall into a fast, retryable failure.
 */
const CONNECT_TIMEOUT_MS = 5000;

function firstEnvironmentValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function standardProxyEnvironment() {
  return {
    httpProxy: firstEnvironmentValue('HTTP_PROXY', 'http_proxy'),
    httpsProxy: firstEnvironmentValue('HTTPS_PROXY', 'https_proxy'),
    noProxy: firstEnvironmentValue('NO_PROXY', 'no_proxy'),
  };
}

/**
 * Whether a failed mode may fall back to the opposite mode.
 *
 * `auto` (default): fall back only when a proxy is actually configured. On a
 * network that forces all Concur traffic through a proxy, `direct` can never
 * succeed — DNS for the Concur hosts is refused by the corporate resolver and
 * public resolvers are blocked — so the fallback only adds a guaranteed-to-fail
 * round trip and buries the real proxy error under `ENOTFOUND`. Explicit
 * `none` disables it even when a proxy is configured.
 */
function readFallbackPolicy(): FallbackPolicy {
  const raw = process.env.CONCUR_NETWORK_FALLBACK?.trim().toLowerCase();
  if (!raw) return 'auto';
  if (raw === 'auto' || raw === 'none') return raw;
  throw new Error('Invalid CONCUR_NETWORK_FALLBACK: use "auto" or "none"');
}

function hasProxyConfigured(): boolean {
  if (process.env.CONCUR_PROXY_URL?.trim()) return true;
  const legacy = process.env.CONCUR_PROXY?.trim();
  if (legacy && legacy.toLowerCase() !== 'env') return true;
  const fromEnv = standardProxyEnvironment();
  return Boolean(fromEnv.httpProxy || fromEnv.httpsProxy);
}

/** True when the caller may try the mode opposite to `mode` after `mode` failed. */
export function isFallbackAllowed(mode: NetworkMode): boolean {
  if (readFallbackPolicy() === 'none') return false;
  // Direct has no route to fall back *to* unless a proxy exists, and proxy has
  // no route back to direct when the network forbids direct Concur access.
  return mode === 'proxy' ? false : hasProxyConfigured();
}

function resolveNetworkConfig(): NetworkConfig {
  const configuredMode = process.env.CONCUR_NETWORK_MODE?.trim().toLowerCase();
  const legacyProxy = process.env.CONCUR_PROXY?.trim();
  const mode = configuredMode || (legacyProxy ? 'proxy' : 'direct');

  if (mode !== 'direct' && mode !== 'proxy') {
    throw new Error('Invalid CONCUR_NETWORK_MODE: use "direct" or "proxy"');
  }
  if (mode === 'direct') return { mode, dispatcherKey: 'direct' };

  const explicitProxy = process.env.CONCUR_PROXY_URL?.trim()
    || (legacyProxy && legacyProxy.toLowerCase() !== 'env' ? legacyProxy : undefined);
  if (explicitProxy) {
    let proxyUrl: URL;
    try {
      proxyUrl = new URL(explicitProxy);
    } catch {
      throw new Error('Invalid CONCUR_PROXY_URL: expected an http:// or https:// proxy URL');
    }
    if (proxyUrl.protocol !== 'http:' && proxyUrl.protocol !== 'https:') {
      throw new Error('Invalid CONCUR_PROXY_URL: expected an http:// or https:// proxy URL');
    }
    return { mode, proxyUrl: explicitProxy, dispatcherKey: `url:${explicitProxy}` };
  }

  const proxyEnvironment = standardProxyEnvironment();
  if (!proxyEnvironment.httpProxy && !proxyEnvironment.httpsProxy) {
    throw new Error(
      'CONCUR_NETWORK_MODE=proxy requires CONCUR_PROXY_URL or HTTP_PROXY/HTTPS_PROXY environment settings'
    );
  }
  return {
    mode,
    dispatcherKey: `env:${proxyEnvironment.httpProxy ?? ''}|${proxyEnvironment.httpsProxy ?? ''}|${proxyEnvironment.noProxy ?? ''}`,
  };
}

function resolveDispatcher(mode?: NetworkMode): Dispatcher | undefined {
  const config = resolveNetworkConfig();
  const effectiveMode = mode ?? config.mode;
  if (effectiveMode === 'direct') return undefined;

  // When an explicit mode override is provided (e.g. fallback), the proxy URL
  // may not have been captured by resolveNetworkConfig (which resolved 'direct').
  // Resolve it directly from environment in that case.
  const overridden = mode !== undefined && mode !== config.mode;
  const proxyUrl = overridden
    ? (
      process.env.CONCUR_PROXY_URL?.trim()
      || (process.env.CONCUR_PROXY?.trim() && process.env.CONCUR_PROXY.trim().toLowerCase() !== 'env' ? process.env.CONCUR_PROXY.trim() : undefined)
      || undefined
    )
    : config.proxyUrl;

  const dispatcherKey = effectiveMode === 'proxy'
    ? (proxyUrl ? `url:${proxyUrl}` : `env:${config.dispatcherKey.replace(/^env:/, '')}`)
    : 'direct';

  let dispatcher = dispatchers.get(dispatcherKey);
  if (!dispatcher) {
    dispatcher = proxyUrl ? new ProxyAgent({ uri: proxyUrl, connectTimeout: CONNECT_TIMEOUT_MS }) : new EnvHttpProxyAgent({ connectTimeout: CONNECT_TIMEOUT_MS });
    dispatchers.set(dispatcherKey, dispatcher);
  }
  return dispatcher;
}

/**
 * Drop the cached dispatcher for a mode so the next call builds a fresh agent.
 *
 * A pooled tunnel that the proxy has rejected (CONNECT 407, proxy restart,
 * idle-session eviction) keeps failing on the reused socket. undici reports that
 * as `RequestAbortedError: Proxy response (407) !== 200 when HTTP Tunneling`,
 * which is non-recoverable, so the next request in the same mode must not reuse
 * the broken pool.
 */
export function resetUpstreamDispatcher(mode: NetworkMode): void {
  for (const [key, dispatcher] of dispatchers) {
    const isProxy = mode === 'proxy' && key !== 'direct';
    const isDirect = mode === 'direct' && key === 'direct';
    if (!isProxy && !isDirect) continue;
    void dispatcher.close().catch(() => {});
    dispatchers.delete(key);
  }
}

/**
 * The single outbound HTTP entry point for OAuth and every Concur API call.
 * Direct/proxy routing is selected server-side through environment variables.
 */
export function upstreamFetch(
  url: string,
  init: Record<string, unknown>,
  mode?: NetworkMode
): ReturnType<typeof undiciFetch> {
  const dispatcher = resolveDispatcher(mode);
  // Direct mode deliberately passes no dispatcher (undici's global agent), so
  // the connect timeout above only applies to proxy tunnels. A whole-request
  // AbortSignal is not a substitute here: it would also cut off long-lived
  // responses such as receipt-image downloads.
  return undiciFetch(url, (dispatcher ? { ...init, dispatcher } : init) as Parameters<typeof undiciFetch>[1]);
}