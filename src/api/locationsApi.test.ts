import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildLocationsPath, enrichLocationsWithLocCodes, searchLocations, fetchAllLocations, PAGE_LIMIT, refreshLocationsSnapshot } from './locationsApi';

const { concurGet } = vi.hoisted(() => ({ concurGet: vi.fn() }));
const { searchLocalityLocations } = vi.hoisted(() => ({ searchLocalityLocations: vi.fn() }));
const fetchMock = vi.fn();

vi.mock('./concurFetch', () => ({ concurGet }));
vi.mock('./localitiesApi', () => ({ searchLocalityLocations }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  searchLocalityLocations.mockResolvedValue([]);
});

describe('enrichLocationsWithLocCodes', () => {
  it('groups Localities searches and matches locCode by Location Name ID', async () => {
    searchLocalityLocations.mockResolvedValue([
      { code: 'USSEA', names: [{ id: 'name-seattle', name: 'Seattle' }] },
      { code: 'USRED', names: [{ id: 'name-redmond', name: 'Redmond' }] },
    ]);

    const enriched = await enrichLocationsWithLocCodes([
      { ID: '1', Name: 'Seattle', City: 'Seattle', Country: 'US', CountrySubdivision: 'US-WA', LocationNameId: 'NAME-SEATTLE' },
      { ID: '2', Name: 'Redmond', City: 'Seattle', Country: 'US', CountrySubdivision: 'US-WA', LocationNameId: 'name-redmond' },
    ]);

    expect(searchLocalityLocations).toHaveBeenCalledTimes(1);
    expect(searchLocalityLocations).toHaveBeenCalledWith({
      searchText: 'Seattle', countryCode: 'US', subdivisionCode: 'US-WA',
    });
    expect(enriched.map((location) => location.LocCode)).toEqual(['USSEA', 'USRED']);
  });

  it('preserves Locations v3 rows when a Localities request fails', async () => {
    searchLocalityLocations.mockRejectedValue(new Error('locality.read is unavailable'));
    const locations = [{ ID: '1', Name: 'Munich', City: 'Munich', Country: 'DE', CountrySubdivision: 'DE-BY', LocationNameId: 'name-munich' }];
    await expect(enrichLocationsWithLocCodes(locations)).resolves.toEqual(locations);
  });

  it('does not look up rows that already carry a locCode', async () => {
    const locations = [{ ID: '1', Name: 'Seattle', City: 'Seattle', Country: 'US', CountrySubdivision: 'US-WA', LocationNameId: 'name-seattle', LocCode: 'USSEA' }];
    await expect(enrichLocationsWithLocCodes(locations)).resolves.toEqual(locations);
    expect(searchLocalityLocations).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

describe('buildLocationsPath', () => {
  it('combines country, subdivision, city, and name into one query string', () => {
    const path = buildLocationsPath({ country: 'US', countrySubdivision: 'US-WA', city: 'Redmond', name: 'West' });
    expect(path).toBe(
      '/api/v3.0/common/locations?limit=100&country=US&countrySubdivision=US-WA&city=Redmond&name=West',
    );
  });

  it('omits empty filters and trims values', () => {
    expect(buildLocationsPath({ country: ' de ', name: '' })).toBe(
      '/api/v3.0/common/locations?limit=100&country=DE',
    );
  });

  it('uppercases country and subdivision codes', () => {
    expect(buildLocationsPath({ country: 'us', countrySubdivision: 'us-wa' })).toBe(
      '/api/v3.0/common/locations?limit=100&country=US&countrySubdivision=US-WA',
    );
  });

  it('encodes values with spaces or special characters', () => {
    expect(buildLocationsPath({ city: 'New York' })).toBe(
      '/api/v3.0/common/locations?limit=100&city=New+York',
    );
  });

  it('throws when no filter is provided', () => {
    expect(() => buildLocationsPath({})).toThrow(/at least one/i);
  });
});

describe('searchLocations', () => {
  it('uses the country snapshot endpoint when a country is provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      locations: [{ ID: '1', Name: 'SeaTac' }],
      hasMore: false,
      source: 'cache',
      snapshotCountry: 'US',
    }));

    const result = await searchLocations({ country: ' us ', countrySubdivision: 'us-wa', city: 'Sea Tac' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/local/locations?country=US&countrySubdivision=US-WA&city=Sea+Tac',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(concurGet).not.toHaveBeenCalled();
    expect(result.snapshotCountry).toBe('US');
  });

  it('fetches the first live page and reports hasMore when no country is present', async () => {
    concurGet.mockResolvedValue({
      Items: [{ ID: '1', Name: 'SeaTac' }],
      NextPage: 'https://us.api.concursolutions.com/api/v3.0/common/locations?offset=100&limit=100&name=Sea',
    });

    const result = await searchLocations({ name: 'Sea' });
    expect(concurGet).toHaveBeenCalledWith('/api/v3.0/common/locations?limit=100&name=Sea');
    expect(result.locations).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('binds background requests to the Entity captured by the task', async () => {
    concurGet.mockResolvedValue({ Items: [], NextPage: null });
    await searchLocations({ name: 'Sea' }, { entityId: 'us-production' });
    expect(concurGet).toHaveBeenCalledWith(
      '/api/v3.0/common/locations?limit=100&name=Sea',
      { headers: { 'X-Concur-Entity': 'us-production' } },
    );
  });

  it('reports hasMore=false when there is no NextPage', async () => {
    concurGet.mockResolvedValue({ Items: [{ ID: '1' }], NextPage: null });
    const result = await searchLocations({ name: 'Paris' });
    expect(result.hasMore).toBe(false);
  });

  it('treats a missing Items array as empty', async () => {
    concurGet.mockResolvedValue({});
    const result = await searchLocations({ city: 'Berlin' });
    expect(result.locations).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});

describe('fetchAllLocations', () => {
  it('follows NextPage until exhausted, preserving the query string of absolute URIs', async () => {
    concurGet
      .mockResolvedValueOnce({
        Items: [{ ID: '1' }],
        NextPage: 'https://us.api.concursolutions.com/api/v3.0/common/locations?offset=100&limit=100&name=Sea',
      })
      .mockResolvedValueOnce({
        Items: [{ ID: '2' }],
        NextPage: null,
      });

    const result = await fetchAllLocations({ name: 'Sea' });
    expect(concurGet).toHaveBeenNthCalledWith(1, '/api/v3.0/common/locations?limit=100&name=Sea');
    expect(concurGet).toHaveBeenNthCalledWith(2, '/api/v3.0/common/locations?offset=100&limit=100&name=Sea');
    expect(result.locations.map((l) => l.ID)).toEqual(['1', '2']);
    expect(result.hasMore).toBe(false);
  });

  it('keeps following pages past the old 100-page ceiling so the set is complete', async () => {
    const TOTAL_PAGES = 150;
    let call = 0;
    concurGet.mockImplementation(() => {
      const index = call++;
      const last = index === TOTAL_PAGES - 1;
      return Promise.resolve({
        Items: [{ ID: `id-${index}` }],
        NextPage: last ? null : `https://x/api/v3.0/common/locations?offset=${(index + 1) * PAGE_LIMIT}`,
      });
    });

    const result = await fetchAllLocations({ name: 'a' });
    expect(concurGet).toHaveBeenCalledTimes(TOTAL_PAGES);
    expect(result.locations).toHaveLength(TOTAL_PAGES);
    expect(result.hasMore).toBe(false);
  });

  it('stops when Concur repeats a pagination link instead of looping forever', async () => {
    const looping = 'https://x/api/v3.0/common/locations?offset=100';
    let call = 0;
    // Page 2 points back at itself, which is the only remaining stop condition
    // now that the page ceiling is gone.
    concurGet.mockImplementation(() => Promise.resolve({ Items: [{ ID: `id-${call++}` }], NextPage: looping }));

    const result = await fetchAllLocations({ name: 'a' });
    expect(concurGet).toHaveBeenCalledTimes(2);
    expect(result.locations).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it('reports page progress as the crawl advances', async () => {
    concurGet
      .mockResolvedValueOnce({ Items: [{ ID: '1' }], NextPage: 'https://x/api/v3.0/common/locations?offset=100' })
      .mockResolvedValueOnce({ Items: [{ ID: '2' }], NextPage: null });
    const updates: unknown[] = [];

    await fetchAllLocations({ name: 'Sea' }, { onProgress: (update) => updates.push(update) });

    expect(updates).toEqual([
      { stage: 'retrieving-locations', pagesDone: 1, pagesTotal: null, rowsDone: 1 },
      { stage: 'retrieving-locations', pagesDone: 2, pagesTotal: null, rowsDone: 2 },
      { stage: 'matching-localities', groupsDone: 0, groupsTotal: 0 },
    ]);
  });
});

describe('locCode persistence', () => {
  const SHANGHAI = { ID: '1', Name: 'Shanghai', City: 'Shanghai', Country: 'CN', CountrySubdivision: 'CN-SH', LocationNameId: 'name-sh' };
  const BEIJING = { ID: '2', Name: 'Beijing', City: 'Beijing', Country: 'CN', CountrySubdivision: 'CN-BJ', LocationNameId: 'name-bj' };

  function snapshotResponse(body: Record<string, unknown>) {
    fetchMock.mockImplementation((url: string) => Promise.resolve(
      url.startsWith('/api/local/locations/loc-codes')
        ? jsonResponse({ applied: 1, locCodesAt: '2026-09-01T00:00:00.000Z' })
        : jsonResponse({ locations: [SHANGHAI], hasMore: false, source: 'cache', snapshotCountry: 'CN', ...body }),
    ));
  }

  function isWriteBack(call: unknown[]): boolean {
    return String(call[0]).startsWith('/api/local/locations/loc-codes');
  }

  function locCodesBody(): { country: string; locCodes: Record<string, string>; complete: boolean } {
    const call = fetchMock.mock.calls.find(isWriteBack);
    if (!call) throw new Error('No locCode write-back was posted');
    return JSON.parse((call[1] as { body: string }).body);
  }

  it('skips the Localities pass entirely when the snapshot reports resolved locCodes', async () => {
    snapshotResponse({ locCodesResolved: true });

    const result = await searchLocations({ country: 'CN' });

    expect(searchLocalityLocations).not.toHaveBeenCalled();
    expect(result.locations).toEqual([SHANGHAI]);
    expect(fetchMock.mock.calls.some(isWriteBack)).toBe(false);
  });

  it('writes matched locCodes back and marks the snapshot resolved', async () => {
    snapshotResponse({});
    searchLocalityLocations.mockResolvedValue([{ code: 'CNSHA', names: [{ id: 'name-sh' }] }]);

    const result = await searchLocations({ country: 'CN' });

    expect(result.locations[0].LocCode).toBe('CNSHA');
    expect(locCodesBody()).toEqual({ country: 'CN', locCodes: { 'name-sh': 'CNSHA' }, complete: true });
  });

  it('leaves the snapshot unresolved when one lookup fails, keeping the codes it did match', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(
      url.startsWith('/api/local/locations/loc-codes')
        ? jsonResponse({ applied: 1, locCodesAt: null })
        : jsonResponse({ locations: [SHANGHAI, BEIJING], hasMore: false, source: 'cache', snapshotCountry: 'CN' }),
    ));
    searchLocalityLocations.mockImplementation(({ searchText }: { searchText: string }) => (
      searchText === 'Shanghai'
        ? Promise.resolve([{ code: 'CNSHA', names: [{ id: 'name-sh' }] }])
        : Promise.reject(new Error('locality.read is unavailable'))
    ));

    await searchLocations({ country: 'CN' });

    expect(locCodesBody()).toEqual({ country: 'CN', locCodes: { 'name-sh': 'CNSHA' }, complete: false });
  });

  it('does not fail the search when the write-back request fails', async () => {
    fetchMock.mockImplementation((url: string) => (
      url.startsWith('/api/local/locations/loc-codes')
        ? Promise.reject(new Error('disk is full'))
        : Promise.resolve(jsonResponse({ locations: [SHANGHAI], hasMore: false, source: 'cache', snapshotCountry: 'CN' }))
    ));
    searchLocalityLocations.mockResolvedValue([{ code: 'CNSHA', names: [{ id: 'name-sh' }] }]);

    await expect(searchLocations({ country: 'CN' })).resolves.toMatchObject({
      locations: [expect.objectContaining({ LocCode: 'CNSHA' })],
    });
  });
});

describe('refreshLocationsSnapshot', () => {
  it('forces a refresh through the local country endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ locations: [], hasMore: false, source: 'concur' }));

    await refreshLocationsSnapshot({ country: 'CN', name: 'Shanghai' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/local/locations/refresh?country=CN&name=Shanghai',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
