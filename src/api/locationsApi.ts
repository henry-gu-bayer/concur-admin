import { concurGet } from './concurFetch';
import { searchLocalityLocations } from './localitiesApi';
import { entityRequestHeaders } from '../entities/entityStore';
import type { ConcurLocation, CountryLocationsProgress, LocationQuery, LocationSearchResult, LocationsResponse } from '../types';

const LOCATIONS_PATH = '/api/v3.0/common/locations';
export const PAGE_LIMIT = 100;
const LOCALITY_LOOKUP_CONCURRENCY = 6;
const PROGRESS_POLL_MS = 500;

export interface LocationsProgressUpdate {
  stage: 'retrieving-locations' | 'matching-localities';
  pagesDone?: number;
  pagesTotal?: number | null;
  rowsDone?: number;
  groupsDone?: number;
  groupsTotal?: number | null;
}

export interface LocationsRequestOptions {
  entityId?: string;
  signal?: AbortSignal;
  onPhase?: (phase: 'retrieving-locations' | 'matching-localities') => void;
  onProgress?: (update: LocationsProgressUpdate) => void;
}

function buildCachedLocationsPath(query: LocationQuery, refresh = false): string {
  const params = new URLSearchParams();
  const country = query.country?.trim().toUpperCase();
  if (!country) throw new Error('A country is required for a local Locations snapshot');
  params.set('country', country);
  const subdivision = query.countrySubdivision?.trim().toUpperCase();
  const city = query.city?.trim();
  const name = query.name?.trim();
  if (subdivision) params.set('countrySubdivision', subdivision);
  if (city) params.set('city', city);
  if (name) params.set('name', name);
  return `/api/local/locations${refresh ? '/refresh' : ''}?${params.toString()}`;
}

