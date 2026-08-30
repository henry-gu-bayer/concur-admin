import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenManager, exchange, handleApiRequest, handleTokenRequest } from './concurAuth';
import type { ConcurEntity } from './entities';

const { undiciFetch, logApiCall, logApiCallFailure, logTokenExchange, logTokenExchangeFailure, ProxyAgent, EnvHttpProxyAgent } = vi.hoisted(() => ({
  undiciFetch: vi.fn(),
  logApiCall: vi.fn(),
  logApiCallFailure: vi.fn(),
  logTokenExchange: vi.fn(),
  logTokenExchangeFailure: vi.fn(),
  ProxyAgent: class { constructor(public uri: string) {} },
  EnvHttpProxyAgent: class {},
}));

vi.mock('undici', () => ({
  fetch: undiciFetch,
  ProxyAgent,
  EnvHttpProxyAgent,
}));

vi.mock('./logger', () => ({
  logApiCall,
  logApiCallFailure,
  logTokenExchange,
  logTokenExchangeFailure,
}));

const us: ConcurEntity = {
  id: 'us-uat',
  label: 'US UAT',
  baseUrl: 'https://us.example.test',
  clientId: 'us-client',
  clientSecret: 'us-secret',
  refreshToken: 'us-refresh',
};

const eu: ConcurEntity = {
  ...us,
  id: 'eu-prod',
  label: 'Europe Production',
  baseUrl: 'https://eu.example.test',
  clientId: 'eu-client',
  refreshToken: 'eu-refresh',
};

describe('entity-scoped token manager', () => {
  it('caches and refreshes access tokens independently per entity', async () => {
    const exchange = vi.fn(async (entity: ConcurEntity, refreshToken: string) => ({
      accessToken: `${entity.id}-${refreshToken}-token`,
      refreshToken,
      expiresAt: Date.now() + 60 * 60 * 1000,
    }));
    const tokens = createTokenManager(exchange);

    await expect(tokens.get(us)).resolves.toBe('us-uat-us-refresh-token');
    await expect(tokens.get(us)).resolves.toBe('us-uat-us-refresh-token');
    await expect(tokens.get(eu)).resolves.toBe('eu-prod-eu-refresh-token');
    await expect(tokens.refresh(us)).resolves.toBe('us-uat-us-refresh-token');

    expect(exchange).toHaveBeenCalledTimes(3);
    expect(exchange).toHaveBeenNthCalledWith(1, us, 'us-refresh');
    expect(exchange).toHaveBeenNthCalledWith(2, eu, 'eu-refresh');
    expect(exchange).toHaveBeenNthCalledWith(3, us, 'us-refresh');
  });
});

describe('token endpoint entity selection', () => {
  beforeEach(() => {
    undiciFetch.mockReset();
    vi.stubEnv('CONCUR_ENTITIES', 'us-uat,eu-prod');
    for (const entity of [us, eu]) {
      const prefix = `CONCUR_${entity.id.toUpperCase().replace(/-/g, '_')}`;
      vi.stubEnv(`${prefix}_BASE_URL`, entity.baseUrl);
      vi.stubEnv(`${prefix}_CLIENT_ID`, entity.clientId);
      vi.stubEnv(`${prefix}_CLIENT_SECRET`, entity.clientSecret);
      vi.stubEnv(`${prefix}_REFRESH_TOKEN`, entity.refreshToken);
    }
  });

  afterEach(() => vi.unstubAllEnvs());

  it('rejects conflicting header and query entity selectors', async () => {
    const res = { writeHead: vi.fn(), end: vi.fn() };
    await handleTokenRequest({ url: '/auth/token?entity=us-uat', headers: { 'x-concur-entity': 'eu-prod' } }, res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(undiciFetch).not.toHaveBeenCalled();
  });
});

function httpResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { forEach: (cb: (value: string, key: string) => void) => cb('application/json', 'content-type') },
  };
}

