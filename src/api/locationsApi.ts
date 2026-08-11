import { concurGet } from './concurFetch';
import type { ConcurLocation, LocationQuery, LocationSearchResult, LocationsResponse } from '../types';

const LOCATIONS_PATH = '/api/v3.0/common/locations';
export const PAGE_LIMIT = 100;
const MAX_PAGES = 100; // safety valve: never follow more than 100 NextPage links

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

async function fetchPage(path: string): Promise<{ items: ConcurLocation[]; nextPath: string | null }> {
  const res = await concurGet<LocationsResponse>(path);
  const next = res.NextPage?.trim();
  return { items: res.Items ?? [], nextPath: next ? toRelativePath(next) : null };
}

/** Fetches the first page only; `hasMore` signals that the server holds further pages. */
export async function searchLocations(query: LocationQuery): Promise<LocationSearchResult> {
  const page = await fetchPage(buildLocationsPath(query));
  return { locations: page.items, hasMore: page.nextPath !== null };
}

/** Fetches every page, following NextPage links (capped by MAX_PAGES). */
export async function fetchAllLocations(query: LocationQuery): Promise<LocationSearchResult> {
  let path: string | null = buildLocationsPath(query);
  const locations: ConcurLocation[] = [];
  let pages = 0;
  while (path && pages < MAX_PAGES) {
    const page = await fetchPage(path);
    locations.push(...page.items);
    path = page.nextPath;
    pages += 1;
  }
  return { locations, hasMore: path !== null };
}
