import { concurGet } from './concurFetch';
import { entityRequestHeaders } from '../entities/entityStore';
import type {
  LocalityCountriesResponse,
  LocalityCountriesSnapshot,
  LocalityCountry,
  LocalityLocation,
  LocalityLocationQuery,
  LocalityLocationsResponse,
  LocalitySubdivision,
  LocalitySubdivisionsResponse,
} from '../types';

const LOCALITIES_ROOT = '/localities/v5';
const SEARCH_TEXT_SPECIAL_CHARS = /[~!@#$%^&]/;
const LOC_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

function cleanCode(value?: string): string | undefined {
  const v = value?.trim().toUpperCase();
  return v || undefined;
}

function cleanText(value?: string): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

async function localSnapshotFetch<T>(url: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(url, { ...init, headers: { ...entityRequestHeaders(), ...init.headers }, cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Localities request failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as T;
}

export function getLocalityCountriesSnapshot(): Promise<LocalityCountriesSnapshot | null> {
  return localSnapshotFetch<LocalityCountriesSnapshot>('/api/local/localities/countries');
}

export async function refreshLocalityCountries(): Promise<LocalityCountriesSnapshot> {
  const snapshot = await localSnapshotFetch<LocalityCountriesSnapshot>('/api/local/localities/countries/refresh', { method: 'POST' });
  if (!snapshot) throw new Error('Localities countries refresh returned no snapshot');
  return snapshot;
}

export async function getLocalityCountries(): Promise<LocalityCountry[]> {
  const response = await concurGet<LocalityCountriesResponse>(`${LOCALITIES_ROOT}/countries`);
  return response.countries ?? [];
}

export function getLocalityCountry(countryCode: string): Promise<LocalityCountry> {
  const code = cleanCode(countryCode);
  if (!code) throw new Error('Country code is required');
  return concurGet<LocalityCountry>(`${LOCALITIES_ROOT}/countries/${encodeURIComponent(code)}`);
}

export async function getLocalitySubdivisions(countryCode: string): Promise<LocalitySubdivision[]> {
  const code = cleanCode(countryCode);
  if (!code) throw new Error('Country code is required');
  const response = await concurGet<LocalitySubdivisionsResponse>(`${LOCALITIES_ROOT}/subdivisions?countryCode=${encodeURIComponent(code)}`);
  return response.subdivisions ?? [];
}

export function getLocalitySubdivision(subdivisionCode: string): Promise<LocalitySubdivision> {
  const code = cleanCode(subdivisionCode);
  if (!code) throw new Error('Subdivision code is required');
  return concurGet<LocalitySubdivision>(`${LOCALITIES_ROOT}/subdivisions/${encodeURIComponent(code)}`);
}

export function buildLocalityLocationsPath(query: LocalityLocationQuery): string {
  const locCode = cleanCode(query.locCode);
  const searchText = cleanText(query.searchText);
  if (!locCode && !searchText) throw new Error('Search text or locCode is required');

  const params = new URLSearchParams();
  if (locCode) {
    if (!LOC_CODE_PATTERN.test(locCode)) {
      throw new Error('LocCode can only contain letters, numbers, hyphen, or underscore');
    }
    params.set('locCode', locCode);
  } else if (searchText) {
    if (SEARCH_TEXT_SPECIAL_CHARS.test(searchText)) {
      throw new Error('Search text cannot contain special characters such as ~ ! @ # $ % ^ &');
    }
    params.set('searchText', searchText);
    const countryCode = cleanCode(query.countryCode);
    const subdivisionCode = cleanCode(query.subdivisionCode);
    if (countryCode) params.set('countryCode', countryCode);
    if (subdivisionCode) params.set('subdivisionCode', subdivisionCode);
  }
  return `${LOCALITIES_ROOT}/locations?${params.toString()}`;
}

export async function searchLocalityLocations(query: LocalityLocationQuery, entityId?: string, signal?: AbortSignal): Promise<LocalityLocation[]> {
  const path = buildLocalityLocationsPath(query);
  const init: RequestInit = {
    ...(entityId ? { headers: entityRequestHeaders(entityId) } : {}),
    ...(signal ? { signal } : {}),
  };
  const response = entityId || signal
    ? await concurGet<LocalityLocationsResponse>(path, init)
    : await concurGet<LocalityLocationsResponse>(path);
  return response.locations ?? [];
}
