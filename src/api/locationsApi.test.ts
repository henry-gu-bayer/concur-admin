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

  it('caps the total record count as a safety valve', async () => {
    const page = (offset: number) => ({
      Items: [{ ID: `id-${offset}` }],
      NextPage: `https://x/api/v3.0/common/locations?offset=${offset + PAGE_LIMIT}`,
    });
    let call = 0;
    concurGet.mockImplementation(() => Promise.resolve(page(call++ * PAGE_LIMIT)));

    const result = await fetchAllLocations({ name: 'a' });
    expect(result.locations.length).toBeLessThanOrEqual(10000);
    expect(concurGet.mock.calls.length).toBeLessThanOrEqual(100);
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
