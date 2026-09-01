import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getServerAccessToken } from './concurAuth';
import { createEntityRegistry } from './entities';
import { logApiCall, logApiCallFailure } from './logger';
import { getActiveUserById, readActiveUsersSummary, type ActiveUserProfile } from './concurUsers';
import { upstreamFetch } from './upstreamFetch';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';

const SPEND_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const PAGE_SIZE = 100;
const MAX_PAGES = 10_000;
const STANDARD_FIELDS = ['reimbursementCurrency', 'reimbursementType', 'ledgerCode', 'country', 'budgetCountryCode', 'stateProvince', 'locale', 'cashAdvanceAccountCode', 'testEmployee', 'nonEmployee', 'officeLocationCountry', 'officeLocationStateProvince', 'officeLocationCity'];

export interface SpendCustomDataValue { id?: string; value?: string | null; syncGuid?: string | null; href?: string | null }
export interface SpendProfileResource {
  id: string;
  schemas?: string[];
  meta?: Record<string, unknown>;
  [SPEND_USER_SCHEMA]?: Record<string, unknown> & { customData?: SpendCustomDataValue[] };
  [key: string]: unknown;
}
interface SpendProfilesPage { Resources?: SpendProfileResource[]; totalResults?: number; startIndex?: number; itemsPerPage?: number }
export interface SpendProfilesSnapshot { entityId: string; retrievedAt: string; count: number; pageCount: number; profiles: SpendProfileResource[]; identityGeneration?: string }
export interface SpendProfilesSummary { entityId: string; retrievedAt: string; count: number; pageCount: number; identityCount: number; identityGeneration?: string; identityStale?: boolean; spendFields: string[]; customFields: string[] }
export type SpendProfilesProgressState = 'idle' | 'running' | 'complete' | 'error';
export interface SpendProfilesProgress {
  entityId: string; state: SpendProfilesProgressState; startedAt: string | null; updatedAt: string | null;
  retrievedCount: number; totalResults: number | null; pageCount: number; startIndex: number | null;
  itemsPerPage: number; percent: number; elapsedMs: number; error?: string;
}
export type SpendFilterOperator = 'eq' | 'ne' | 'contains' | 'startsWith' | 'endsWith' | 'empty' | 'notEmpty';
export interface SpendFilterCondition { id: string; kind: 'condition'; field: string; operator: SpendFilterOperator; value: string }
export interface SpendFilterGroup { id: string; kind: 'group'; logic: 'and' | 'or'; items: Array<SpendFilterCondition | SpendFilterGroup> }
export interface SpendProfileRow { id: string; loginId: string; employeeNumber: string; email: string; preferredName: string; values: Record<string, string> }
export interface SpendProfilesQuery { offset: number; limit: number; filters: SpendFilterGroup; sortBy: string; sortDir: 'asc' | 'desc'; includeOrphans: boolean }
export interface SpendProfilesQueryResult { rows: SpendProfileRow[]; total: number; snapshotCount: number; retrievedAt: string; offset: number; limit: number; hasMore: boolean }

const pendingRefreshes = new Map<string, Promise<SpendProfilesSnapshot>>();
const progressByEntity = new Map<string, SpendProfilesProgress>();
const snapshotCache = new Map<string, { mtimeMs: number; snapshot: SpendProfilesSnapshot; identityById: Map<string, ActiveUserProfile>; flatValues: Map<string, Record<string, string>>; queryResults: Map<string, SpendProfileResource[]> }>();

function snapshotPath(entityId: string) { return join(entityDataDirectory(entityId), 'identity', 'spend-profiles.json'); }
function summaryPath(entityId: string) { return join(entityDataDirectory(entityId), 'identity', 'spend-profiles-summary.json'); }
function idleProgress(entityId: string): SpendProfilesProgress {
  return { entityId, state: 'idle', startedAt: null, updatedAt: null, retrievedCount: 0, totalResults: null, pageCount: 0, startIndex: null, itemsPerPage: PAGE_SIZE, percent: 0, elapsedMs: 0 };
}
function elapsedSince(startedAt: string | null, updatedAt?: string | null) {
  if (!startedAt) return 0;
  return Math.max(0, new Date(updatedAt ?? Date.now()).getTime() - new Date(startedAt).getTime());
}
function headerMap(headers: { forEach: (callback: (value: string, key: string) => void) => void }) {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key.toLowerCase()] = value; });
  return result;
}

