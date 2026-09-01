import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCountryLocationsSnapshot,
  getCountryLocationsProgress,
  readCountryLocationsSnapshot,
  resetCountryLocationsProgress,
  searchCountryLocations,
  writeCountryLocationsLocCodes,
} from './concurLocations';

const { undiciFetch, getServerAccessToken, logApiCall, logApiCallFailure } = vi.hoisted(() => ({
  undiciFetch: vi.fn(),
  getServerAccessToken: vi.fn(),
  logApiCall: vi.fn(),
  logApiCallFailure: vi.fn(),
}));

vi.mock('undici', () => ({ fetch: undiciFetch }));
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
  resetCountryLocationsProgress();
  dataDirectory = mkdtempSync(join(tmpdir(), 'concur-locations-'));
  vi.stubEnv('DATA_DIR', dataDirectory);
  getServerAccessToken.mockResolvedValue('server-token');
});

/** Mocks a finite NextPage chain of `pages` single-item pages. */
function mockPageChain(pages: number, onPage?: () => void): void {
  let call = 0;
  undiciFetch.mockImplementation(() => {
    onPage?.();
    const index = call++;
    return Promise.resolve(jsonResponse({
      Items: [{ ID: `cn-${index}`, Name: `City ${index}`, Country: 'CN', CountrySubdivision: 'CN-SH', LocationNameId: `name-${index}` }],
      NextPage: index < pages - 1 ? `/api/v3.0/common/locations?limit=100&country=CN&offset=${(index + 1) * 100}` : null,
    }));
  });
}

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

  it('re-retrieves instead of serving a truncated snapshot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T00:00:00.000Z'));
    // Page 2 repeats page 1's URL, so the first attempt stops short.
    undiciFetch.mockResolvedValue(jsonResponse({
      Items: [{ ID: 'cn-partial' }],
      NextPage: 'https://us2.api.concursolutions.com/api/v3.0/common/locations?limit=100&country=CN',
    }));
    const partial = await searchCountryLocations('us-uat', { country: 'CN' });
    expect(partial).toMatchObject({ snapshotComplete: false, snapshotCount: 1 });

    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    undiciFetch.mockReset();
    mockPageChain(2);
    const retried = await searchCountryLocations('us-uat', { country: 'CN' });

    expect(retried).toMatchObject({ source: 'concur', snapshotComplete: true, snapshotCount: 2 });
  });

  it('does not re-retrieve a truncated snapshot that was just written', async () => {
    undiciFetch.mockResolvedValue(jsonResponse({
      Items: [{ ID: 'cn-partial' }],
      NextPage: 'https://us2.api.concursolutions.com/api/v3.0/common/locations?limit=100&country=CN',
    }));
    await searchCountryLocations('us-uat', { country: 'CN' });
    const callsAfterFirst = undiciFetch.mock.calls.length;

    const second = await searchCountryLocations('us-uat', { country: 'CN' });

    expect(second.source).toBe('cache');
    expect(undiciFetch).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it('keeps serving a complete snapshot that is merely stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T00:00:00.000Z'));
    mockPageChain(2);
    await searchCountryLocations('us-uat', { country: 'CN' });

    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const cached = await searchCountryLocations('us-uat', { country: 'CN' });

    expect(cached).toMatchObject({ source: 'cache', snapshotStale: true, snapshotComplete: true });
    expect(undiciFetch).toHaveBeenCalledTimes(2);
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
    undiciFetch.mockRejectedValue(new Error('connection failed'));

    await expect(fetchCountryLocationsSnapshot('us-uat', 'CN')).rejects.toThrow('connection failed');
    expect(logApiCallFailure).toHaveBeenCalledWith('us-uat', expect.objectContaining({ error: 'connection failed' }));
    expect(readCountryLocationsSnapshot('us-uat', 'CN')).toBeNull();
  });
});

