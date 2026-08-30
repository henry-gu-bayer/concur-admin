import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getActiveEntityId } = vi.hoisted(() => ({ getActiveEntityId: vi.fn<() => string>() }));

vi.mock('../entities/entityStore', () => ({ getActiveEntityId }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function tokenResponse(accessToken: string) {
  return {
    ok: true,
    json: async () => ({ access_token: accessToken, expires_at: Date.now() + 3_600_000 }),
  } as Response;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('token entity isolation', () => {
  it('ignores a previous entity response and keeps the new request in flight', async () => {
    let entityId = 'us-uat';
    getActiveEntityId.mockImplementation(() => entityId);
    const uat = deferred<Response>();
    const production = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(uat.promise).mockReturnValueOnce(production.promise);
    const store = await import('./tokenStore');

    const oldRequest = store.refreshAccessToken();
    expect(fetch).toHaveBeenNthCalledWith(1, '/auth/token', expect.objectContaining({ headers: expect.objectContaining({ 'X-Concur-Entity': 'us-uat' }) }));
    entityId = 'us-production';
    store.selectAuthEntity();
    const currentRequest = store.refreshAccessToken();
    expect(fetch).toHaveBeenNthCalledWith(2, '/auth/token', expect.objectContaining({ headers: expect.objectContaining({ 'X-Concur-Entity': 'us-production' }) }));

    uat.resolve(tokenResponse('uat-token'));
    await expect(oldRequest).rejects.toThrow('superseded');
    expect(store.getSnapshot().accessToken).toBeNull();

    const sameCurrentRequest = store.getValidToken();
    expect(fetch).toHaveBeenCalledTimes(2);
    production.resolve(tokenResponse('production-token'));
    await expect(currentRequest).resolves.toBe('production-token');
    await expect(sameCurrentRequest).resolves.toBe('production-token');
    expect(store.getSnapshot()).toMatchObject({ accessToken: 'production-token', status: 'ready' });
  });
});
