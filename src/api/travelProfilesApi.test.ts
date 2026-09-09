import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTravelProfilesSummary, queryTravelProfilesLocal } from './travelProfilesApi';

afterEach(() => vi.restoreAllMocks());

describe('travelProfilesApi', () => {
  it('maps Travel fields into the shared profile workspace summary contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      summary: { entityId: 'us-uat', retrievedAt: '2026-09-08T00:00:00Z', count: 2, pageCount: 1, identityCount: 3, travelFields: ['eReceiptOptIn'], customFields: ['Travel Region'] }, identitySummary: { count: 3 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(getTravelProfilesSummary()).resolves.toMatchObject({ summary: { spendFields: ['eReceiptOptIn'], customFields: ['Travel Region'] } });
  });

  it('posts local Travel filters to the Travel Profiles query endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await queryTravelProfilesLocal({ offset: 0, filters: { id: 'root', kind: 'group', logic: 'and', items: [] }, sortBy: 'loginId', sortDir: 'asc' });

    expect(fetchMock).toHaveBeenCalledWith('/api/local/travel-profiles/query', expect.objectContaining({ method: 'POST' }));
  });
});