export function getSpendProfilesProgress(entityId: string): SpendProfilesProgress {
  const current = progressByEntity.get(entityId);
  if (current) return { ...current, elapsedMs: current.state === 'running' ? elapsedSince(current.startedAt) : current.elapsedMs };
  const summary = readSpendProfilesSummary(entityId);
  if (!summary) return idleProgress(entityId);
  return { entityId, state: 'complete', startedAt: null, updatedAt: summary.retrievedAt, retrievedCount: summary.count, totalResults: summary.count, pageCount: summary.pageCount, startIndex: null, itemsPerPage: PAGE_SIZE, percent: 100, elapsedMs: 0 };
}

export function readSpendProfilesSnapshot(entityId: string): SpendProfilesSnapshot | null {
  const file = snapshotPath(entityId);
  if (!existsSync(file)) return null;
  const mtimeMs = statSync(file).mtimeMs;
  const cached = snapshotCache.get(entityId);
  if (cached?.mtimeMs === mtimeMs) return cached.snapshot;
  const snapshot = readJsonSnapshot<SpendProfilesSnapshot>(file)!;
  if (snapshot.entityId !== entityId || !Array.isArray(snapshot.profiles)) {
    throw new CorruptSnapshotError(file, new Error('Snapshot metadata or profiles collection is invalid'));
  }
  snapshotCache.set(entityId, { mtimeMs, snapshot, identityById: new Map(), flatValues: new Map(), queryResults: new Map() });
  return snapshot;
}

function naturalCompare(a: string, b: string) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }
function collectFields(profiles: SpendProfileResource[]) {
  const spend = new Set<string>();
  const custom = new Set<string>();
  for (const profile of profiles) {
    const data = profile[SPEND_USER_SCHEMA];
    if (!data) continue;
    for (const key of Object.keys(data)) if (key !== 'customData') spend.add(key);
    for (const item of data.customData ?? []) if (item.id) custom.add(item.id);
  }
  return {
    spendFields: [...STANDARD_FIELDS.filter((field) => spend.has(field)), ...[...spend].filter((field) => !STANDARD_FIELDS.includes(field)).sort(naturalCompare)],
    customFields: [...custom].sort(naturalCompare),
  };
}

export function readSpendProfilesSummary(entityId: string): SpendProfilesSummary | null {
  const file = summaryPath(entityId);
  if (existsSync(file)) {
    try {
      const summary = readJsonSnapshot<SpendProfilesSummary>(file)!;
      if (summary.entityId === entityId && Number.isFinite(summary.count)) {
        const latestIdentity = readActiveUsersSummary(entityId);
        return { ...summary, identityStale: Boolean(summary.identityGeneration && latestIdentity?.generation && summary.identityGeneration !== latestIdentity.generation) };
      }
    } catch { /* repair from canonical snapshot */ }
  }
  const snapshot = readSpendProfilesSnapshot(entityId);
  if (!snapshot) return null;
  const identitySummary = readActiveUsersSummary(entityId);
  const summary = { entityId, retrievedAt: snapshot.retrievedAt, count: snapshot.count, pageCount: snapshot.pageCount, identityCount: identitySummary?.count ?? 0, identityGeneration: snapshot.identityGeneration, identityStale: Boolean(snapshot.identityGeneration && identitySummary?.generation && snapshot.identityGeneration !== identitySummary.generation), ...collectFields(snapshot.profiles) };
  try { writeJsonSnapshot(file, summary); } catch { /* optional sidecar */ }
  return summary;
}