describe('token exchange logging', () => {
  beforeEach(() => {
    undiciFetch.mockReset();
    logTokenExchange.mockReset();
    logTokenExchangeFailure.mockReset();
  });

  it('logs the exchange when Concur returns an HTTP response', async () => {
    undiciFetch.mockResolvedValue(httpResponse({ access_token: 'tok', expires_in: 3600 }));

    await expect(exchange(us, 'us-refresh')).resolves.toMatchObject({ accessToken: 'tok' });
    expect(undiciFetch).toHaveBeenCalledWith(
      'https://us.example.test/oauth2/v0/token',
      expect.not.objectContaining({ dispatcher: expect.anything() }),
    );
    expect(logTokenExchange).toHaveBeenCalledWith(
      'us-uat',
      'https://us.example.test/oauth2/v0/token',
      expect.objectContaining({ response: expect.objectContaining({ status: 200 }) })
    );
    expect(logTokenExchangeFailure).not.toHaveBeenCalled();
  });

  it('logs a synthetic entry and rethrows when the exchange fails before any response', async () => {
    undiciFetch.mockRejectedValue(new Error('connect ETIMEDOUT 10.0.0.1:443'));

    await expect(exchange(us, 'us-refresh')).rejects.toThrow('connect ETIMEDOUT');
    expect(logTokenExchangeFailure).toHaveBeenCalledWith(
      'us-uat',
      'https://us.example.test/oauth2/v0/token',
      expect.objectContaining({
        error: 'connect ETIMEDOUT 10.0.0.1:443',
        responseTimeMs: expect.any(Number),
      })
    );
    expect(logTokenExchange).not.toHaveBeenCalled();
  });
});

