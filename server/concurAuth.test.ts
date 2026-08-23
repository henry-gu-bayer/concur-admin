import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenManager, exchange, handleApiRequest } from './concurAuth';
import type { ConcurEntity } from './entities';

const { undiciFetch, logApiCall, logApiCallFailure, logTokenExchange, logTokenExchangeFailure } = vi.hoisted(() => ({
  undiciFetch: vi.fn(),
  logApiCall: vi.fn(),
  logApiCallFailure: vi.fn(),
  logTokenExchange: vi.fn(),
  logTokenExchangeFailure: vi.fn(),
}));

vi.mock('undici', () => ({
  fetch: undiciFetch,
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
});