function writeSnapshot(snapshot: SpendProfilesSnapshot) {
  const file = snapshotPath(snapshot.entityId);
  const identitySummary = readActiveUsersSummary(snapshot.entityId);
  const summary: SpendProfilesSummary = { entityId: snapshot.entityId, retrievedAt: snapshot.retrievedAt, count: snapshot.count, pageCount: snapshot.pageCount, identityCount: identitySummary?.count ?? 0, identityGeneration: snapshot.identityGeneration, identityStale: Boolean(snapshot.identityGeneration && identitySummary?.generation && snapshot.identityGeneration !== identitySummary.generation), ...collectFields(snapshot.profiles) };
  writeJsonSnapshot(file, snapshot);
  writeJsonSnapshot(summaryPath(snapshot.entityId), summary);
  snapshotCache.delete(snapshot.entityId);
}

function primaryEmail(user?: ActiveUserProfile) { return user?.emails?.find((email) => email.type === 'work')?.value ?? user?.emails?.[0]?.value ?? ''; }
function preferredName(user?: ActiveUserProfile) { return user?.preferredName ?? user?.displayName ?? user?.name?.formatted ?? [user?.name?.givenName, user?.name?.familyName].filter(Boolean).join(' '); }
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && 'value' in (value as Record<string, unknown>)) return stringifyValue((value as Record<string, unknown>).value);
  return JSON.stringify(value);
}
function cachedData(entityId: string, snapshot: SpendProfilesSnapshot) {
  const mtimeMs = statSync(snapshotPath(entityId)).mtimeMs;
  let cached = snapshotCache.get(entityId);
  if (!cached || cached.mtimeMs !== mtimeMs || cached.snapshot !== snapshot) {
    cached = { mtimeMs, snapshot, identityById: new Map(), flatValues: new Map(), queryResults: new Map() };
    snapshotCache.set(entityId, cached);
  }
  return cached;
}
function identityFor(entityId: string, profileId: string, snapshot: SpendProfilesSnapshot): ActiveUserProfile | null {
  const cache = cachedData(entityId, snapshot);
  const cached = cache.identityById.get(profileId);
  if (cached) return cached;
  const identity = getActiveUserById(entityId, profileId, snapshot.identityGeneration);
  if (identity) cache.identityById.set(profileId, identity);
  return identity;
}
function valuesFor(entityId: string, profile: SpendProfileResource, snapshot: SpendProfilesSnapshot) {
  const cache = cachedData(entityId, snapshot);
  let values = cache.flatValues.get(profile.id);
  if (values) return values;
  const identity = identityFor(entityId, profile.id, snapshot);
  const enterprise = identity?.[ENTERPRISE_USER_SCHEMA];
  values = { id: profile.id, loginId: identity?.userName ?? '', employeeNumber: enterprise?.employeeNumber ?? '', email: primaryEmail(identity), preferredName: preferredName(identity) };
  const spend = profile[SPEND_USER_SCHEMA] ?? {};
  for (const [key, value] of Object.entries(spend)) if (key !== 'customData') values[key] = stringifyValue(value);
  for (const item of spend.customData ?? []) if (item.id) values[item.id] = stringifyValue(item.value);
  cache.flatValues.set(profile.id, values);
  return values;
}

