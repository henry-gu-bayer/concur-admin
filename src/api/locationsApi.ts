import { concurGet } from './concurFetch';
import { searchLocalityLocations } from './localitiesApi';
import { entityRequestHeaders } from '../entities/entityStore';
import type { ConcurLocation, LocationQuery, LocationSearchResult, LocationsResponse } from '../types';

const LOCATIONS_PATH = '/api/v3.0/common/locations';
export const PAGE_LIMIT = 100;
const MAX_PAGES = 100; // safety valve: never follow more than 100 NextPage links
const LOCALITY_LOOKUP_CONCURRENCY = 6;

export interface LocationsRequestOptions {
  entityId?: string;
  signal?: AbortSignal;
  onPhase?: (phase: 'retrieving-locations' | 'matching-localities') => void;
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
export async function enrichLocationsWithLocCodes(locations: ConcurLocation[], entityId?: string, signal?: AbortSignal): Promise<ConcurLocation[]> {
  const groups = new Map<string, LocalityLookupGroup>();
  for (const location of locations) {
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
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOCALITY_LOOKUP_CONCURRENCY, pending.length) }, worker));

  return locations.map((location) => {
    const locationNameId = normalizeLocationNameId(location.LocationNameId);
    const locCode = locationNameId ? locCodeByLocationNameId.get(locationNameId) : undefined;
    return locCode ? { ...location, LocCode: locCode } : location;
  });
}

async function enrichResult(result: LocationSearchResult, options: LocationsRequestOptions): Promise<LocationSearchResult> {
  options.onPhase?.('matching-localities');
  return { ...result, locations: await enrichLocationsWithLocCodes(result.locations, options.entityId, options.signal) };
}

/** Fetches the first page only; `hasMore` signals that the server holds further pages. */
export async function searchLocations(query: LocationQuery, options: LocationsRequestOptions = {}): Promise<LocationSearchResult> {
  options.onPhase?.('retrieving-locations');
  if (query.country?.trim()) return enrichResult(await getCachedLocations(query, false, options.entityId, options.signal), options);
  const page = await fetchPage(buildLocationsPath(query), options.entityId, options.signal);
  return enrichResult({ locations: page.items, hasMore: page.nextPath !== null }, options);
}

/** Fetches every page, following NextPage links (capped by MAX_PAGES). */
export async function fetchAllLocations(query: LocationQuery, options: LocationsRequestOptions = {}): Promise<LocationSearchResult> {
  options.onPhase?.('retrieving-locations');
  if (query.country?.trim()) return enrichResult(await getCachedLocations(query, false, options.entityId, options.signal), options);
  let path: string | null = buildLocationsPath(query);
  const locations: ConcurLocation[] = [];
  let pages = 0;
  while (path && pages < MAX_PAGES) {
    const page = await fetchPage(path, options.entityId, options.signal);
    locations.push(...page.items);
    path = page.nextPath;
    pages += 1;
  }
  return enrichResult({ locations, hasMore: path !== null }, options);
}

/** Force a fresh full-country snapshot, then apply the current filters locally. */
export async function refreshLocationsSnapshot(query: LocationQuery, options: LocationsRequestOptions = {}): Promise<LocationSearchResult> {
  options.onPhase?.('retrieving-locations');
  return enrichResult(await getCachedLocations(query, true, options.entityId, options.signal), options);
}
