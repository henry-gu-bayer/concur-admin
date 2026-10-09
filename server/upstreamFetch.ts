import { EnvHttpProxyAgent, fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici';

export type NetworkMode = 'direct' | 'proxy';

interface NetworkConfig {
  mode: NetworkMode;
  proxyUrl?: string;
  dispatcherKey: string;
}

const dispatchers = new Map<string, Dispatcher>();

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

  // Build dispatcher key based on effective mode
  const dispatcherKey = effectiveMode === 'proxy'
    ? (config.proxyUrl ? `url:${config.proxyUrl}` : `env:${config.dispatcherKey.replace(/^env:/, '')}`)
    : 'direct';

  let dispatcher = dispatchers.get(dispatcherKey);
  if (!dispatcher) {
    dispatcher = config.proxyUrl ? new ProxyAgent(config.proxyUrl) : new EnvHttpProxyAgent();
    dispatchers.set(dispatcherKey, dispatcher);
  }
  return dispatcher;
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
  return undiciFetch(url, (dispatcher ? { ...init, dispatcher } : init) as Parameters<typeof undiciFetch>[1]);
}

