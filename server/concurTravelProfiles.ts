import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getServerAccessToken, refreshServerAccessToken } from './concurAuth';
import { createEntityRegistry } from './entities';
import { getRefreshedUserProfile } from './concurUserProfileRefresh';
import { getActiveUserById, getActiveUsersByIds, readActiveUsersSummary, type ActiveUserProfile } from './concurUsers';
import { logApiCall, logApiCallFailure } from './logger';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { upstreamFetch } from './upstreamFetch';
import { entityDataDirectory } from './entityDataDirectory';

const TRAVEL_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:travel:2.0:User';
const ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const PAGE_SIZE = 100;
const STANDARD_FIELDS = ['ruleClassName', 'ruleClassId', 'eReceiptOptIn', 'managerLoginId', 'givenName', 'familyName', 'middleName', 'orgUnit', 'groups'];

export interface TravelProfileResource {
  id: string;
  [TRAVEL_USER_SCHEMA]?: Record<string, unknown> & { customFields?: Array<{ name?: string; value?: unknown }> };
  [key: string]: unknown;
}
interface TravelProfilesPage { Resources?: TravelProfileResource[]; totalResults?: number; startIndex?: number; itemsPerPage?: number }
interface FilterCondition { id: string; kind: 'condition'; field: string; operator: 'eq' | 'ne' | 'contains' | 'startsWith' | 'endsWith' | 'empty' | 'notEmpty' | 'before' | 'after'; value: string }
interface FilterGroup { id: string; kind: 'group'; logic: 'and' | 'or'; items: Array<FilterCondition | FilterGroup> }
interface Query { offset: number; limit: number; filters: FilterGroup; sortBy: string; sortDir: 'asc' | 'desc'; includeOrphans: boolean }
export interface TravelProfilesSnapshot { entityId: string; retrievedAt: string; count: number; pageCount: number; profiles: TravelProfileResource[]; identityGeneration?: string }
export interface TravelProfilesSummary { entityId: string; retrievedAt: string; count: number; pageCount: number; identityCount: number; identityGeneration?: string; identityStale?: boolean; travelFields: string[]; customFields: string[] }
export interface TravelProfilesProgress { entityId: string; state: 'idle' | 'running' | 'complete' | 'paused'; startedAt: string | null; updatedAt: string | null; retrievedCount: number; totalResults: number | null; pageCount: number; startIndex: number | null; itemsPerPage: number; percent: number; elapsedMs: number; error?: string; travelFields?: string[]; customFields?: string[] }

const progressByEntity = new Map<string, TravelProfilesProgress>();
const pendingRefreshes = new Map<string, Promise<TravelProfilesSnapshot>>();
const snapshotCache = new Map<string, {
  mtimeMs: number;
  snapshot: TravelProfilesSnapshot;
  values: Map<string, Record<string, string>>;
  identities: Map<string, ActiveUserProfile | null>;
  identityIndex?: Map<string, ActiveUserProfile>;
  managerLoginIds?: Map<string, string>;
}>();