function matchesCondition(values: Record<string, string>, condition: SpendFilterCondition) {
  const actual = (values[condition.field] ?? '').toLocaleLowerCase();
  const expected = condition.value.toLocaleLowerCase();
  switch (condition.operator) {
    case 'eq': return actual === expected;
    case 'ne': return actual !== expected;
    case 'contains': return actual.includes(expected);
    case 'startsWith': return actual.startsWith(expected);
    case 'endsWith': return actual.endsWith(expected);
    case 'empty': return !actual;
    case 'notEmpty': return Boolean(actual);
  }
}
function matchesGroup(values: Record<string, string>, group: SpendFilterGroup): boolean {
  if (!group.items.length) return true;
  const results = group.items.map((item) => item.kind === 'group' ? matchesGroup(values, item) : matchesCondition(values, item));
  return group.logic === 'and' ? results.every(Boolean) : results.some(Boolean);
}
function normalizedFilters(value: unknown): SpendFilterGroup {
  const fallback: SpendFilterGroup = { id: 'root', kind: 'group', logic: 'and', items: [] };
  if (!value || typeof value !== 'object') return fallback;
  const normalize = (candidate: Record<string, unknown>, depth: number): SpendFilterGroup => ({
    id: typeof candidate.id === 'string' ? candidate.id : `group-${depth}`,
    kind: 'group',
    logic: candidate.logic === 'or' ? 'or' : 'and',
    items: depth >= 4 || !Array.isArray(candidate.items) ? [] : candidate.items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const object = item as Record<string, unknown>;
      if (object.kind === 'group') return [normalize(object, depth + 1)];
      if (object.kind !== 'condition' || typeof object.field !== 'string') return [];
      const allowed: SpendFilterOperator[] = ['eq', 'ne', 'contains', 'startsWith', 'endsWith', 'empty', 'notEmpty'];
      return [{ id: typeof object.id === 'string' ? object.id : `condition-${depth}`, kind: 'condition' as const, field: object.field, operator: allowed.includes(object.operator as SpendFilterOperator) ? object.operator as SpendFilterOperator : 'eq', value: typeof object.value === 'string' ? object.value : '' }];
    }),
  });
  return normalize(value as Record<string, unknown>, 0);
}
function normalizedQuery(value: unknown): SpendProfilesQuery {
  const body = value && typeof value === 'object' ? value as Partial<SpendProfilesQuery> : {};
  return { offset: Math.max(0, Number(body.offset) || 0), limit: Math.max(1, Math.min(Number(body.limit) || 200, 500)), filters: normalizedFilters(body.filters), sortBy: typeof body.sortBy === 'string' && body.sortBy ? body.sortBy : 'loginId', sortDir: body.sortDir === 'desc' ? 'desc' : 'asc', includeOrphans: body.includeOrphans === true };
}
function filteredProfiles(entityId: string, snapshot: SpendProfilesSnapshot, query: SpendProfilesQuery) {
  const cache = cachedData(entityId, snapshot);
  const queryKey = JSON.stringify({ filters: query.filters, sortBy: query.sortBy, sortDir: query.sortDir, includeOrphans: query.includeOrphans });
  const cached = cache.queryResults.get(queryKey);
  if (cached) return cached;
  const candidates = query.includeOrphans ? snapshot.profiles : snapshot.profiles.filter((profile) => identityFor(entityId, profile.id, snapshot));
  const matching = query.filters.items.length ? candidates.filter((profile) => matchesGroup(valuesFor(entityId, profile, snapshot), query.filters)) : [...candidates];
  const direction = query.sortDir === 'asc' ? 1 : -1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  matching.sort((a, b) => collator.compare(valuesFor(entityId, a, snapshot)[query.sortBy] ?? '', valuesFor(entityId, b, snapshot)[query.sortBy] ?? '') * direction);
  cache.queryResults.set(queryKey, matching);
  if (cache.queryResults.size > 4) cache.queryResults.delete(cache.queryResults.keys().next().value!);
  return matching;
}

export function querySpendProfiles(entityId: string, rawQuery: unknown): SpendProfilesQueryResult | null {
  const snapshot = readSpendProfilesSnapshot(entityId);
  if (!snapshot) return null;
  const query = normalizedQuery(rawQuery);
  const matching = filteredProfiles(entityId, snapshot, query);
  const offset = Math.min(query.offset, matching.length);
  const rows = matching.slice(offset, offset + query.limit).map((profile) => {
    const values = valuesFor(entityId, profile, snapshot);
    return { id: profile.id, loginId: values.loginId, employeeNumber: values.employeeNumber, email: values.email, preferredName: values.preferredName, values };
  });
  return { rows, total: matching.length, snapshotCount: snapshot.count, retrievedAt: snapshot.retrievedAt, offset, limit: query.limit, hasMore: offset + query.limit < matching.length };
}