describe('upstream network selection', () => {
  beforeEach(() => {
    undiciFetch.mockReset();
    undiciFetch.mockResolvedValue(httpResponse({ access_token: 'tok', expires_in: 3600 }));
    logTokenExchange.mockReset();
    logTokenExchangeFailure.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('connects directly when CONCUR_NETWORK_MODE=direct even if proxy env vars exist', async () => {
    vi.stubEnv('CONCUR_NETWORK_MODE', 'direct');
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example:8080');

    await expect(exchange(us, 'us-refresh')).resolves.toMatchObject({ accessToken: 'tok' });
    expect(undiciFetch.mock.calls[0][1].dispatcher).toBeUndefined();
  });

  it('routes through CONCUR_PROXY_URL when proxy mode is enabled', async () => {
    vi.stubEnv('CONCUR_NETWORK_MODE', 'proxy');
    vi.stubEnv('CONCUR_PROXY_URL', 'http://user:pass@proxy.example:8080');

    await expect(exchange(us, 'us-refresh')).resolves.toMatchObject({ accessToken: 'tok' });
    const init = undiciFetch.mock.calls[0][1];
    expect(init.dispatcher).toBeInstanceOf(ProxyAgent);
    expect(init.dispatcher.uri).toBe('http://user:pass@proxy.example:8080');
  });

  it('delegates to standard HTTP(S)_PROXY env vars in proxy mode', async () => {
    vi.stubEnv('CONCUR_NETWORK_MODE', 'proxy');
    vi.stubEnv('CONCUR_PROXY_URL', '');
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example:8080');

    await expect(exchange(us, 'us-refresh')).resolves.toMatchObject({ accessToken: 'tok' });
    expect(undiciFetch.mock.calls[0][1].dispatcher).toBeInstanceOf(EnvHttpProxyAgent);
  });

  it('keeps legacy CONCUR_PROXY=env behavior when the new mode is unset', async () => {
    vi.stubEnv('CONCUR_NETWORK_MODE', '');
    vi.stubEnv('CONCUR_PROXY', 'env');
    vi.stubEnv('HTTP_PROXY', 'http://proxy.example:8080');

    await expect(exchange(us, 'us-refresh')).resolves.toMatchObject({ accessToken: 'tok' });
    expect(undiciFetch.mock.calls[0][1].dispatcher).toBeInstanceOf(EnvHttpProxyAgent);
  });

  it('rejects an invalid explicit proxy URL', async () => {
    vi.stubEnv('CONCUR_NETWORK_MODE', 'proxy');
    vi.stubEnv('CONCUR_PROXY_URL', 'not a url');

    await expect(exchange(us, 'us-refresh')).rejects.toThrow('Invalid CONCUR_PROXY_URL');
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('rejects proxy mode when no proxy source is configured', async () => {
    vi.stubEnv('CONCUR_NETWORK_MODE', 'proxy');
    vi.stubEnv('CONCUR_PROXY_URL', '');
    vi.stubEnv('CONCUR_PROXY', '');
    vi.stubEnv('HTTP_PROXY', '');
    vi.stubEnv('HTTPS_PROXY', '');
    vi.stubEnv('http_proxy', '');
    vi.stubEnv('https_proxy', '');

    await expect(exchange(us, 'us-refresh')).rejects.toThrow('requires CONCUR_PROXY_URL or HTTP_PROXY/HTTPS_PROXY');
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('rejects an unknown network mode', async () => {
    vi.stubEnv('CONCUR_NETWORK_MODE', 'automatic');

    await expect(exchange(us, 'us-refresh')).rejects.toThrow('Invalid CONCUR_NETWORK_MODE');
    expect(undiciFetch).not.toHaveBeenCalled();
  });
});

describe('proxied API failure logging', () => {
  beforeEach(() => {
    vi.stubEnv('CONCUR_ENTITIES', 'us-uat');
    vi.stubEnv('CONCUR_US_UAT_BASE_URL', 'https://us.example.test');
    vi.stubEnv('CONCUR_US_UAT_CLIENT_ID', 'us-client');
    vi.stubEnv('CONCUR_US_UAT_CLIENT_SECRET', 'us-secret');
    vi.stubEnv('CONCUR_US_UAT_REFRESH_TOKEN', 'us-refresh');
    logApiCall.mockReset();
    logApiCallFailure.mockReset();
    logTokenExchange.mockReset();
    logTokenExchangeFailure.mockReset();
    undiciFetch.mockImplementation((url: string) =>
      url.includes('/oauth2/v0/token')
        ? Promise.resolve(httpResponse({ access_token: 'tok', expires_in: 3600 }))
        : Promise.reject(new Error('socket hang up'))
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('logs a synthetic entry when the upstream API call fails before any response', async () => {
    const res = { writeHead: vi.fn(), end: vi.fn() };

    await handleApiRequest(
      { method: 'GET', url: '/api/concur/profile/spend/v4.1/Users/x', headers: { 'x-concur-entity': 'us-uat' } },
      res,
      Buffer.alloc(0)
    );

    expect(logApiCallFailure).toHaveBeenCalledWith(
      'us-uat',
      expect.objectContaining({
        method: 'GET',
        url: 'https://us.example.test/profile/spend/v4.1/Users/x',
        error: 'socket hang up',
        responseTimeMs: expect.any(Number),
      })
    );
    expect(logApiCall).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(500, expect.objectContaining({ 'Content-Type': 'application/json' }));
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('socket hang up'));
  });

  it('preserves request and response content types through the proxy', async () => {
    undiciFetch.mockImplementation((url: string) => {
      if (url.includes('/oauth2/v0/token')) return Promise.resolve(httpResponse({ access_token: 'tok', expires_in: 3600 }));
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('<result>ok</result>'),
        headers: { forEach: (callback: (value: string, key: string) => void) => callback('application/xml; charset=utf-8', 'content-type') },
      });
    });
    const res = { writeHead: vi.fn(), end: vi.fn() };

    await handleApiRequest(
      { method: 'POST', url: '/api/concur/xml-endpoint', headers: { 'x-concur-entity': 'us-uat', 'content-type': 'application/xml', accept: 'application/xml' } },
      res,
      Buffer.from('<request/>')
    );

    const apiCall = undiciFetch.mock.calls.find(([url]) => String(url).endsWith('/xml-endpoint'));
    expect(apiCall?.[1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/xml', Accept: 'application/xml' }) }));
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/xml; charset=utf-8' }));
    expect(res.end).toHaveBeenCalledWith('<result>ok</result>');
  });

  it('forwards binary response bytes without JSON coercion', async () => {
    const bytes = Uint8Array.from([0, 255, 10, 42]);
    undiciFetch.mockImplementation((url: string) => {
      if (url.includes('/oauth2/v0/token')) return Promise.resolve(httpResponse({ access_token: 'tok', expires_in: 3600 }));
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(bytes.buffer),
        headers: { forEach: (callback: (value: string, key: string) => void) => callback('application/octet-stream', 'content-type') },
      });
    });
    const res = { writeHead: vi.fn(), end: vi.fn() };

    await handleApiRequest(
      { method: 'GET', url: '/api/concur/receipt.bin', headers: { 'x-concur-entity': 'us-uat' } },
      res,
      Buffer.alloc(0)
    );

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/octet-stream' }));
    expect(res.end).toHaveBeenCalledWith(Buffer.from(bytes));
  });
});
