import { join } from 'node:path';
import { getServerAccessToken } from './concurAuth';
import { createEntityRegistry } from './entities';
import { logApiCall, logApiCallFailure } from './logger';
import { upstreamFetch } from './upstreamFetch';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';

const PAGE_LIMIT = 100;
const MAX_PAGES = 1000;
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const COUNTRY_CODE = /^[A-Z]{2}$/;

export interface CachedLocation {
  ID?: string;
  Name?: string;
  City?: string;
  Country?: string;
  CountrySubdivision?: string;
  AdministrativeRegion?: string;
  IATACode?: string;
  IsAirport?: boolean;
  IsBookingTool?: boolean;
  Latitude?: number;
  Longitude?: number;
  URI?: string;
  LocationNameId?: string;
}

interface LocationsPage {
  Items?: CachedLocation[];
  NextPage?: string | null;
}

export interface CountryLocationsSnapshot {
  entityId: string;
  country: string;
  retrievedAt: string;
  complete: boolean;
  pageCount: number;
  count: number;
  locations: CachedLocation[];
}

export interface CachedLocationsResult {
  locations: CachedLocation[];
  hasMore: false;
  source: 'cache' | 'concur';
  snapshotCountry: string;
  snapshotAt: string;
  snapshotStale: boolean;
  snapshotComplete: boolean;
}

export interface CachedLocationQuery {
  country: string;
  countrySubdivision?: string;
  city?: string;
  name?: string;
}

const pendingSnapshots = new Map<string, Promise<CountryLocationsSnapshot>>();

function normalizedCountry(value: string): string {
  const country = value.trim().toUpperCase();
  if (!COUNTRY_CODE.test(country)) throw new Error(`Invalid ISO country code "${value}".`);
  return country;
}

function snapshotFilePath(entityId: string, country: string): string {
  return join(process.env.DATA_DIR ?? 'data', entityId, 'locations', `${normalizedCountry(country)}.json`);
}

function baseUrl(entityId: string): string {
  return createEntityRegistry().require(entityId).baseUrl;
}

function headerMap(headers: { forEach: (cb: (value: string, key: string) => void) => void }): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => { out[key.toLowerCase()] = value; });
  return out;
}

async function fetchPage(entityId: string, url: string, token: string): Promise<LocationsPage> {
  const requestHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const start = Date.now();
  let response;
  try {
    response = await upstreamFetch(url, { method: 'GET', headers: requestHeaders });
  } catch (error) {
    logApiCallFailure(entityId, {
      method: 'GET', url, requestHeaders, requestBody: '',
      error: error instanceof Error ? error.message : String(error),
      responseTimeMs: Date.now() - start,
    });
    throw error;
  }
  const text = await response.text();
  logApiCall(entityId, {
    method: 'GET', url, requestHeaders, requestBody: '',
    response: { status: response.status, headers: headerMap(response.headers), body: text },
    responseTimeMs: Date.now() - start,
  });
  if (!response.ok) throw new Error(`Locations retrieval failed: HTTP ${response.status} — ${text.slice(0, 200)}`);
  return JSON.parse(text) as LocationsPage;
}

export function readCountryLocationsSnapshot(entityId: string, country: string): CountryLocationsSnapshot | null {
  const file = snapshotFilePath(entityId, country);
  const snapshot = readJsonSnapshot<CountryLocationsSnapshot>(file);
  if (!snapshot) return null;
  if (snapshot.entityId !== entityId || snapshot.country !== normalizedCountry(country) || !Array.isArray(snapshot.locations)) {
    throw new CorruptSnapshotError(file, new Error('Snapshot metadata or locations collection is invalid'));
  }
  return snapshot;
}

function writeCountryLocationsSnapshot(snapshot: CountryLocationsSnapshot): void {
  writeJsonSnapshot(snapshotFilePath(snapshot.entityId, snapshot.country), snapshot, true);
}

export async function fetchCountryLocationsSnapshot(entityId: string, countryValue: string): Promise<CountryLocationsSnapshot> {
  const country = normalizedCountry(countryValue);
  const pendingKey = `${entityId}:${country}`;
  const existing = pendingSnapshots.get(pendingKey);
  if (existing) return existing;

  const request = (async () => {
    const token = await getServerAccessToken(entityId);
    let url: string | null = `${baseUrl(entityId)}/api/v3.0/common/locations?limit=${PAGE_LIMIT}&country=${country}`;
    const seenUrls = new Set<string>();
    const locations: CachedLocation[] = [];
    let pageCount = 0;

    while (url && pageCount < MAX_PAGES && !seenUrls.has(url)) {
      seenUrls.add(url);
      const page = await fetchPage(entityId, url, token);
      locations.push(...(page.Items ?? []));
      pageCount += 1;
      const next = page.NextPage?.trim();
      url = next ? new URL(next, baseUrl(entityId)).toString() : null;
    }

    const snapshot: CountryLocationsSnapshot = {
      entityId,
      country,
      retrievedAt: new Date().toISOString(),
      complete: url === null,
      pageCount,
      count: locations.length,
      locations,
    };
    writeCountryLocationsSnapshot(snapshot);
    return snapshot;
  })().finally(() => pendingSnapshots.delete(pendingKey));

  pendingSnapshots.set(pendingKey, request);
  return request;
}

function includes(value: unknown, needle?: string): boolean {
  if (!needle) return true;
  return String(value ?? '').toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
}

function filterSnapshot(snapshot: CountryLocationsSnapshot, query: CachedLocationQuery): CachedLocation[] {
  const subdivision = query.countrySubdivision?.trim().toUpperCase();
  return snapshot.locations.filter((location) =>
    (!subdivision || location.CountrySubdivision?.toUpperCase() === subdivision)
    && (!query.city || includes(location.City, query.city) || includes(location.Name, query.city) || includes(location.AdministrativeRegion, query.city))
    && includes(location.Name, query.name)
  );
}

export async function searchCountryLocations(
  entityId: string,
  query: CachedLocationQuery,
  refresh = false,
): Promise<CachedLocationsResult> {
  const country = normalizedCountry(query.country);
  const cached = refresh ? null : readCountryLocationsSnapshot(entityId, country);
  const snapshot = cached ?? await fetchCountryLocationsSnapshot(entityId, country);
  return {
    locations: filterSnapshot(snapshot, query),
    hasMore: false,
    source: cached ? 'cache' : 'concur',
    snapshotCountry: country,
    snapshotAt: snapshot.retrievedAt,
    snapshotStale: Date.now() - new Date(snapshot.retrievedAt).getTime() > SNAPSHOT_TTL_MS,
    snapshotComplete: snapshot.complete,
  };
}

interface ServerResponse {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function queryFromUrl(rawUrl: string): CachedLocationQuery {
  const params = new URL(rawUrl, 'http://localhost').searchParams;
  const country = params.get('country') ?? '';
  return {
    country,
    countrySubdivision: params.get('countrySubdivision') || undefined,
    city: params.get('city') || undefined,
    name: params.get('name') || undefined,
  };
}

export async function handleSearchCountryLocations(response: ServerResponse, entityId: string, rawUrl: string): Promise<void> {
  try {
    sendJson(response, 200, await searchCountryLocations(entityId, queryFromUrl(rawUrl)));
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function handleRefreshCountryLocations(response: ServerResponse, entityId: string, rawUrl: string): Promise<void> {
  try {
    sendJson(response, 200, await searchCountryLocations(entityId, queryFromUrl(rawUrl), true));
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}
