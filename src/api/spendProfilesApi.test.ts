import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadSpendProfilesCsv, getSpendProfilesSummary, querySpendProfilesLocal, refreshSpendProfilesSnapshot } from './spendProfilesApi';

afterEach(() => vi.unstubAllGlobals());

describe('Spend Profiles local API', () => {
  it('loads both Spend and Identity snapshot metadata', async () => {
    const summary = { entityId: 'us-production', retrievedAt: '2026-08-30T00:00:00Z', count: 3, pageCount: 1, identityCount: 4, spendFields: ['country'], customFields: ['custom19'] };
    const identitySummary = { entityId: 'us-production', retrievedAt: '2026-08-29T00:00:00Z', count: 4, pageCount: 1 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ summary, identitySummary }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getSpendProfilesSummary()).resolves.toEqual({ summary, identitySummary });
    expect(fetchMock).toHaveBeenCalledWith('/api/local/spend-profiles/summary', expect.objectContaining({ method: 'GET' }));
  });

  it('posts nested filters for local queries', async () => {
    const result = { rows: [], total: 0, snapshotCount: 3, retrievedAt: '2026-08-30T00:00:00Z', offset: 0, limit: 200, hasMore: false };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ result }) });
    vi.stubGlobal('fetch', fetchMock);
    const filters = { id: 'root', kind: 'group' as const, logic: 'and' as const, items: [{ id: 'country', kind: 'condition' as const, field: 'country', operator: 'eq' as const, value: 'PT' }] };

    await expect(querySpendProfilesLocal({ offset: 0, filters, sortBy: 'loginId', sortDir: 'asc' })).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('/api/local/spend-profiles/query', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ limit: 200, filters, sortBy: 'loginId' });
  });

  it('surfaces the prerequisite error from Retrieve All', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({ error: 'Retrieve All Active Users first.' }) }));
    await expect(refreshSpendProfilesSnapshot()).rejects.toThrow('Retrieve All Active Users first.');
  });

  it('exports the current filtered visible columns', async () => {
    const createObjectURL = vi.fn(() => 'blob:spend-profiles');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['csv'])) });
    vi.stubGlobal('fetch', fetchMock);
    const filters = { id: 'root', kind: 'group' as const, logic: 'and' as const, items: [] };

    await downloadSpendProfilesCsv({ filters, sortBy: 'loginId', sortDir: 'asc', columns: ['id', 'loginId', 'employeeNumber', 'country'] });

    expect(fetchMock).toHaveBeenCalledWith('/api/local/spend-profiles/export', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).columns).toEqual(['id', 'loginId', 'employeeNumber', 'country']);
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