function snapshotPath(entityId: string) { return join(entityDataDirectory(entityId), 'identity', 'travel-profiles.json'); }
function summaryPath(entityId: string) { return join(entityDataDirectory(entityId), 'identity', 'travel-profiles-summary.json'); }
function managerLoginsPath(entityId: string) { return join(entityDataDirectory(entityId), 'identity', 'travel-profile-manager-logins.json'); }
function idleProgress(entityId: string): TravelProfilesProgress { return { entityId, state: 'idle', startedAt: null, updatedAt: null, retrievedCount: 0, totalResults: null, pageCount: 0, startIndex: null, itemsPerPage: PAGE_SIZE, percent: 0, elapsedMs: 0 }; }
function headerMap(headers: { forEach: (callback: (value: string, key: string) => void) => void }) { const result: Record<string, string> = {}; headers.forEach((value, key) => { result[key.toLowerCase()] = value; }); return result; }
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object' && 'value' in (value as Record<string, unknown>)) return stringifyValue((value as Record<string, unknown>).value);
  return JSON.stringify(value);
}
function primaryEmail(user?: ActiveUserProfile | null) { return user?.emails?.find((email) => email.type === 'work')?.value ?? user?.emails?.[0]?.value ?? ''; }
function preferredName(user?: ActiveUserProfile | null) { return user?.preferredName ?? user?.displayName ?? user?.name?.formatted ?? [user?.name?.givenName, user?.name?.familyName].filter(Boolean).join(' '); }
function fieldsFrom(profiles: TravelProfileResource[]) {
  const travel = new Set<string>(); const custom = new Set<string>();
  for (const profile of profiles) {
    const extension = profile[TRAVEL_USER_SCHEMA];
    if (!extension) continue;
    for (const key of Object.keys(extension)) {
      if (key === 'ruleClass') { travel.add('ruleClassName'); travel.add('ruleClassId'); }
      else if (key === 'manager') travel.add('managerLoginId');
      else if (key === 'name') { travel.add('givenName'); travel.add('familyName'); travel.add('middleName'); }
      else if (key !== 'customFields') travel.add(key);
    }
    for (const field of extension.customFields ?? []) if (field.name) custom.add(field.name);
  }
  const sort = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  return { travelFields: [...STANDARD_FIELDS.filter((field) => travel.has(field)), ...[...travel].filter((field) => !STANDARD_FIELDS.includes(field)).sort(sort)], customFields: [...custom].sort(sort) };
}

export function readTravelProfilesSnapshot(entityId: string): TravelProfilesSnapshot | null {
  const file = snapshotPath(entityId);
  if (!existsSync(file)) return null;
  const mtimeMs = statSync(file).mtimeMs;
  const cached = snapshotCache.get(entityId);
  if (cached?.mtimeMs === mtimeMs) return cached.snapshot;
  const snapshot = readJsonSnapshot<TravelProfilesSnapshot>(file)!;
  if (snapshot.entityId !== entityId || !Array.isArray(snapshot.profiles)) throw new CorruptSnapshotError(file, new Error('Snapshot metadata or profiles collection is invalid'));
  snapshotCache.set(entityId, { mtimeMs, snapshot, values: new Map(), identities: new Map() });
  return snapshot;
}

export function readTravelProfilesSummary(entityId: string): TravelProfilesSummary | null {
  const identity = readActiveUsersSummary(entityId);
  const file = summaryPath(entityId);
  if (existsSync(file)) {
    try {
      const summary = readJsonSnapshot<TravelProfilesSummary>(file)!;
      const usesLegacyJsonFields = ['ruleClass', 'manager', 'name'].some((field) => summary.travelFields?.includes(field));
      if (summary.entityId === entityId && Number.isFinite(summary.count) && !usesLegacyJsonFields) return { ...summary, identityStale: Boolean(summary.identityGeneration && identity?.generation && summary.identityGeneration !== identity.generation) };
    } catch { /* Recover the optional sidecar from the canonical snapshot. */ }
  }
  const snapshot = readTravelProfilesSnapshot(entityId);
  if (!snapshot) return null;
  const summary = { entityId, retrievedAt: snapshot.retrievedAt, count: snapshot.count, pageCount: snapshot.pageCount, identityCount: identity?.count ?? 0, identityGeneration: snapshot.identityGeneration, identityStale: Boolean(snapshot.identityGeneration && identity?.generation && snapshot.identityGeneration !== identity.generation), ...fieldsFrom(snapshot.profiles) };
  try { writeJsonSnapshot(file, summary); } catch { /* The canonical snapshot remains available. */ }
  return summary;
}