async function getCachedLocations(query: LocationQuery, refresh = false, entityId?: string, signal?: AbortSignal): Promise<LocationSearchResult> {
  const response = await fetch(buildCachedLocationsPath(query, refresh), {
    method: refresh ? 'POST' : 'GET',
    headers: entityRequestHeaders(entityId),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Unable to load Locations snapshot: HTTP ${response.status}`);
  }
  return response.json() as Promise<LocationSearchResult>;
}

export async function getLocationsProgress(country: string, entityId?: string): Promise<CountryLocationsProgress> {
  const response = await fetch(`/api/local/locations/progress?country=${encodeURIComponent(country)}`, {
    method: 'GET',
    headers: entityRequestHeaders(entityId),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({})) as { progress?: CountryLocationsProgress; error?: string };
  if (!response.ok) throw new Error(body.error ?? `Locations progress request failed: HTTP ${response.status}`);
  if (!body.progress) throw new Error('The Locations progress response was empty.');
  return body.progress;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The snapshot fetch is one long blocking request, so the only way to see
 * inside it is to poll the server's in-flight counters while it runs.
 */
async function withSnapshotProgress<T>(
  query: LocationQuery,
  options: LocationsRequestOptions,
  work: () => Promise<T>,
): Promise<T> {
  const country = query.country?.trim().toUpperCase();
  const onProgress = options.onProgress;
  if (!country || !onProgress) return work();

  let settled = false;
  void (async () => {
    while (!settled) {
      await delay(PROGRESS_POLL_MS);
      if (settled) return;
      try {
        const progress = await getLocationsProgress(country, options.entityId);
        if (settled || progress.state !== 'running') continue;
        onProgress({
          stage: 'retrieving-locations',
          pagesDone: progress.pagesDone,
          pagesTotal: progress.pagesTotal,
          rowsDone: progress.rowsDone,
        });
      } catch {
        // A progress hiccup must never fail the search it is describing.
      }
    }
  })();

  try {
    return await work();
  } finally {
    settled = true;
  }
}

/**
 * Builds the Locations v3 request path with the combinable filters.
 * At least one filter is required — an unfiltered crawl of all company
 * locations is almost never intended.
 */
export function buildLocationsPath(query: LocationQuery): string {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_LIMIT));
  const country = query.country?.trim().toUpperCase();
  const subdivision = query.countrySubdivision?.trim().toUpperCase();
  const city = query.city?.trim();
  const name = query.name?.trim();
  if (country) params.set('country', country);
  if (subdivision) params.set('countrySubdivision', subdivision);
  if (city) params.set('city', city);
  if (name) params.set('name', name);
  if (!country && !subdivision && !city && !name) {
    throw new Error('At least one filter (country, subdivision, city, or name) is required');
  }
  return `${LOCATIONS_PATH}?${params.toString()}`;
}

/** NextPage comes back as an absolute URI; keep path + query for the proxy. */
function toRelativePath(uri: string): string {
  const url = new URL(uri);
  return `${url.pathname}${url.search}`;
}

async function fetchPage(path: string, entityId?: string, signal?: AbortSignal): Promise<{ items: ConcurLocation[]; nextPath: string | null }> {
  const init: RequestInit = {
    ...(entityId ? { headers: entityRequestHeaders(entityId) } : {}),
    ...(signal ? { signal } : {}),
  };
  const res = entityId || signal
    ? await concurGet<LocationsResponse>(path, init)
    : await concurGet<LocationsResponse>(path);
  const next = res.NextPage?.trim();
  return { items: res.Items ?? [], nextPath: next ? toRelativePath(next) : null };
}

interface LocalityLookupGroup {
  city: string;
  countryCode: string;
  subdivisionCode: string;
  locationNameIds: Set<string>;
}

function normalizeLocationNameId(value?: string): string | undefined {
  const id = value?.trim().toLocaleLowerCase();
  return id || undefined;
}

/**
 * Adds Localities v5 locCodes to Locations v3 rows. Rows sharing the same
 * city/country/subdivision use one Localities request, then match exactly on
 * the Location Name ID exposed as names[].id by Localities v5.
 *
 * The lookup is best-effort: a Localities permission or data error must not
 * hide otherwise valid Locations v3 results.
 */
interface LocCodeMatch {
  locations: ConcurLocation[];
  locCodes: Record<string, string>;
  /** False when any lookup failed, which keeps the snapshot open for a retry. */
  complete: boolean;
}

async function matchLocCodes(locations: ConcurLocation[], options: LocationsRequestOptions): Promise<LocCodeMatch> {
  const { entityId, signal } = options;
  const groups = new Map<string, LocalityLookupGroup>();
  for (const location of locations) {
    // Rows whose code was already resolved and persisted need no lookup.
    if (location.LocCode) continue;
    const city = location.City?.trim() || location.Name?.trim();
    const countryCode = location.Country?.trim().toUpperCase();
    const subdivisionCode = location.CountrySubdivision?.trim().toUpperCase();
    const locationNameId = normalizeLocationNameId(location.LocationNameId);
    if (!city || !countryCode || !subdivisionCode || !locationNameId) continue;
    const key = `${city.toLocaleLowerCase()}\u0000${countryCode}\u0000${subdivisionCode}`;
    const group = groups.get(key) ?? { city, countryCode, subdivisionCode, locationNameIds: new Set<string>() };
    group.locationNameIds.add(locationNameId);
    groups.set(key, group);
  }

  const pending = [...groups.values()];
  const locCodeByLocationNameId = new Map<string, string>();
  let nextIndex = 0;
  let groupsDone = 0;
  let complete = true;
  options.onProgress?.({ stage: 'matching-localities', groupsDone: 0, groupsTotal: pending.length });
  const worker = async () => {
    while (nextIndex < pending.length) {
      const group = pending[nextIndex++];
      try {
        const localityQuery = {
          searchText: group.city,
          countryCode: group.countryCode,
          subdivisionCode: group.subdivisionCode,
        };
        const localities = entityId || signal
          ? await searchLocalityLocations(localityQuery, entityId, signal)
          : await searchLocalityLocations(localityQuery);
        for (const locality of localities) {
          if (!locality.code) continue;
          for (const name of locality.names ?? []) {
            const id = normalizeLocationNameId(name.id);
            if (id && group.locationNameIds.has(id)) locCodeByLocationNameId.set(id, locality.code);
          }
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        // Preserve the Locations v3 row when Localities v5 is unavailable.
        complete = false;
      }
      groupsDone += 1;
      options.onProgress?.({ stage: 'matching-localities', groupsDone, groupsTotal: pending.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOCALITY_LOOKUP_CONCURRENCY, pending.length) }, worker));

  return {
    locations: locations.map((location) => {
      const locationNameId = normalizeLocationNameId(location.LocationNameId);
      const locCode = locationNameId ? locCodeByLocationNameId.get(locationNameId) : undefined;
      return locCode ? { ...location, LocCode: locCode } : location;
    }),
    locCodes: Object.fromEntries(locCodeByLocationNameId),
    complete,
  };
}

export async function enrichLocationsWithLocCodes(locations: ConcurLocation[], entityId?: string, signal?: AbortSignal): Promise<ConcurLocation[]> {
  return (await matchLocCodes(locations, { entityId, signal })).locations;
}

/**
 * Writes the matched codes back into the country snapshot so later searches can
 * skip this stage — on a large country it costs thousands of Localities
 * requests and several minutes against data the snapshot already holds.
 */
async function persistLocCodes(country: string, match: LocCodeMatch, entityId?: string): Promise<void> {
  if (!match.complete && Object.keys(match.locCodes).length === 0) return;
  try {
    await fetch('/api/local/locations/loc-codes', {
      method: 'POST',
      headers: { ...entityRequestHeaders(entityId), 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ country, locCodes: match.locCodes, complete: match.complete }),
    });
  } catch {
    // Best effort: failing to cache the codes must not fail the search.
  }
}

async function enrichResult(result: LocationSearchResult, options: LocationsRequestOptions): Promise<LocationSearchResult> {
  // A resolved snapshot already carries every locCode it could match.
  if (result.locCodesResolved) return result;
  options.onPhase?.('matching-localities');
  const match = await matchLocCodes(result.locations, options);
  if (result.snapshotCountry) await persistLocCodes(result.snapshotCountry, match, options.entityId);
  return { ...result, locations: match.locations };
}

/** Fetches the first page only; `hasMore` signals that the server holds further pages. */
export async function searchLocations(query: LocationQuery, options: LocationsRequestOptions = {}): Promise<LocationSearchResult> {
  options.onPhase?.('retrieving-locations');
  if (query.country?.trim()) {
    const cached = await withSnapshotProgress(query, options, () => getCachedLocations(query, false, options.entityId, options.signal));
    return enrichResult(cached, options);
  }
  const page = await fetchPage(buildLocationsPath(query), options.entityId, options.signal);
  return enrichResult({ locations: page.items, hasMore: page.nextPath !== null }, options);
}

/** Fetches every page, following NextPage links to exhaustion. */
export async function fetchAllLocations(query: LocationQuery, options: LocationsRequestOptions = {}): Promise<LocationSearchResult> {
  options.onPhase?.('retrieving-locations');
  if (query.country?.trim()) {
    const cached = await withSnapshotProgress(query, options, () => getCachedLocations(query, false, options.entityId, options.signal));
    return enrichResult(cached, options);
  }
  let path: string | null = buildLocationsPath(query);
  const locations: ConcurLocation[] = [];
  const seenPaths = new Set<string>();
  let pages = 0;
  // No page ceiling — the crawl must return the complete set. The repeated-path
  // guard is what stops a malformed NextPage chain from looping forever.
  while (path && !seenPaths.has(path)) {
    seenPaths.add(path);
    const page = await fetchPage(path, options.entityId, options.signal);
    locations.push(...page.items);
    pages += 1;
    options.onProgress?.({ stage: 'retrieving-locations', pagesDone: pages, pagesTotal: null, rowsDone: locations.length });
    path = page.nextPath;
  }
  return enrichResult({ locations, hasMore: path !== null }, options);
}

/** Force a fresh full-country snapshot, then apply the current filters locally. */
export async function refreshLocationsSnapshot(query: LocationQuery, options: LocationsRequestOptions = {}): Promise<LocationSearchResult> {
  options.onPhase?.('retrieving-locations');
  const fresh = await withSnapshotProgress(query, options, () => getCachedLocations(query, true, options.entityId, options.signal));
  return enrichResult(fresh, options);
}
