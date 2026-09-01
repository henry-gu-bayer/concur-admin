import { join } from 'node:path';
import { getServerAccessToken } from './concurAuth';
import { createEntityRegistry } from './entities';
import { logApiCall, logApiCallFailure } from './logger';
import { upstreamFetch } from './upstreamFetch';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';

const PAGE_LIMIT = 100;
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const INCOMPLETE_RETRY_MS = 10 * 60 * 1000;
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
  /** Localities v5 code, matched client-side and written back into the snapshot. */
  LocCode?: string;
}

interface LocationsPage {
  Items?: CachedLocation[];
  NextPage?: string | null;
  /** Not documented for every tenant; used to seed progress only when present. */
  TotalCount?: number;
}

export interface CountryLocationsSnapshot {
  entityId: string;
  country: string;
  retrievedAt: string;
  complete: boolean;
  pageCount: number;
  count: number;
  locations: CachedLocation[];
  /**
   * Set once a locCode matching pass covered every row without a lookup error.
   * Its presence is what lets the client skip the Localities v5 stage, so a
   * partial pass must leave it unset.
   */
  locCodesAt?: string;
}

export interface CachedLocationsResult {
  locations: CachedLocation[];
  hasMore: false;
  source: 'cache' | 'concur';
  snapshotCountry: string;
  snapshotAt: string;
  snapshotStale: boolean;
  snapshotComplete: boolean;
  /** Records held by the snapshot, which is not the filtered result count. */
  snapshotCount: number;
  locCodesResolved: boolean;
}

export type CountryLocationsProgressState = 'idle' | 'running' | 'complete' | 'error';

export interface CountryLocationsProgress {
  entityId: string;
  country: string;
  state: CountryLocationsProgressState;
  startedAt: string | null;
  updatedAt: string | null;
  pagesDone: number;
  pagesTotal: number | null;
  rowsDone: number;
  percent: number | null;
  error?: string;
}

export interface CachedLocationQuery {
  country: string;
  countrySubdivision?: string;
  city?: string;
  name?: string;
}

const pendingSnapshots = new Map<string, Promise<CountryLocationsSnapshot>>();
const progressByKey = new Map<string, CountryLocationsProgress>();

function normalizedCountry(value: string): string {
  const country = value.trim().toUpperCase();
  if (!COUNTRY_CODE.test(country)) throw new Error(`Invalid ISO country code "${value}".`);
  return country;
}