function cachedData(entityId: string, snapshot: TravelProfilesSnapshot) {
  const mtimeMs = statSync(snapshotPath(entityId)).mtimeMs;
  let cached = snapshotCache.get(entityId);
  if (!cached || cached.mtimeMs !== mtimeMs || cached.snapshot !== snapshot) { cached = { mtimeMs, snapshot, values: new Map(), identities: new Map() }; snapshotCache.set(entityId, cached); }
  return cached;
}
function nestedString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  return stringifyValue((value as Record<string, unknown>)[key]);
}
function managerId(profile: TravelProfileResource): string {
  return nestedString(profile[TRAVEL_USER_SCHEMA]?.manager, 'value').trim();
}
function managerLoginIds(entityId: string, snapshot: TravelProfilesSnapshot) {
  const cached = cachedData(entityId, snapshot);
  if (cached.managerLoginIds) return cached.managerLoginIds;
  const saved = readJsonSnapshot<{ entityId: string; logins?: Record<string, unknown> }>(managerLoginsPath(entityId));
  cached.managerLoginIds = new Map(Object.entries(saved?.entityId === entityId ? saved.logins ?? {} : {}).flatMap(([id, loginId]) => typeof loginId === 'string' ? [[id.toLocaleLowerCase(), loginId] as const] : []));
  return cached.managerLoginIds;
}
function saveManagerLoginIds(entityId: string, snapshot: TravelProfilesSnapshot) {
  const logins = Object.fromEntries(managerLoginIds(entityId, snapshot));
  try { writeJsonSnapshot(managerLoginsPath(entityId), { entityId, updatedAt: new Date().toISOString(), logins }); } catch { /* A derived lookup cache must not block local browsing. */ }
}
function valuesFor(entityId: string, profile: TravelProfileResource, snapshot: TravelProfilesSnapshot) {
  const cached = cachedData(entityId, snapshot);
  const existing = cached.values.get(profile.id);
  if (existing) return existing;
  cached.identityIndex ??= getActiveUsersByIds(entityId, snapshot.profiles.map((candidate) => candidate.id.toLocaleLowerCase()), snapshot.identityGeneration);
  let identity = cached.identities.get(profile.id);
  if (identity === undefined) { identity = cached.identityIndex.get(profile.id.toLocaleLowerCase()) ?? null; cached.identities.set(profile.id, identity); }
  const enterprise = identity?.[ENTERPRISE_USER_SCHEMA] as { employeeNumber?: string } | undefined;
  const values: Record<string, string> = { id: profile.id, identityPresent: String(Boolean(identity)), active: String(identity?.active ?? ''), loginId: identity?.userName ?? '', employeeNumber: enterprise?.employeeNumber ?? '', email: primaryEmail(identity), preferredName: preferredName(identity) };
  const extension = profile[TRAVEL_USER_SCHEMA] ?? {};
  const ruleClass = extension.ruleClass;
  const name = extension.name;
  const manager = managerId(profile);
  values.ruleClassName = nestedString(ruleClass, 'name');
  values.ruleClassId = nestedString(ruleClass, 'id');
  values.managerLoginId = manager ? managerLoginIds(entityId, snapshot).get(manager.toLocaleLowerCase()) ?? '' : '';
  values.givenName = nestedString(name, 'givenName');
  values.familyName = nestedString(name, 'familyName');
  values.middleName = nestedString(name, 'middleName');
  for (const [key, value] of Object.entries(extension)) if (key !== 'customFields' && key !== 'ruleClass' && key !== 'manager' && key !== 'name') values[key] = stringifyValue(value);
  for (const field of extension.customFields ?? []) if (field.name) values[field.name] = stringifyValue(field.value);
  cached.values.set(profile.id, values);
  return values;
}
function matches(values: Record<string, string>, condition: FilterCondition): boolean {
  const actual = (values[condition.field] ?? '').toLocaleLowerCase(); const expected = condition.value.toLocaleLowerCase();
  if (condition.operator === 'eq') return actual === expected;
  if (condition.operator === 'ne') return actual !== expected;
  if (condition.operator === 'contains') return actual.includes(expected);
  if (condition.operator === 'startsWith') return actual.startsWith(expected);
  if (condition.operator === 'endsWith') return actual.endsWith(expected);
  if (condition.operator === 'empty') return !actual;
  if (condition.operator === 'notEmpty') return Boolean(actual);
  if (condition.operator === 'before') return Boolean(actual) && actual.slice(0, 10) < expected;
  return Boolean(actual) && actual.slice(0, 10) > expected;
}
function matchesGroup(values: Record<string, string>, group: FilterGroup): boolean { if (!group.items.length) return true; const results = group.items.map((item) => item.kind === 'group' ? matchesGroup(values, item) : matches(values, item)); return group.logic === 'and' ? results.every(Boolean) : results.some(Boolean); }
function normalizeFilters(value: unknown, depth = 0): FilterGroup {
  const fallback: FilterGroup = { id: 'root', kind: 'group', logic: 'and', items: [] };
  if (!value || typeof value !== 'object') return fallback;
  const candidate = value as Record<string, unknown>;
  const allowed = new Set<FilterCondition['operator']>(['eq', 'ne', 'contains', 'startsWith', 'endsWith', 'empty', 'notEmpty', 'before', 'after']);
  return { id: typeof candidate.id === 'string' ? candidate.id : `group-${depth}`, kind: 'group', logic: candidate.logic === 'or' ? 'or' : 'and', items: depth >= 4 || !Array.isArray(candidate.items) ? [] : candidate.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    if (entry.kind === 'group') return [normalizeFilters(entry, depth + 1)];
    if (entry.kind !== 'condition' || typeof entry.field !== 'string') return [];
    return [{ id: typeof entry.id === 'string' ? entry.id : `condition-${depth}`, kind: 'condition' as const, field: entry.field, operator: allowed.has(entry.operator as FilterCondition['operator']) ? entry.operator as FilterCondition['operator'] : 'eq', value: typeof entry.value === 'string' ? entry.value : '' }];
  }) };
}
function normalizeQuery(value: unknown): Query { const body = value && typeof value === 'object' ? value as Partial<Query> : {}; return { offset: Math.max(0, Number(body.offset) || 0), limit: Math.max(1, Math.min(Number(body.limit) || 200, 500)), filters: normalizeFilters(body.filters), sortBy: typeof body.sortBy === 'string' && body.sortBy ? body.sortBy : 'loginId', sortDir: body.sortDir === 'desc' ? 'desc' : 'asc', includeOrphans: body.includeOrphans === true }; }
function matchingProfiles(entityId: string, snapshot: TravelProfilesSnapshot, query: Query) {
  const candidates = query.includeOrphans ? snapshot.profiles : snapshot.profiles.filter((profile) => valuesFor(entityId, profile, snapshot).identityPresent === 'true');
  const matching = query.filters.items.length ? candidates.filter((profile) => matchesGroup(valuesFor(entityId, profile, snapshot), query.filters)) : [...candidates];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); const direction = query.sortDir === 'asc' ? 1 : -1;
  return matching.sort((left, right) => collator.compare(valuesFor(entityId, left, snapshot)[query.sortBy] ?? '', valuesFor(entityId, right, snapshot)[query.sortBy] ?? '') * direction);
}
async function fetchManagerLoginId(entityId: string, userId: string, token: string, retried = false): Promise<string | null> {
  const url = `${createEntityRegistry().require(entityId).baseUrl}/profile/identity/v4.1/Users/${encodeURIComponent(userId)}`;
  const requestHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const startedAt = Date.now();
  let response: Awaited<ReturnType<typeof upstreamFetch>>;
  try {
    response = await upstreamFetch(url, { method: 'GET', headers: requestHeaders, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    logApiCallFailure(entityId, { method: 'GET', url, requestHeaders, requestBody: '', error: error instanceof Error ? error.message : String(error), responseTimeMs: Date.now() - startedAt });
    return null;
  }
  const text = await response.text();
  logApiCall(entityId, { method: 'GET', url, requestHeaders, requestBody: '', response: { status: response.status, headers: headerMap(response.headers), body: text }, responseTimeMs: Date.now() - startedAt });
  if (response.status === 401 && !retried) return fetchManagerLoginId(entityId, userId, await refreshServerAccessToken(entityId), true);
  if (!response.ok) return '';
  try {
    const profile = JSON.parse(text) as { userName?: unknown };
    return typeof profile.userName === 'string' ? profile.userName : '';
  } catch { return ''; }
}
async function resolveManagerLoginIds(entityId: string, snapshot: TravelProfilesSnapshot, profiles: TravelProfileResource[]) {
  const cache = cachedData(entityId, snapshot);
  const logins = managerLoginIds(entityId, snapshot);
  const managerIds = [...new Set(profiles.map(managerId).filter(Boolean))];
  if (!managerIds.length) return;
  const local = getActiveUsersByIds(entityId, managerIds.map((id) => id.toLocaleLowerCase()), snapshot.identityGeneration);
  let changed = false;
  for (const id of managerIds) {
    const key = id.toLocaleLowerCase(); const localLoginId = local.get(key)?.userName?.trim();
    if (localLoginId && logins.get(key) !== localLoginId) { logins.set(key, localLoginId); changed = true; }
  }
  const unresolved = managerIds.filter((id) => {
    const key = id.toLocaleLowerCase();
    return !local.get(key)?.userName?.trim() && !logins.has(key);
  });
  if (unresolved.length) {
    let token: string;
    try { token = await getServerAccessToken(entityId); } catch { token = ''; }
    if (token) {
      // Resolve only the visible page and cap concurrency so a large page never overwhelms Identity.
      for (let offset = 0; offset < unresolved.length; offset += 8) {
        const results = await Promise.all(unresolved.slice(offset, offset + 8).map(async (id) => [id, await fetchManagerLoginId(entityId, id, token)] as const));
        for (const [id, loginId] of results) if (loginId !== null) { logins.set(id.toLocaleLowerCase(), loginId); changed = true; }
      }
    }
  }
  if (changed) saveManagerLoginIds(entityId, snapshot);
  for (const profile of profiles) {
    const id = managerId(profile);
    const values = cache.values.get(profile.id);
    if (values) values.managerLoginId = id ? logins.get(id.toLocaleLowerCase()) ?? '' : '';
  }
}
export async function queryTravelProfiles(entityId: string, rawQuery: unknown) {
  const snapshot = readTravelProfilesSnapshot(entityId); if (!snapshot) return null;
  const query = normalizeQuery(rawQuery); const matching = matchingProfiles(entityId, snapshot, query); const offset = Math.min(query.offset, matching.length);
  const selected = matching.slice(offset, offset + query.limit);
  await resolveManagerLoginIds(entityId, snapshot, selected);
  const rows = selected.map((profile) => { const values = valuesFor(entityId, profile, snapshot); return { id: profile.id, loginId: values.loginId, employeeNumber: values.employeeNumber, email: values.email, preferredName: values.preferredName, values }; });
  return { rows, total: matching.length, snapshotCount: snapshot.count, retrievedAt: snapshot.retrievedAt, offset, limit: query.limit, hasMore: offset + query.limit < matching.length, complete: true };
}
export function getTravelProfileDetail(entityId: string, userId: string) {
  const snapshot = readTravelProfilesSnapshot(entityId); const travel = snapshot?.profiles.find((profile) => profile.id === userId) ?? null; const identity = snapshot ? getActiveUserById(entityId, userId.toLocaleLowerCase(), snapshot.identityGeneration) : null; const refreshed = getRefreshedUserProfile(entityId, userId);
  if (!travel && !identity && !refreshed) return null;
  return { identity: refreshed?.identity ?? identity, spend: refreshed?.spend ?? null, travel: refreshed?.travel ?? travel };
}

async function fetchPage(entityId: string, token: string, startIndex: number): Promise<TravelProfilesPage> {
  const url = new URL(`${createEntityRegistry().require(entityId).baseUrl}/travel/v4/Users`); url.searchParams.set('startIndex', String(startIndex)); url.searchParams.set('count', String(PAGE_SIZE));
  const requestHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' }; const started = Date.now();
  let response; try { response = await upstreamFetch(url.toString(), { method: 'GET', headers: requestHeaders, signal: AbortSignal.timeout(120_000) }); }
  catch (error) { logApiCallFailure(entityId, { method: 'GET', url: url.toString(), requestHeaders, requestBody: '', error: error instanceof Error ? error.message : String(error), responseTimeMs: Date.now() - started }); throw error; }
  const text = await response.text(); logApiCall(entityId, { method: 'GET', url: url.toString(), requestHeaders, requestBody: '', response: { status: response.status, headers: headerMap(response.headers), body: text }, responseTimeMs: Date.now() - started });
  if (!response.ok) throw Object.assign(new Error(`Travel profile retrieval failed: HTTP ${response.status}${text ? ` — ${text.slice(0, 200)}` : ''}`), { status: response.status });
  return JSON.parse(text) as TravelProfilesPage;
}
async function travelPage(entityId: string, startIndex: number) { let token = await getServerAccessToken(entityId); try { return await fetchPage(entityId, token, startIndex); } catch (error) { if ((error as { status?: number }).status !== 401) throw error; token = await refreshServerAccessToken(entityId); return fetchPage(entityId, token, startIndex); } }
export function getTravelProfilesProgress(entityId: string): TravelProfilesProgress { const current = progressByEntity.get(entityId); if (current) return current; const summary = readTravelProfilesSummary(entityId); return summary ? { entityId, state: 'complete', startedAt: null, updatedAt: summary.retrievedAt, retrievedCount: summary.count, totalResults: summary.count, pageCount: summary.pageCount, startIndex: null, itemsPerPage: PAGE_SIZE, percent: 100, elapsedMs: 0, travelFields: summary.travelFields, customFields: summary.customFields } : idleProgress(entityId); }
async function retrieveTravelProfiles(entityId: string): Promise<TravelProfilesSnapshot> {
  const existing = pendingRefreshes.get(entityId); if (existing) return existing;
  const identity = readActiveUsersSummary(entityId); if (!identity) throw new Error('Retrieve and save the complete User Profiles snapshot before retrieving Travel Profiles.');
  const startedAt = new Date().toISOString(); const progress: TravelProfilesProgress = { ...idleProgress(entityId), state: 'running', startedAt, updatedAt: startedAt }; progressByEntity.set(entityId, progress);
  const run = (async () => {
    try {
      const profiles: TravelProfileResource[] = []; const seen = new Set<string>(); let startIndex = 1; let totalResults: number | null = null;
      for (;;) {
        const page = await travelPage(entityId, startIndex); const resources = page.Resources ?? [];
        if (totalResults !== null && page.totalResults !== undefined && page.totalResults !== totalResults) throw new Error('Travel Profiles changed during retrieval. Retrieve again to create a stable snapshot.');
        totalResults = page.totalResults ?? totalResults;
        for (const profile of resources) { if (!profile.id || seen.has(profile.id)) throw new Error('Travel Profiles retrieval returned a missing or repeated profile ID. Retrieve again to create a stable snapshot.'); seen.add(profile.id); profiles.push(profile); }
        progress.retrievedCount = profiles.length; progress.totalResults = totalResults; progress.pageCount += 1; progress.startIndex = page.startIndex ?? startIndex; progress.itemsPerPage = page.itemsPerPage ?? PAGE_SIZE; progress.percent = totalResults ? Math.min(99, Math.floor((profiles.length / totalResults) * 100)) : 0; progress.updatedAt = new Date().toISOString(); const fields = fieldsFrom(profiles); progress.travelFields = fields.travelFields; progress.customFields = fields.customFields;
        if (!resources.length || (totalResults !== null && profiles.length >= totalResults)) break;
        const next = (page.startIndex ?? startIndex) + (page.itemsPerPage ?? PAGE_SIZE); if (next <= startIndex) throw new Error('Travel Profiles pagination did not advance.'); startIndex = next;
      }
      if (totalResults !== null && profiles.length !== totalResults) throw new Error('Travel Profiles record count did not match the reported total.');
      const retrievedAt = new Date().toISOString(); const snapshot = { entityId, retrievedAt, count: profiles.length, pageCount: progress.pageCount, profiles, identityGeneration: identity.generation }; const fields = fieldsFrom(profiles); writeJsonSnapshot(snapshotPath(entityId), snapshot); writeJsonSnapshot(summaryPath(entityId), { entityId, retrievedAt, count: snapshot.count, pageCount: snapshot.pageCount, identityCount: identity.count, identityGeneration: identity.generation, identityStale: false, ...fields }); snapshotCache.delete(entityId);
      progressByEntity.set(entityId, { ...progress, state: 'complete', updatedAt: retrievedAt, retrievedCount: snapshot.count, totalResults: snapshot.count, percent: 100, travelFields: fields.travelFields, customFields: fields.customFields }); return snapshot;
    } catch (error) { const message = error instanceof Error ? error.message : String(error); progressByEntity.set(entityId, { ...progress, state: 'paused', updatedAt: new Date().toISOString(), error: message }); throw error; }
  })().finally(() => pendingRefreshes.delete(entityId)); pendingRefreshes.set(entityId, run); return run;
}

interface ServerResponse { writeHead: (status: number, headers: Record<string, string>) => void; end: (body?: string) => void }
function sendJson(response: ServerResponse, status: number, body: unknown) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); }
export function handleGetTravelProfilesSummary(response: ServerResponse, entityId: string) { try { sendJson(response, 200, { summary: readTravelProfilesSummary(entityId), identitySummary: readActiveUsersSummary(entityId) }); } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); } }
export function handleGetTravelProfilesProgress(response: ServerResponse, entityId: string) { try { sendJson(response, 200, { progress: getTravelProfilesProgress(entityId) }); } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); } }
export function handleRefreshTravelProfiles(response: ServerResponse, entityId: string) { try { const before = getTravelProfilesProgress(entityId); if (before.state === 'running') return sendJson(response, 202, { progress: before }); void retrieveTravelProfiles(entityId).catch(() => undefined); sendJson(response, 202, { progress: getTravelProfilesProgress(entityId) }); } catch (error) { const message = error instanceof Error ? error.message : String(error); sendJson(response, /User Profiles/.test(message) ? 409 : 500, { error: message }); } }
export async function handleQueryTravelProfiles(response: ServerResponse, entityId: string, body: unknown) { try { sendJson(response, 200, { result: await queryTravelProfiles(entityId, body) }); } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); } }
export function handleGetTravelProfileDetail(response: ServerResponse, entityId: string, userId: string) { try { const detail = getTravelProfileDetail(entityId, userId); if (!detail) return sendJson(response, 404, { error: 'The Travel Profile was not found in the local snapshot.' }); sendJson(response, 200, { detail }); } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); } }
export function handleExportTravelProfiles(response: ServerResponse, entityId: string, body: unknown) {
  try {
    const snapshot = readTravelProfilesSnapshot(entityId); const summary = readTravelProfilesSummary(entityId); if (!snapshot || !summary) return sendJson(response, 404, { error: 'No Travel Profile snapshot is available.' }); const query = normalizeQuery(body); const requested = body && typeof body === 'object' && Array.isArray((body as { columns?: unknown }).columns) ? (body as { columns: unknown[] }).columns.filter((field): field is string => typeof field === 'string') : []; const available = new Set(['id', 'loginId', 'employeeNumber', 'email', 'preferredName', ...summary.travelFields, ...summary.customFields]); const columns = [...new Set(['id', 'loginId', 'employeeNumber', ...requested.filter((field) => available.has(field))])]; const rows = matchingProfiles(entityId, snapshot, query).map((profile) => columns.map((column) => `"${(valuesFor(entityId, profile, snapshot)[column] ?? '').replace(/"/g, '""')}"`).join(','));
    response.writeHead(200, { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': `attachment; filename="concur-travel-profiles-${entityId}.csv"`, 'Cache-Control': 'no-store' }); response.end(`\uFEFF${[columns.map((column) => `"${column}"`).join(','), ...rows].join('\r\n')}`);
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
