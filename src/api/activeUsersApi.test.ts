import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveUsersBrowseProgress, getActiveUsersProgress, getActiveUsersSnapshot, getActiveUsersSummary, getLocalActiveUsersByIds, queryActiveUsersLocal, refreshActiveUsersSnapshot, resumeActiveUsersBrowseIndex } from './activeUsersApi';

afterEach(() => vi.unstubAllGlobals());

describe('active users snapshot API', () => {
  it('loads the current entity snapshot', async () => {
    const snapshot = { entityId: 'us-production', retrievedAt: '2026-08-29T00:00:00Z', count: 1, pageCount: 1, profiles: [{ id: 'one' }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ snapshot }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getActiveUsersSnapshot()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith('/api/local/users', expect.objectContaining({ method: 'GET' }));
  });

  it('starts retrieval and returns its durable progress state', async () => {
    const progress = { entityId: 'us-production', state: 'running', startedAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z', retrievedCount: 0, totalResults: null, pageCount: 0, startIndex: null, itemsPerPage: 100, percent: 0, jobId: 'job-1' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ progress }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshActiveUsersSnapshot()).resolves.toEqual(progress);
    expect(fetchMock).toHaveBeenCalledWith('/api/local/users/refresh', expect.objectContaining({ method: 'POST' }));
  });

  it('loads snapshot metadata without downloading profile rows', async () => {
    const summary = { entityId: 'us-production', retrievedAt: '2026-08-29T00:00:00Z', count: 100000, pageCount: 1000 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ summary }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getActiveUsersSummary()).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenCalledWith('/api/local/users/summary', expect.objectContaining({ method: 'GET' }));
  });

  it('resolves a bounded set of user references from a pinned local generation', async () => {
    const result = { snapshotAvailable: true, generation: 'identity-1', users: [{ id: 'manager-id', userName: 'manager@example.com', displayName: 'Morgan Lee' }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(result) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLocalActiveUsersByIds(['manager-id', 'approver-id', 'manager-id'], 'identity-1')).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/local/users/resolve?id=manager-id&id=approver-id&generation=identity-1');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'GET' }));
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

  it('reads and resumes the local browse-index job without starting a Concur retrieval', async () => {
    const progress = { state: 'paused', sourceGeneration: 'identity-1', percent: 63, phase: 'sorting' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ progress }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getActiveUsersBrowseProgress()).resolves.toEqual(progress);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/local/users/browse-progress', expect.objectContaining({ method: 'GET' }));

    await expect(resumeActiveUsersBrowseIndex()).resolves.toEqual(progress);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/local/users/browse-index/resume', expect.objectContaining({ method: 'POST' }));
  });
});