function snapshotFilePath(entityId: string, country: string): string {
  return join(entityDataDirectory(entityId), 'locations', `${normalizedCountry(country)}.json`);
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

function progressKey(entityId: string, country: string): string {
  return `${entityId}:${country}`;
}

function idleLocationsProgress(entityId: string, country: string): CountryLocationsProgress {
  return {
    entityId, country, state: 'idle', startedAt: null, updatedAt: null,
    pagesDone: 0, pagesTotal: null, rowsDone: 0, percent: null,
  };
}

export function getCountryLocationsProgress(entityId: string, countryValue: string): CountryLocationsProgress {
  const country = normalizedCountry(countryValue);
  return progressByKey.get(progressKey(entityId, country)) ?? idleLocationsProgress(entityId, country);
}

/**
 * Locations v3 exposes no reliable total, so the denominator is an estimate and
 * can be wrong in either direction. Clamping to the previous value keeps the bar
 * from walking backwards when the estimate turns out to be too low.
 */
function monotonicPercent(previous: number | null, pagesDone: number, pagesTotal: number | null): number | null {
  if (pagesTotal === null || pagesTotal <= 0) return previous;
  const raw = Math.min(99, Math.floor((pagesDone / pagesTotal) * 100));
  return previous === null ? raw : Math.max(previous, raw);
}

/** Page count of the previous snapshot, which is the best available estimate. */
function seedPagesTotal(entityId: string, country: string): number | null {
  try {
    const previous = readCountryLocationsSnapshot(entityId, country);
    return previous?.complete && previous.pageCount > 0 ? previous.pageCount : null;
  } catch {
    // A corrupt previous snapshot only costs us the estimate.
    return null;
  }
}

export function resetCountryLocationsProgress(): void {
  progressByKey.clear();
}

export async function fetchCountryLocationsSnapshot(entityId: string, countryValue: string): Promise<CountryLocationsSnapshot> {
  const country = normalizedCountry(countryValue);
  const pendingKey = progressKey(entityId, country);
  const existing = pendingSnapshots.get(pendingKey);
  if (existing) return existing;

  const request = (async () => {
    const startedAt = new Date().toISOString();
    let pagesTotal = seedPagesTotal(entityId, country);
    let percent: number | null = null;
    progressByKey.set(pendingKey, {
      ...idleLocationsProgress(entityId, country),
      state: 'running', startedAt, updatedAt: startedAt, pagesTotal,
    });

    try {
      const token = await getServerAccessToken(entityId);
      let url: string | null = `${baseUrl(entityId)}/api/v3.0/common/locations?limit=${PAGE_LIMIT}&country=${country}`;
      const seenUrls = new Set<string>();
      const locations: CachedLocation[] = [];
      let pageCount = 0;

      // Paginate to exhaustion so the snapshot is the complete country set. The
      // repeated-URL guard is what stops a malformed `NextPage` from looping.
      while (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        const page = await fetchPage(entityId, url, token);
        locations.push(...(page.Items ?? []));
        pageCount += 1;

        if (typeof page.TotalCount === 'number' && Number.isFinite(page.TotalCount) && page.TotalCount > 0) {
          pagesTotal = Math.ceil(page.TotalCount / PAGE_LIMIT);
        }
        // Outgrowing the estimate means the country gained pages since last time;
        // grow the denominator rather than pinning the bar at its ceiling.
        if (pagesTotal !== null && pageCount >= pagesTotal) pagesTotal = pageCount + 1;
        percent = monotonicPercent(percent, pageCount, pagesTotal);
        progressByKey.set(pendingKey, {
          entityId, country, state: 'running', startedAt, updatedAt: new Date().toISOString(),
          pagesDone: pageCount, pagesTotal, rowsDone: locations.length, percent,
        });

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
      progressByKey.set(pendingKey, {
        entityId, country, state: 'complete', startedAt, updatedAt: new Date().toISOString(),
        pagesDone: pageCount, pagesTotal: pageCount, rowsDone: locations.length, percent: 100,
      });
      return snapshot;
    } catch (error) {
      progressByKey.set(pendingKey, {
        ...getCountryLocationsProgress(entityId, country),
        state: 'error',
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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

/**
 * A truncated snapshot is not a usable cache: serving it would hide the missing
 * records forever, because only an explicit refresh would ever replace it. Retry
 * it — but not on every search, since a country that keeps truncating would
 * otherwise re-paginate in full each time for records it cannot reach anyway.
 */
function usableCache(snapshot: CountryLocationsSnapshot | null): CountryLocationsSnapshot | null {
  if (!snapshot || snapshot.complete) return snapshot;
  const age = Date.now() - new Date(snapshot.retrievedAt).getTime();
  return age < INCOMPLETE_RETRY_MS ? snapshot : null;
}

export async function searchCountryLocations(
  entityId: string,
  query: CachedLocationQuery,
  refresh = false,
): Promise<CachedLocationsResult> {
  const country = normalizedCountry(query.country);
  const cached = refresh ? null : usableCache(readCountryLocationsSnapshot(entityId, country));
  const snapshot = cached ?? await fetchCountryLocationsSnapshot(entityId, country);
  return {
    locations: filterSnapshot(snapshot, query),
    hasMore: false,
    source: cached ? 'cache' : 'concur',
    snapshotCountry: country,
    snapshotAt: snapshot.retrievedAt,
    snapshotStale: Date.now() - new Date(snapshot.retrievedAt).getTime() > SNAPSHOT_TTL_MS,
    snapshotComplete: snapshot.complete,
    snapshotCount: snapshot.count,
    locCodesResolved: snapshot.locCodesAt !== undefined,
  };
}

/** Must match the client's normalisation so the two sides cannot drift apart. */
function normalizeLocationNameId(value?: string): string | undefined {
  const id = value?.trim().toLocaleLowerCase();
  return id || undefined;
}

export interface LocCodeWriteBack {
  country?: string;
  locCodes?: Record<string, string>;
  complete?: boolean;
}

/**
 * Persists locCodes matched client-side so later searches skip the Localities
 * v5 pass entirely — on a large country that pass costs thousands of requests
 * and several minutes on data the snapshot already holds.
 */
export function writeCountryLocationsLocCodes(entityId: string, payload: LocCodeWriteBack): { applied: number; locCodesAt: string | null } {
  const country = normalizedCountry(payload.country ?? '');
  const snapshot = readCountryLocationsSnapshot(entityId, country);
  if (!snapshot) throw new Error(`No ${country} locations snapshot to annotate.`);

  const locCodes = payload.locCodes ?? {};
  let applied = 0;
  for (const location of snapshot.locations) {
    const id = normalizeLocationNameId(location.LocationNameId);
    if (!id) continue;
    const locCode = locCodes[id];
    if (!locCode || location.LocCode === locCode) continue;
    location.LocCode = locCode;
    applied += 1;
  }

  // Only a pass where every lookup settled may mark the snapshot resolved; a
  // partial pass keeps the codes it found and leaves the rest to be retried.
  if (payload.complete === true) snapshot.locCodesAt = new Date().toISOString();
  writeCountryLocationsSnapshot(snapshot);
  return { applied, locCodesAt: snapshot.locCodesAt ?? null };
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

export function handleGetCountryLocationsProgress(response: ServerResponse, entityId: string, rawUrl: string): void {
  try {
    const country = new URL(rawUrl, 'http://localhost').searchParams.get('country') ?? '';
    sendJson(response, 200, { progress: getCountryLocationsProgress(entityId, country) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleWriteCountryLocationsLocCodes(response: ServerResponse, entityId: string, body: unknown): void {
  try {
    sendJson(response, 200, writeCountryLocationsLocCodes(entityId, (body ?? {}) as LocCodeWriteBack));
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}
