import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCountryLocationsSnapshot,
  readCountryLocationsSnapshot,
  searchCountryLocations,
} from './concurLocations';

const { undiciFetch, getServerAccessToken, logApiCall, logApiCallFailure } = vi.hoisted(() => ({
  undiciFetch: vi.fn(),
  getServerAccessToken: vi.fn(),
  logApiCall: vi.fn(),
  logApiCallFailure: vi.fn(),
}));

vi.mock('undici', () => ({ fetch: undiciFetch, ProxyAgent: class {} }));
vi.mock('./concurAuth', () => ({ getServerAccessToken }));
vi.mock('./logger', () => ({ logApiCall, logApiCallFailure }));
vi.mock('./entities', () => ({
  createEntityRegistry: () => ({
    require: () => ({ id: 'us-uat', baseUrl: 'https://us2.api.concursolutions.com' }),
  }),
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { forEach: (callback: (value: string, key: string) => void) => callback('application/json', 'content-type') },
  };
}

let dataDirectory: string;

beforeEach(() => {
  vi.clearAllMocks();
  dataDirectory = mkdtempSync(join(tmpdir(), 'concur-locations-'));
  vi.stubEnv('DATA_DIR', dataDirectory);
  getServerAccessToken.mockResolvedValue('server-token');
});

afterEach(() => {
  rmSync(dataDirectory, { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('country Locations snapshots', () => {
  it('fetches every page and atomically persists a complete country snapshot', async () => {
    undiciFetch
      .mockResolvedValueOnce(jsonResponse({
        Items: [{ ID: 'cn-sh', Name: 'Shanghai', Country: 'CN', CountrySubdivision: 'CN-SH' }],
        NextPage: '/api/v3.0/common/locations?limit=100&country=CN&offset=100',
      }))
      .mockResolvedValueOnce(jsonResponse({
        Items: [{ ID: 'cn-bj', Name: 'Beijing', Country: 'CN', CountrySubdivision: 'CN-BJ' }],
        NextPage: null,
      }));

    const snapshot = await fetchCountryLocationsSnapshot('us-uat', 'cn');

    expect(snapshot).toMatchObject({ country: 'CN', complete: true, pageCount: 2, count: 2 });
    expect(undiciFetch).toHaveBeenCalledTimes(2);
    expect(logApiCall).toHaveBeenCalledTimes(2);
    const file = join(dataDirectory, 'us-uat', 'locations', 'CN.json');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf-8')).locations).toHaveLength(2);
    expect(readCountryLocationsSnapshot('us-uat', 'CN')?.locations).toHaveLength(2);
  });

  it('serves repeat country queries from disk and filters them locally', async () => {
    undiciFetch.mockResolvedValueOnce(jsonResponse({
      Items: [
        { ID: 'cn-sh', Name: 'Shanghai', City: 'Shanghai', Country: 'CN', CountrySubdivision: 'CN-SH' },
        { ID: 'cn-bj', Name: 'Beijing', City: 'Beijing', Country: 'CN', CountrySubdivision: 'CN-BJ' },
      ],
      NextPage: null,
    }));

    const first = await searchCountryLocations('us-uat', { country: 'CN' });
    const second = await searchCountryLocations('us-uat', { country: 'CN', countrySubdivision: 'CN-SH', city: 'shang' });

    expect(first.source).toBe('concur');
    expect(second).toMatchObject({ source: 'cache', snapshotCountry: 'CN', snapshotComplete: true });
    expect(second.locations.map((location) => location.ID)).toEqual(['cn-sh']);
    expect(undiciFetch).toHaveBeenCalledTimes(1);
  });

  it('forces a refetch when refresh is requested', async () => {
    undiciFetch
      .mockResolvedValueOnce(jsonResponse({ Items: [{ ID: 'old' }], NextPage: null }))
      .mockResolvedValueOnce(jsonResponse({ Items: [{ ID: 'new' }], NextPage: null }));

    await searchCountryLocations('us-uat', { country: 'CN' });
    const refreshed = await searchCountryLocations('us-uat', { country: 'CN' }, true);

    expect(refreshed.source).toBe('concur');
    expect(refreshed.locations.map((location) => location.ID)).toEqual(['new']);
    expect(undiciFetch).toHaveBeenCalledTimes(2);
  });

  it('marks snapshots stale after 24 hours while continuing to serve them', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    undiciFetch.mockResolvedValueOnce(jsonResponse({ Items: [{ ID: 'cn-sh' }], NextPage: null }));
    await searchCountryLocations('us-uat', { country: 'CN' });

    vi.setSystemTime(new Date('2026-08-13T00:00:01.000Z'));
    const cached = await searchCountryLocations('us-uat', { country: 'CN' });

    expect(cached).toMatchObject({ source: 'cache', snapshotStale: true });
    expect(undiciFetch).toHaveBeenCalledTimes(1);
  });

  it('persists but flags a snapshot when pagination cannot finish safely', async () => {
    undiciFetch.mockResolvedValueOnce(jsonResponse({
      Items: [{ ID: 'cn-sh' }],
      NextPage: 'https://us2.api.concursolutions.com/api/v3.0/common/locations?limit=100&country=CN',
    }));

    const snapshot = await fetchCountryLocationsSnapshot('us-uat', 'CN');

    expect(snapshot).toMatchObject({ complete: false, pageCount: 1, count: 1 });
    expect(readCountryLocationsSnapshot('us-uat', 'CN')?.complete).toBe(false);
  });

  it('logs transport failures without replacing a missing snapshot', async () => {
    undiciFetch.mockRejectedValue(new Error('proxy failed'));

    await expect(fetchCountryLocationsSnapshot('us-uat', 'CN')).rejects.toThrow('proxy failed');
    expect(logApiCallFailure).toHaveBeenCalledWith('us-uat', expect.objectContaining({ error: 'proxy failed' }));
    expect(readCountryLocationsSnapshot('us-uat', 'CN')).toBeNull();
  });
});
