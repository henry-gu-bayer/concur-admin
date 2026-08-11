import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildLocationsPath, searchLocations, fetchAllLocations, PAGE_LIMIT } from './locationsApi';

const { concurGet } = vi.hoisted(() => ({ concurGet: vi.fn() }));

vi.mock('./concurFetch', () => ({ concurGet }));

beforeEach(() => {
  vi.clearAllMocks();
});

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
  it('fetches the first page and reports hasMore when NextPage is present', async () => {
    concurGet.mockResolvedValue({
      Items: [{ ID: '1', Name: 'SeaTac' }],
      NextPage: 'https://us.api.concursolutions.com/api/v3.0/common/locations?offset=100&limit=100&country=US',
    });

    const result = await searchLocations({ country: 'US' });
    expect(concurGet).toHaveBeenCalledWith('/api/v3.0/common/locations?limit=100&country=US');
    expect(result.locations).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('reports hasMore=false when there is no NextPage', async () => {
    concurGet.mockResolvedValue({ Items: [{ ID: '1' }], NextPage: null });
    const result = await searchLocations({ name: 'Paris' });
    expect(result.hasMore).toBe(false);
  });

  it('treats a missing Items array as empty', async () => {
    concurGet.mockResolvedValue({});
    const result = await searchLocations({ country: 'DE' });
    expect(result.locations).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});

describe('fetchAllLocations', () => {
  it('follows NextPage until exhausted, preserving the query string of absolute URIs', async () => {
    concurGet
      .mockResolvedValueOnce({
        Items: [{ ID: '1' }],
        NextPage: 'https://us.api.concursolutions.com/api/v3.0/common/locations?offset=100&limit=100&country=US',
      })
      .mockResolvedValueOnce({
        Items: [{ ID: '2' }],
        NextPage: null,
      });

    const result = await fetchAllLocations({ country: 'US' });
    expect(concurGet).toHaveBeenNthCalledWith(1, '/api/v3.0/common/locations?limit=100&country=US');
    expect(concurGet).toHaveBeenNthCalledWith(2, '/api/v3.0/common/locations?offset=100&limit=100&country=US');
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