describe('country Locations retrieval progress', () => {
  it('reports no progress before a retrieval starts', () => {
    expect(getCountryLocationsProgress('us-uat', 'cn')).toMatchObject({
      country: 'CN', state: 'idle', pagesDone: 0, pagesTotal: null, percent: null,
    });
  });

  it('advances page and row counters while the snapshot is being fetched', async () => {
    const seen: { pagesDone: number; rowsDone: number }[] = [];
    mockPageChain(3, () => seen.push(getCountryLocationsProgress('us-uat', 'CN')));

    await fetchCountryLocationsSnapshot('us-uat', 'CN');

    // Sampled on entry to each page fetch, so it trails by one page.
    expect(seen.map((p) => p.pagesDone)).toEqual([0, 1, 2]);
    expect(seen.map((p) => p.rowsDone)).toEqual([0, 1, 2]);
    expect(getCountryLocationsProgress('us-uat', 'CN')).toMatchObject({
      state: 'complete', pagesDone: 3, rowsDone: 3, percent: 100,
    });
  });

  it('seeds the page estimate from the previous complete snapshot', async () => {
    mockPageChain(3);
    await fetchCountryLocationsSnapshot('us-uat', 'CN');
    resetCountryLocationsProgress();

    const seeded: (number | null)[] = [];
    mockPageChain(3, () => seeded.push(getCountryLocationsProgress('us-uat', 'CN').pagesTotal));
    await fetchCountryLocationsSnapshot('us-uat', 'CN');

    // The first sample is taken before any page lands, so it already carries
    // the seed rather than the null a first-ever retrieval would show.
    expect(seeded[0]).toBe(3);
  });

  it('never lets the percentage fall back when the seed underestimates the page count', async () => {
    mockPageChain(2);
    await fetchCountryLocationsSnapshot('us-uat', 'CN');
    resetCountryLocationsProgress();

    const percents: number[] = [];
    mockPageChain(6, () => {
      const { percent } = getCountryLocationsProgress('us-uat', 'CN');
      if (percent !== null) percents.push(percent);
    });
    await fetchCountryLocationsSnapshot('us-uat', 'CN');

    expect(percents.length).toBeGreaterThan(1);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(Math.max(...percents)).toBeLessThanOrEqual(99);
    expect(getCountryLocationsProgress('us-uat', 'CN').percent).toBe(100);
  });

  it('records the failure on the progress entry when a page throws', async () => {
    undiciFetch.mockRejectedValue(new Error('connection failed'));

    await expect(fetchCountryLocationsSnapshot('us-uat', 'CN')).rejects.toThrow('connection failed');

    expect(getCountryLocationsProgress('us-uat', 'CN')).toMatchObject({
      state: 'error', error: 'connection failed',
    });
  });
});

describe('locCode write-back', () => {
  beforeEach(async () => {
    mockPageChain(2);
    await fetchCountryLocationsSnapshot('us-uat', 'CN');
  });

  it('applies codes by Location Name ID and marks the snapshot resolved', async () => {
    const result = writeCountryLocationsLocCodes('us-uat', {
      country: 'cn',
      locCodes: { 'name-0': 'CNSHA', 'name-1': 'CNBJS' },
      complete: true,
    });

    expect(result.applied).toBe(2);
    const snapshot = readCountryLocationsSnapshot('us-uat', 'CN');
    expect(snapshot?.locations.map((l) => l.LocCode)).toEqual(['CNSHA', 'CNBJS']);
    expect(snapshot?.locCodesAt).toEqual(expect.any(String));
    expect((await searchCountryLocations('us-uat', { country: 'CN' })).locCodesResolved).toBe(true);
  });

  it('keeps partial codes but leaves the snapshot unresolved so the rest is retried', async () => {
    writeCountryLocationsLocCodes('us-uat', { country: 'CN', locCodes: { 'name-0': 'CNSHA' }, complete: false });

    const snapshot = readCountryLocationsSnapshot('us-uat', 'CN');
    expect(snapshot?.locations.map((l) => l.LocCode)).toEqual(['CNSHA', undefined]);
    expect(snapshot?.locCodesAt).toBeUndefined();
    expect((await searchCountryLocations('us-uat', { country: 'CN' })).locCodesResolved).toBe(false);
  });

  it('rejects a write-back for a country with no snapshot', () => {
    expect(() => writeCountryLocationsLocCodes('us-uat', { country: 'DE', locCodes: {}, complete: true }))
      .toThrow(/No DE locations snapshot/);
  });

  it('clears the resolved marker when the country is refreshed', async () => {
    writeCountryLocationsLocCodes('us-uat', { country: 'CN', locCodes: { 'name-0': 'CNSHA' }, complete: true });
    mockPageChain(2);

    const refreshed = await searchCountryLocations('us-uat', { country: 'CN' }, true);

    expect(refreshed.locCodesResolved).toBe(false);
  });
});
