import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getServerAccessToken, refreshServerAccessToken } from './concurAuth';
import { createEntityRegistry } from './entities';
import { logApiCall, logApiCallFailure } from './logger';
import { getActiveUserById, readActiveUsersSummary, type ActiveUserProfile } from './concurUsers';
import { upstreamFetch } from './upstreamFetch';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';
import { createRetrievalJob, deleteRetrievalPages, discardRetrievalJob, readRetrievalJob, readRetrievalPages, retrievalPageHash, retryAfterMilliseconds, retryPage, saveRetrievalPage, UpstreamPageError, writeRetrievalJob, type RetrievalJob, type RetrievalJobState } from './retrievalJobs';

const SPEND_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const PAGE_SIZE = 100;
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
export type SpendProfilesProgressState = 'idle' | RetrievalJobState;
export interface SpendProfilesProgress {
  entityId: string; state: SpendProfilesProgressState; startedAt: string | null; updatedAt: string | null;
  retrievedCount: number; totalResults: number | null; pageCount: number; startIndex: number | null;
  itemsPerPage: number; percent: number; elapsedMs: number; error?: string;
  jobId?: string; phase?: string; restartRequired?: boolean; retryAttempt?: number;
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
function progressFromJob(job: RetrievalJob): SpendProfilesProgress {
  return {
    entityId: job.entityId, state: job.state, startedAt: job.startedAt, updatedAt: job.updatedAt,
    retrievedCount: job.retrievedCount, totalResults: job.totalResults, pageCount: job.pageCount, startIndex: job.startIndex, itemsPerPage: job.itemsPerPage,
    percent: job.totalResults && job.totalResults > 0 ? Math.min(99, Math.floor((job.retrievedCount / job.totalResults) * 100)) : job.state === 'complete' ? 100 : 0,
    elapsedMs: elapsedSince(job.startedAt), jobId: job.id, phase: job.state === 'finalizing' ? 'Saving local snapshot' : 'Retrieving from Concur', restartRequired: job.state === 'restart-required', retryAttempt: job.retryAttempt, error: job.lastError,
  };
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
  const job = readRetrievalJob(entityId, 'spend-profiles');
  if (job && job.state !== 'complete') {
    // A worker is process-local. Mark a stale in-progress checkpoint as paused after
    // restart so users can explicitly choose when to resume the upstream request.
    if (job.state === 'running' || job.state === 'retrying' || job.state === 'finalizing') {
      job.state = 'paused';
      job.lastError = 'Retrieval was interrupted when the local server stopped. Resume to continue.';
      writeRetrievalJob(job);
    }
    return progressFromJob(job);
  }
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

function addProfileFields(profile: SpendProfileResource, spend: Set<string>, custom: Set<string>) {
  const data = profile[SPEND_USER_SCHEMA];
  if (!data) return;
  for (const key of Object.keys(data)) if (key !== 'customData') spend.add(key);
  for (const item of data.customData ?? []) if (item.id) custom.add(item.id);
}

function fieldsFromSets(spend: Set<string>, custom: Set<string>) {
  return {
    spendFields: [...STANDARD_FIELDS.filter((field) => spend.has(field)), ...[...spend].filter((field) => !STANDARD_FIELDS.includes(field)).sort(naturalCompare)],
    customFields: [...custom].sort(naturalCompare),
  };
}

function streamWrite(stream: ReturnType<typeof createWriteStream>, chunk: string): Promise<void> {
  if (stream.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

function closeStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', reject);
    stream.end();
  });
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
  const headers = headerMap(response.headers);
  if (!response.ok) throw new UpstreamPageError(`Spend profile retrieval failed: HTTP ${response.status}${text ? ` — ${text.slice(0, 200)}` : ''}`, response.status, retryAfterMilliseconds(headers['retry-after']));
  return JSON.parse(text) as SpendProfilesPage;
}

async function spendPage(entityId: string, startIndex: number, _retryAttempt: number): Promise<SpendProfilesPage> {
  let token = await getServerAccessToken(entityId);
  try {
    return await fetchPage(entityId, token, startIndex);
  } catch (error) {
    if (!(error instanceof UpstreamPageError) || error.status !== 401) throw error;
    token = await refreshServerAccessToken(entityId);
    return fetchPage(entityId, token, startIndex);
  }
}

async function spendSnapshotFromJob(job: RetrievalJob): Promise<SpendProfilesSnapshot> {
  const retrievedAt = new Date().toISOString();
  const file = snapshotPath(job.entityId);
  mkdirSync(dirname(file), { recursive: true });
  const temporaryFile = `${file}.tmp-${process.pid}-${Date.now()}`;
  const spendFields = new Set<string>();
  const customFields = new Set<string>();
  const stream = createWriteStream(temporaryFile, { encoding: 'utf8' });
  let count = 0;
  let first = true;
  try {
    await streamWrite(stream, `{"entityId":${JSON.stringify(job.entityId)},"retrievedAt":${JSON.stringify(retrievedAt)},"count":${job.retrievedCount},"pageCount":${job.pageCount},"profiles":[`);
    for (const page of readRetrievalPages<SpendProfileResource>(job)) {
      for (const profile of page.resources) {
        await streamWrite(stream, `${first ? '' : ','}${JSON.stringify(profile)}`);
        first = false;
        count += 1;
        addProfileFields(profile, spendFields, customFields);
      }
    }
    await streamWrite(stream, `]${job.identityGeneration ? `,"identityGeneration":${JSON.stringify(job.identityGeneration)}` : ''}}`);
    await closeStream(stream);
    // The completed temporary document becomes visible in one rename; an interrupted
    // materialization therefore leaves the previous complete Spend snapshot intact.
    renameSync(temporaryFile, file);
  } catch (error) {
    stream.destroy();
    try { unlinkSync(temporaryFile); } catch { /* The temporary file may not exist yet. */ }
    throw error;
  }
  const identitySummary = readActiveUsersSummary(job.entityId);
  const summary: SpendProfilesSummary = {
    entityId: job.entityId, retrievedAt, count, pageCount: job.pageCount,
    identityCount: identitySummary?.count ?? 0, identityGeneration: job.identityGeneration,
    identityStale: Boolean(job.identityGeneration && identitySummary?.generation && job.identityGeneration !== identitySummary.generation),
    ...fieldsFromSets(spendFields, customFields),
  };
  writeJsonSnapshot(summaryPath(job.entityId), summary);
  snapshotCache.delete(job.entityId);
  return { entityId: job.entityId, retrievedAt, count, pageCount: job.pageCount, profiles: [], identityGeneration: job.identityGeneration };
}

async function runSpendProfilesJob(job: RetrievalJob): Promise<SpendProfilesSnapshot> {
  const pending = pendingRefreshes.get(job.entityId);
  if (pending) return pending;
  const run = (async () => {
    try {
      const savedPages = readRetrievalPages<SpendProfileResource>(job);
      const seenIds = new Set(savedPages.flatMap((page) => page.resources.map((resource) => resource.id)));
      if (savedPages.length && job.nextOffset !== null) {
        const last = savedPages.at(-1)!;
        const verification = await retryPage(job, (attempt) => spendPage(job.entityId, last.startIndex ?? 1, attempt));
        const verificationMatches = retrievalPageHash(verification.Resources ?? []) === last.hash
          && (last.totalResults === null || verification.totalResults === undefined || verification.totalResults === last.totalResults)
          && (verification.startIndex === undefined || verification.startIndex === last.startIndex)
          && (verification.itemsPerPage === undefined || verification.itemsPerPage === last.itemsPerPage);
        if (!verificationMatches) throw new Error('Spend Profiles changed at the saved pagination boundary. Restart retrieval to keep a stable snapshot.');
      }
      if (job.nextOffset === null && job.pageCount > 0) {
        job.state = 'finalizing'; writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
        const snapshot = await spendSnapshotFromJob(job);
        job.state = 'complete'; job.retrievedCount = snapshot.count; job.totalResults = snapshot.count; job.lastError = undefined; writeRetrievalJob(job); deleteRetrievalPages(job);
        progressByEntity.set(job.entityId, { ...progressFromJob(job), state: 'complete', percent: 100, updatedAt: snapshot.retrievedAt });
        return snapshot;
      }
      job.state = 'running'; job.lastError = undefined; writeRetrievalJob(job);
      for (;;) {
        const startIndex = job.nextOffset ?? 1;
        const page = await retryPage(job, (attempt) => spendPage(job.entityId, startIndex, attempt));
        const resources = page.Resources ?? [];
        const totalResults = page.totalResults ?? job.totalResults;
        if (job.totalResults !== null && page.totalResults !== undefined && page.totalResults !== job.totalResults) throw new Error('Spend Profiles total changed during retrieval. Restart retrieval to keep a stable snapshot.');
        if (page.startIndex !== undefined && page.startIndex !== startIndex) throw new Error('Spend Profiles pagination boundary changed during retrieval. Restart retrieval to keep a stable snapshot.');
        if (resources.some((resource) => seenIds.has(resource.id))) throw new Error('Spend Profiles pagination repeated an already saved profile. Restart retrieval to keep a stable snapshot.');
        const itemsPerPage = page.itemsPerPage ?? PAGE_SIZE;
        const nextOffset = !resources.length || (totalResults !== null && job.retrievedCount + resources.length >= totalResults) ? null : (page.startIndex ?? startIndex) + itemsPerPage;
        if (nextOffset !== null && nextOffset <= startIndex) throw new Error('Spend Profiles pagination did not advance. Restart retrieval to keep a stable snapshot.');
        const saved = saveRetrievalPage(job, { request: { startIndex }, resources, totalResults, startIndex: page.startIndex ?? startIndex, itemsPerPage, nextCursor: null });
        for (const resource of resources) seenIds.add(resource.id);
        job.pageCount = saved.sequence; job.retrievedCount += resources.length; job.totalResults = totalResults; job.startIndex = saved.startIndex; job.itemsPerPage = itemsPerPage; job.nextOffset = nextOffset; job.lastPageHash = saved.hash; job.state = 'running';
        writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
        if (nextOffset === null) break;
      }
      if (job.totalResults !== null && job.retrievedCount !== job.totalResults) throw new Error('Spend Profiles record count did not match the saved total. Restart retrieval to keep a stable snapshot.');
      job.state = 'finalizing'; writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
      const snapshot = await spendSnapshotFromJob(job);
      job.state = 'complete'; job.retrievedCount = snapshot.count; job.totalResults = snapshot.count; job.lastError = undefined; writeRetrievalJob(job); deleteRetrievalPages(job);
      progressByEntity.set(job.entityId, { ...progressFromJob(job), state: 'complete', percent: 100, updatedAt: snapshot.retrievedAt });
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.state = /changed|pagination|repeated/i.test(message) ? 'restart-required' : 'paused'; job.lastError = message;
      writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
      throw error;
    }
  })().finally(() => pendingRefreshes.delete(job.entityId));
  pendingRefreshes.set(job.entityId, run);
  return run;
}

export function startSpendProfilesRetrieval(entityId: string): RetrievalJob {
  const identity = readActiveUsersSummary(entityId);
  if (!identity) throw new Error('Retrieve and save the complete User Profiles snapshot before retrieving Spend Profiles.');
  const existing = readRetrievalJob(entityId, 'spend-profiles');
  if (existing && existing.state !== 'complete') return existing;
  const job = createRetrievalJob(entityId, 'spend-profiles', { identityGeneration: identity.generation });
  progressByEntity.set(entityId, progressFromJob(job)); void runSpendProfilesJob(job).catch(() => undefined);
  return job;
}

export function resumeSpendProfilesRetrieval(entityId: string): RetrievalJob {
  const job = readRetrievalJob(entityId, 'spend-profiles');
  if (!job) throw new Error('No interrupted Spend Profiles retrieval is available.');
  if (job.state === 'restart-required') throw new Error('The saved Spend Profiles boundary changed. Restart retrieval instead.');
  if (job.state !== 'complete') {
    job.state = 'running';
    job.lastError = undefined;
    writeRetrievalJob(job);
    progressByEntity.set(entityId, progressFromJob(job));
    void runSpendProfilesJob(job).catch(() => undefined);
  }
  return job;
}

export function restartSpendProfilesRetrieval(entityId: string): RetrievalJob { discardRetrievalJob(entityId, 'spend-profiles'); return startSpendProfilesRetrieval(entityId); }

export async function fetchSpendProfilesSnapshot(entityId: string): Promise<SpendProfilesSnapshot> {
  const existing = readRetrievalJob(entityId, 'spend-profiles');
  if (existing && existing.state === 'restart-required') throw new Error('The saved Spend Profiles boundary changed. Restart retrieval instead.');
  if (existing && existing.state !== 'complete') return runSpendProfilesJob(existing);
  discardRetrievalJob(entityId, 'spend-profiles');
  const identity = readActiveUsersSummary(entityId);
  if (!identity) throw new Error('Retrieve and save the complete User Profiles snapshot before retrieving Spend Profiles.');
  const job = createRetrievalJob(entityId, 'spend-profiles', { identityGeneration: identity.generation });
  progressByEntity.set(entityId, progressFromJob(job));
  return runSpendProfilesJob(job);
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
export function handleRefreshSpendProfiles(response: ServerResponse, entityId: string) {
  try { const job = startSpendProfilesRetrieval(entityId); sendJson(response, 202, { job, progress: progressFromJob(job) }); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); sendJson(response, /User Profiles/.test(message) ? 409 : 500, { error: message }); }
}
export function handleResumeSpendProfiles(response: ServerResponse, entityId: string) {
  try { const job = resumeSpendProfilesRetrieval(entityId); sendJson(response, 202, { job, progress: progressFromJob(job) }); }
  catch (error) { sendJson(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
}
export function handleRestartSpendProfiles(response: ServerResponse, entityId: string) {
  try { const job = restartSpendProfilesRetrieval(entityId); sendJson(response, 202, { job, progress: progressFromJob(job) }); }
  catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
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
