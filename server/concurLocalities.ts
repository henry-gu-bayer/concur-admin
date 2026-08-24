import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getServerAccessToken } from './concurAuth';
import { logApiCall, logApiCallFailure } from './logger';
import { createEntityRegistry } from './entities';
import { upstreamFetch } from './upstreamFetch';

export interface LocalityLink {
  rel?: string;
  href?: string;
}

export interface LocalityName {
  id?: string;
  name?: string;
  langCode?: string;
  legacyKey?: number;
  active?: boolean;
}

export interface LocalityCurrency {
  code?: string;
}

export interface LocalityCountry {
  code: string;
  active?: boolean;
  numCode?: number;
  alpha3Code?: string;
  distanceUnitCode?: string;
  names?: LocalityName[];
  currencies?: LocalityCurrency[];
  links?: LocalityLink[];
}

export interface LocalityCountriesSnapshot {
  retrievedAt: string;
  countries: LocalityCountry[];
}

function baseUrl(entityId: string): string {
  return createEntityRegistry().require(entityId).baseUrl;
}

function headerMap(headers: { forEach: (cb: (v: string, k: string) => void) => void }): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

async function fetchJson<T>(entityId: string, url: string, token: string): Promise<T> {
  const requestHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const start = Date.now();
  let res;
  try {
    res = await upstreamFetch(url, { method: 'GET', headers: requestHeaders });
  } catch (err) {
    logApiCallFailure(entityId, {
      method: 'GET',
      url,
      requestHeaders,
      requestBody: '',
      error: err instanceof Error ? err.message : String(err),
      responseTimeMs: Date.now() - start,
    });
    throw err;
  }
  const responseTimeMs = Date.now() - start;
  const text = await res.text();
  logApiCall(entityId, {
    method: 'GET',
    url,
    requestHeaders,
    requestBody: '',
    response: { status: res.status, headers: headerMap(res.headers), body: text },
    responseTimeMs,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 160)}`);
  }
  return JSON.parse(text) as T;
}

function countriesFilePath(entityId: string): string {
  return join(process.env.DATA_DIR ?? 'data', entityId, 'localities-countries.json');
}

export function readLocalityCountriesSnapshot(entityId: string): LocalityCountriesSnapshot | null {
  const file = countriesFilePath(entityId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as LocalityCountriesSnapshot;
  } catch {
    return null;
  }
}

function writeLocalityCountriesSnapshot(entityId: string, snapshot: LocalityCountriesSnapshot): void {
  mkdirSync(dirname(countriesFilePath(entityId)), { recursive: true });
  writeFileSync(countriesFilePath(entityId), JSON.stringify(snapshot), 'utf-8');
}

export async function fetchLocalityCountries(entityId: string): Promise<LocalityCountriesSnapshot> {
  const token = await getServerAccessToken(entityId);
  const body = await fetchJson<{ countries?: LocalityCountry[] }>(
    entityId,
    `${baseUrl(entityId)}/localities/v5/countries`,
    token,
  );
  const snapshot: LocalityCountriesSnapshot = {
    retrievedAt: new Date().toISOString(),
    countries: body.countries ?? [],
  };
  writeLocalityCountriesSnapshot(entityId, snapshot);
  return snapshot;
}

interface ServerResponse {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function handleGetLocalityCountries(res: ServerResponse, entityId: string): void {
  const snapshot = readLocalityCountriesSnapshot(entityId);
  if (!snapshot) {
    return sendJson(res, 404, { error: 'No localities countries snapshot yet — use Refresh to fetch from Concur.' });
  }
  sendJson(res, 200, snapshot);
}

export async function handleRefreshLocalityCountries(res: ServerResponse, entityId: string): Promise<void> {
  try {
    sendJson(res, 200, await fetchLocalityCountries(entityId));
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
