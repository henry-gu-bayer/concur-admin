import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLocalityLocationsPath,
  getLocalityCountriesSnapshot,
  getLocalityCountry,
  getLocalitySubdivision,
  getLocalitySubdivisions,
  searchLocalityLocations,
  refreshLocalityCountries,
} from './localitiesApi';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { concurGet } = vi.hoisted(() => ({ concurGet: vi.fn() }));

vi.mock('./concurFetch', () => ({ concurGet }));

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('localitiesApi', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    concurGet.mockReset();
  });

  it('loads and refreshes the local countries snapshot', async () => {
    const snapshot = { retrievedAt: '2026-08-11T00:00:00.000Z', countries: [{ code: 'CN' }] };
    fetchMock.mockResolvedValueOnce(jsonResponse(snapshot)).mockResolvedValueOnce(jsonResponse(snapshot));

    await expect(getLocalityCountriesSnapshot()).resolves.toEqual(snapshot);
    await expect(refreshLocalityCountries()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/local/localities/countries', expect.objectContaining({ cache: 'no-store' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/local/localities/countries/refresh', expect.objectContaining({ method: 'POST' }));
  });

  it('returns null for a missing countries snapshot', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'missing' }, 404));
    await expect(getLocalityCountriesSnapshot()).resolves.toBeNull();
  });

  it('queries country and subdivision details by code', async () => {
    concurGet.mockResolvedValueOnce({ code: 'CN' }).mockResolvedValueOnce({ code: 'CN-SH' });
    await expect(getLocalityCountry(' cn ')).resolves.toEqual({ code: 'CN' });
    await expect(getLocalitySubdivision(' cn-sh ')).resolves.toEqual({ code: 'CN-SH' });
    expect(concurGet).toHaveBeenNthCalledWith(1, '/localities/v5/countries/CN');
    expect(concurGet).toHaveBeenNthCalledWith(2, '/localities/v5/subdivisions/CN-SH');
  });

  it('queries subdivisions for a country code', async () => {
    concurGet.mockResolvedValue({ subdivisions: [{ code: 'AU-QLD' }] });
    await expect(getLocalitySubdivisions('au')).resolves.toEqual([{ code: 'AU-QLD' }]);
    expect(concurGet).toHaveBeenCalledWith('/localities/v5/subdivisions?countryCode=AU');
  });

  it('builds Localities v5 location paths for searchText filters', () => {
    expect(buildLocalityLocationsPath({ countryCode: 'cn', subdivisionCode: 'cn-sh', searchText: 'Shanghai' })).toBe(
      '/localities/v5/locations?searchText=Shanghai&countryCode=CN&subdivisionCode=CN-SH',
    );
  });

  it('builds Localities v5 location paths for locCode lookup', () => {
    expect(buildLocalityLocationsPath({ locCode: ' demuc ' })).toBe('/localities/v5/locations?locCode=DEMUC');
  });

  it('rejects searchText with special characters', () => {
    expect(() => buildLocalityLocationsPath({ searchText: 'Munich~Airport' })).toThrow(/special characters/i);
    expect(() => buildLocalityLocationsPath({ searchText: 'Shanghai#1' })).toThrow(/special characters/i);
  });

  it('rejects locCode outside letters, numbers, hyphen, and underscore', () => {
    expect(() => buildLocalityLocationsPath({ locCode: 'DE MUC' })).toThrow(/letters, numbers, hyphen, or underscore/i);
    expect(() => buildLocalityLocationsPath({ locCode: 'DE/MUC' })).toThrow(/letters, numbers, hyphen, or underscore/i);
  });

  it('requires locCode or searchText for location lookup', () => {
    expect(() => buildLocalityLocationsPath({ countryCode: 'US' })).toThrow(/search text or locCode/i);
  });

  it('searches locations and returns an empty array for missing response collection', async () => {
    concurGet.mockResolvedValueOnce({ locations: [{ code: 'DEMUC' }] }).mockResolvedValueOnce({});
    await expect(searchLocalityLocations({ locCode: 'DEMUC' })).resolves.toEqual([{ code: 'DEMUC' }]);
    await expect(searchLocalityLocations({ searchText: 'x' })).resolves.toEqual([]);
  });

  it('binds a Localities lookup to an explicit Entity', async () => {
    concurGet.mockResolvedValue({ locations: [] });
    await searchLocalityLocations({ searchText: 'Seattle', countryCode: 'US', subdivisionCode: 'US-WA' }, 'us-production');
    expect(concurGet).toHaveBeenCalledWith(
      '/localities/v5/locations?searchText=Seattle&countryCode=US&subdivisionCode=US-WA',
      { headers: { 'X-Concur-Entity': 'us-production' } },
    );
  });
});