export function getSpendProfileDetail(entityId: string, userId: string) {
  const snapshot = readSpendProfilesSnapshot(entityId);
  const identity = snapshot ? getActiveUserById(entityId, userId, snapshot.identityGeneration) : null;
  const spend = snapshot?.profiles.find((profile) => profile.id === userId) ?? null;
  if (!identity && !spend) return null;
  return { identity, spend };
}

function csvCell(value: unknown) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function exportColumns(summary: SpendProfilesSummary, requested: unknown) {
  const required = ['id', 'loginId', 'employeeNumber'];
  const available = new Set([...required, 'email', 'preferredName', ...summary.spendFields, ...summary.customFields]);
  const selected = Array.isArray(requested) ? requested.filter((field): field is string => typeof field === 'string' && available.has(field)) : [];
  return [...required, ...selected.filter((field) => !required.includes(field))];
}

async function fetchPage(entityId: string, token: string, startIndex: number): Promise<SpendProfilesPage> {
  const url = new URL(`${createEntityRegistry().require(entityId).baseUrl}/profile/spend/v4.1/Users`);
  url.searchParams.set('startIndex', String(startIndex));
  url.searchParams.set('count', String(PAGE_SIZE));
  const requestHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const started = Date.now();
  let response;
  try { response = await upstreamFetch(url.toString(), { method: 'GET', headers: requestHeaders }); }
  catch (error) {
    logApiCallFailure(entityId, { method: 'GET', url: url.toString(), requestHeaders, requestBody: '', error: error instanceof Error ? error.message : String(error), responseTimeMs: Date.now() - started });
    throw error;
  }
  const text = await response.text();
  logApiCall(entityId, { method: 'GET', url: url.toString(), requestHeaders, requestBody: '', response: { status: response.status, headers: headerMap(response.headers), body: text }, responseTimeMs: Date.now() - started });
  if (!response.ok) throw new Error(`Spend profile retrieval failed: HTTP ${response.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  return JSON.parse(text) as SpendProfilesPage;
}

export async function fetchSpendProfilesSnapshot(entityId: string): Promise<SpendProfilesSnapshot> {
  const pending = pendingRefreshes.get(entityId);
  if (pending) return pending;
  const identity = readActiveUsersSummary(entityId);
  if (!identity) throw new Error('Retrieve and save the complete User Profiles snapshot before retrieving Spend Profiles.');
  const startedAt = new Date().toISOString();
  progressByEntity.set(entityId, { ...idleProgress(entityId), state: 'running', startedAt, updatedAt: startedAt });
  const refresh = (async () => {
    const token = await getServerAccessToken(entityId);
    const profiles: SpendProfileResource[] = [];
    let pageCount = 0;
    let startIndex = 1;
    let totalResults: number | null = null;
    while (pageCount < MAX_PAGES) {
      const page = await fetchPage(entityId, token, startIndex);
      const resources = page.Resources ?? [];
      profiles.push(...resources);
      pageCount += 1;
      totalResults = page.totalResults ?? totalResults;
      const itemsPerPage = page.itemsPerPage ?? PAGE_SIZE;
      progressByEntity.set(entityId, { entityId, state: 'running', startedAt, updatedAt: new Date().toISOString(), retrievedCount: profiles.length, totalResults, pageCount, startIndex: page.startIndex ?? startIndex, itemsPerPage, percent: totalResults && totalResults > 0 ? Math.min(99, Math.floor((profiles.length / totalResults) * 100)) : 0, elapsedMs: elapsedSince(startedAt) });
      if (!resources.length || (totalResults !== null && profiles.length >= totalResults)) break;
      const next = (page.startIndex ?? startIndex) + itemsPerPage;
      if (next <= startIndex) throw new Error('Spend profile retrieval stopped because pagination did not advance.');
      startIndex = next;
    }
    if (pageCount >= MAX_PAGES && (totalResults === null || profiles.length < totalResults)) throw new Error(`Spend profile retrieval exceeded the ${MAX_PAGES}-page safety limit.`);
    const snapshot = { entityId, retrievedAt: new Date().toISOString(), count: profiles.length, pageCount, profiles, identityGeneration: identity.generation };
    writeSnapshot(snapshot);
    progressByEntity.set(entityId, { entityId, state: 'complete', startedAt, updatedAt: snapshot.retrievedAt, retrievedCount: profiles.length, totalResults: profiles.length, pageCount, startIndex, itemsPerPage: PAGE_SIZE, percent: 100, elapsedMs: elapsedSince(startedAt, snapshot.retrievedAt) });
    return snapshot;
  })().catch((error: unknown) => {
    const current = getSpendProfilesProgress(entityId);
    progressByEntity.set(entityId, { ...current, state: 'error', updatedAt: new Date().toISOString(), elapsedMs: elapsedSince(current.startedAt), error: error instanceof Error ? error.message : String(error) });
    throw error;
  }).finally(() => pendingRefreshes.delete(entityId));
  pendingRefreshes.set(entityId, refresh);
  return refresh;
}

interface ServerResponse { writeHead: (status: number, headers: Record<string, string>) => void; write?: (chunk: string) => boolean; once?: (event: 'drain', listener: () => void) => void; end: (body?: string) => void }
function sendJson(response: ServerResponse, status: number, body: unknown) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); }
export function handleGetSpendProfilesSummary(response: ServerResponse, entityId: string) {
  try { sendJson(response, 200, { summary: readSpendProfilesSummary(entityId), identitySummary: readActiveUsersSummary(entityId) }); }
  catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
export function handleGetSpendProfilesProgress(response: ServerResponse, entityId: string) {
  try { sendJson(response, 200, { progress: getSpendProfilesProgress(entityId) }); }
  catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
export async function handleRefreshSpendProfiles(response: ServerResponse, entityId: string) {
  try { await fetchSpendProfilesSnapshot(entityId); sendJson(response, 200, { summary: readSpendProfilesSummary(entityId) }); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); sendJson(response, /User Profiles/.test(message) ? 409 : 500, { error: message }); }
}
export function handleQuerySpendProfiles(response: ServerResponse, entityId: string, body: unknown) {
  try { sendJson(response, 200, { result: querySpendProfiles(entityId, body) }); }
  catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
export function handleGetSpendProfileDetail(response: ServerResponse, entityId: string, userId: string) {
  try {
    const detail = getSpendProfileDetail(entityId, userId);
    if (!detail) return sendJson(response, 404, { error: 'The Spend Profile was not found in the local snapshot.' });
    sendJson(response, 200, { detail });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
export async function handleExportSpendProfiles(response: ServerResponse, entityId: string, body: unknown) {
  try {
    const snapshot = readSpendProfilesSnapshot(entityId);
    const summary = readSpendProfilesSummary(entityId);
    if (!snapshot || !summary) return sendJson(response, 404, { error: 'No Spend Profile snapshot is available.' });
    const query = normalizedQuery(body);
    const profiles = filteredProfiles(entityId, snapshot, query);
    const columns = exportColumns(summary, body && typeof body === 'object' ? (body as { columns?: unknown }).columns : undefined);
    response.writeHead(200, { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': `attachment; filename="concur-spend-profiles-${entityId}.csv"`, 'Cache-Control': 'no-store' });
    const rows = profiles.map((profile) => { const values = valuesFor(entityId, profile, snapshot); return columns.map((column) => csvCell(values[column])).join(','); });
    const header = columns.map(csvCell).join(',');
    if (response.write && response.once) {
      const write = async (chunk: string) => { if (!response.write!(chunk)) await new Promise<void>((resolve) => response.once!('drain', resolve)); };
      await write(`\uFEFF${header}\r\n`);
      for (let index = 0; index < rows.length; index += 1) await write(`${rows[index]}${index === rows.length - 1 ? '' : '\r\n'}`);
      response.end();
    } else response.end(`\uFEFF${[header, ...rows].join('\r\n')}`);
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
