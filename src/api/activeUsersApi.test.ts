import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveUsersProgress, getActiveUsersSnapshot, getActiveUsersSummary, queryActiveUsersLocal, refreshActiveUsersSnapshot } from './activeUsersApi';

afterEach(() => vi.unstubAllGlobals());

describe('active users snapshot API', () => {
  it('loads the current entity snapshot', async () => {
    const snapshot = { entityId: 'us-production', retrievedAt: '2026-08-29T00:00:00Z', count: 1, pageCount: 1, profiles: [{ id: 'one' }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ snapshot }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getActiveUsersSnapshot()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith('/api/local/users', expect.objectContaining({ method: 'GET' }));
  });

  it('refreshes and returns the saved snapshot', async () => {
    const summary = { entityId: 'us-production', retrievedAt: '2026-08-29T00:00:00Z', count: 100000, pageCount: 1000 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ summary }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshActiveUsersSnapshot()).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenCalledWith('/api/local/users/refresh', expect.objectContaining({ method: 'POST' }));
  });

  it('loads snapshot metadata without downloading profile rows', async () => {
    const summary = { entityId: 'us-production', retrievedAt: '2026-08-29T00:00:00Z', count: 100000, pageCount: 1000 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ summary }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getActiveUsersSummary()).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenCalledWith('/api/local/users/summary', expect.objectContaining({ method: 'GET' }));
  });

  it('queries one local page with server-side nested filters and sorting', async () => {
    const result = { users: [{ id: 'one' }], total: 100000, snapshotCount: 100000, retrievedAt: '2026-08-29T00:00:00Z', offset: 200, limit: 200, hasMore: true };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ result }) });
    vi.stubGlobal('fetch', fetchMock);

    const filters = { id: 'root', kind: 'group' as const, logic: 'and' as const, items: [{ id: 'login', kind: 'condition' as const, field: 'login', operator: 'startsWith' as const, value: 'henry' }] };
    await expect(queryActiveUsersLocal({ offset: 200, filters, sortBy: 'login', sortDir: 'desc' })).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/local/users/query');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ offset: 200, limit: 200, filters, sortBy: 'login', sortDir: 'desc' });
  });

  it('reads the current retrieval progress', async () => {
    const progress = { entityId: 'us-production', state: 'running', retrievedCount: 300, totalResults: 900, pageCount: 3, startIndex: 201, itemsPerPage: 100, percent: 33 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ progress }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getActiveUsersProgress()).resolves.toEqual(progress);
    expect(fetchMock).toHaveBeenCalledWith('/api/local/users/progress', expect.objectContaining({ method: 'GET' }));
  });
});
