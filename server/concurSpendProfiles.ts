import { existsSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getServerAccessToken, refreshServerAccessToken } from './concurAuth';
import { createEntityRegistry } from './entities';
import { logApiCall, logApiCallFailure } from './logger';
import { getActiveUserById, getActiveUsersByIds, readActiveUsersSummary, type ActiveUserProfile } from './concurUsers';
import { upstreamFetch } from './upstreamFetch';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';
import { createRetrievalJob, deleteRetrievalPages, discardRetrievalJob, iterateRetrievalPages, profilePageSignal, readRetrievalJob, readRetrievalPage, retrievalIsStalled, retrievalPageHash, retryAfterMilliseconds, retryPage, saveRetrievalPage, UpstreamPageError, writeRetrievalJob, type RetrievalJob, type RetrievalJobState } from './retrievalJobs';
import { discardShardedGeneration, pruneGenerations, readShardedIndex, readShardedManifest, readShardedRecord, readShardedRecords, ShardedSnapshotWriter, validateShardedGeneration } from './shardedIdentitySnapshot';
import { canUseProvisionalSpendProfiles, ensureSpendProfilesBrowseIndex, getSpendProfilesBrowseProgress, querySpendProfilesBrowse, readProvisionalSpendProfiles, resumeSpendProfilesBrowseIndex, stopSupersededSpendProfilesBrowseWorkers, type SpendProfilesBrowsePhase, type SpendProfilesBrowseState } from './spendProfilesBrowseIndex';

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
export interface SpendProfilesSummary { entityId: string; retrievedAt: string; count: number; pageCount: number; identityCount: number; generation?: string; identityGeneration?: string; identityStale?: boolean; spendFields: string[]; customFields: string[]; browseIndexState?: SpendProfilesBrowseState; browseIndexPercent?: number; browseGeneration?: string; browseIndexPhase?: SpendProfilesBrowsePhase; browseIndexError?: string }
export type SpendProfilesProgressState = 'idle' | RetrievalJobState;
export interface SpendProfilesProgress {
  entityId: string; state: SpendProfilesProgressState; startedAt: string | null; updatedAt: string | null;
  retrievedCount: number; totalResults: number | null; pageCount: number; startIndex: number | null;
  itemsPerPage: number; percent: number; elapsedMs: number; error?: string;
  jobId?: string; phase?: string; phasePercent?: number; downloadedCount?: number; viewableCount?: number; materializedPageCount?: number;
  lastRequestStartedAt?: string | null; lastCheckpointAt?: string | null; lastHeartbeatAt?: string | null; stalled?: boolean;
  spendFields?: string[]; customFields?: string[]; restartRequired?: boolean; retryAttempt?: number;
}
export type SpendFilterOperator = 'eq' | 'ne' | 'contains' | 'startsWith' | 'endsWith' | 'empty' | 'notEmpty' | 'before' | 'after';
export interface SpendFilterCondition { id: string; kind: 'condition'; field: string; operator: SpendFilterOperator; value: string }
export interface SpendFilterGroup { id: string; kind: 'group'; logic: 'and' | 'or'; items: Array<SpendFilterCondition | SpendFilterGroup> }
export interface SpendProfileRow { id: string; loginId: string; employeeNumber: string; email: string; preferredName: string; values: Record<string, string> }
export interface SpendProfilesQuery { offset: number; limit: number; filters: SpendFilterGroup; sortBy: string; sortDir: 'asc' | 'desc'; includeOrphans: boolean; source?: 'latest' | 'complete' }
export interface SpendProfilesQueryResult { rows: SpendProfileRow[]; total: number; snapshotCount: number; retrievedAt: string; offset: number; limit: number; hasMore: boolean; complete?: boolean; jobId?: string; sourceGeneration?: string; downloadedCount?: number; viewableCount?: number; provisional?: boolean; orderingReady?: boolean }

const pendingRefreshes = new Map<string, Promise<SpendProfilesSnapshot>>();
const progressByEntity = new Map<string, SpendProfilesProgress>();
const snapshotCache = new Map<string, { mtimeMs: number; snapshot: SpendProfilesSnapshot; identityById: Map<string, ActiveUserProfile>; flatValues: Map<string, Record<string, string>>; queryResults: Map<string, SpendProfileResource[]> }>();
const shardedSelectionCache = new Map<string, { directory: string; manifest: NonNullable<ReturnType<typeof readShardedManifest>>; ids: string[] }>();

function snapshotPath(entityId: string) { return join(entityDataDirectory(entityId), 'identity', 'spend-profiles.json'); }
function shardedDirectory(entityId: string) { return join(entityDataDirectory(entityId), 'identity', 'spend-profiles'); }
function summaryPath(entityId: string) { return join(entityDataDirectory(entityId), 'identity', 'spend-profiles-summary.json'); }
function idleProgress(entityId: string): SpendProfilesProgress {
  return { entityId, state: 'idle', startedAt: null, updatedAt: null, retrievedCount: 0, totalResults: null, pageCount: 0, startIndex: null, itemsPerPage: PAGE_SIZE, percent: 0, elapsedMs: 0 };
}
function progressFromJob(job: RetrievalJob): SpendProfilesProgress {
  const downloadPercent = job.totalResults && job.totalResults > 0 ? Math.min(100, Math.floor((job.retrievedCount / job.totalResults) * 100)) : job.state === 'complete' ? 100 : 0;
  return {
    entityId: job.entityId, state: job.state, startedAt: job.startedAt, updatedAt: job.updatedAt,
    retrievedCount: job.retrievedCount, totalResults: job.totalResults, pageCount: job.pageCount, startIndex: job.startIndex, itemsPerPage: job.itemsPerPage,
    percent: downloadPercent, elapsedMs: elapsedSince(job.startedAt), jobId: job.id, phase: job.phase, phasePercent: job.phasePercent,
    downloadedCount: job.retrievedCount, viewableCount: job.viewableCount, materializedPageCount: job.materializedPageCount,
    lastRequestStartedAt: job.lastRequestStartedAt, lastCheckpointAt: job.lastCheckpointAt, lastHeartbeatAt: job.lastHeartbeatAt,
    stalled: retrievalIsStalled(job), spendFields: job.spendFields, customFields: job.customFields,
    restartRequired: job.state === 'restart-required', retryAttempt: job.retryAttempt, error: job.lastError,
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
  if (current) {
    const durable = readRetrievalJob(entityId, 'spend-profiles');
    if (durable && retrievalIsStalled(durable)) {
      durable.state = 'paused';
      durable.lastError = 'No retrieval heartbeat was recorded for 180 seconds. Resume from the last checkpoint.';
      writeRetrievalJob(durable);
      const paused = { ...progressFromJob(durable), stalled: true };
      progressByEntity.set(entityId, paused);
      return paused;
    }
    const fresh = durable ? progressFromJob(durable) : current;
    return { ...fresh, elapsedMs: fresh.state === 'running' ? elapsedSince(fresh.startedAt) : fresh.elapsedMs };
  }
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
  const manifest = readShardedManifest(shardedDirectory(entityId));
  if (manifest) {
    const latestIdentity = readActiveUsersSummary(entityId);
    return {
      entityId, retrievedAt: manifest.retrievedAt, count: manifest.count, pageCount: manifest.pageCount,
      identityCount: latestIdentity?.count ?? 0, generation: manifest.generation, identityGeneration: manifest.identityGeneration,
      identityStale: Boolean(manifest.identityGeneration && latestIdentity?.generation && manifest.identityGeneration !== latestIdentity.generation),
      spendFields: manifest.spendFields ?? [], customFields: manifest.customFields ?? [],
    };
  }
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

function primaryEmail(user?: ActiveUserProfile) { return user?.emails?.find((email) => email.type === 'work')?.value ?? user?.emails?.[0]?.value ?? ''; }
function preferredName(user?: ActiveUserProfile) { return user?.preferredName ?? user?.displayName ?? user?.name?.formatted ?? [user?.name?.givenName, user?.name?.familyName].filter(Boolean).join(' '); }
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && 'value' in (value as Record<string, unknown>)) return stringifyValue((value as Record<string, unknown>).value);
  return JSON.stringify(value);
}
function spendProfileValues(profile: SpendProfileResource, identity?: ActiveUserProfile): Record<string, string> {
  const enterprise = identity?.[ENTERPRISE_USER_SCHEMA];
  const values: Record<string, string> = { id: profile.id, identityPresent: String(Boolean(identity)), loginId: identity?.userName ?? '', employeeNumber: enterprise?.employeeNumber ?? '', email: primaryEmail(identity), preferredName: preferredName(identity) };
  const spend = profile[SPEND_USER_SCHEMA] ?? {};
  for (const [key, value] of Object.entries(spend)) if (key !== 'customData') values[key] = stringifyValue(value);
  for (const item of spend.customData ?? []) if (item.id) values[item.id] = stringifyValue(item.value);
  return values;
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
  values = spendProfileValues(profile, identity ?? undefined);
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
    case 'before': return Boolean(actual) && actual.slice(0, 10) < expected;
    case 'after': return Boolean(actual) && actual.slice(0, 10) > expected;
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
      const allowed: SpendFilterOperator[] = ['eq', 'ne', 'contains', 'startsWith', 'endsWith', 'empty', 'notEmpty', 'before', 'after'];
      return [{ id: typeof object.id === 'string' ? object.id : `condition-${depth}`, kind: 'condition' as const, field: object.field, operator: allowed.includes(object.operator as SpendFilterOperator) ? object.operator as SpendFilterOperator : 'eq', value: typeof object.value === 'string' ? object.value : '' }];
    }),
  });
  return normalize(value as Record<string, unknown>, 0);
}
function normalizedQuery(value: unknown): SpendProfilesQuery {
  const body = value && typeof value === 'object' ? value as Partial<SpendProfilesQuery> : {};
  return { offset: Math.max(0, Number(body.offset) || 0), limit: Math.max(1, Math.min(Number(body.limit) || 200, 500)), filters: normalizedFilters(body.filters), sortBy: typeof body.sortBy === 'string' && body.sortBy ? body.sortBy : 'loginId', sortDir: body.sortDir === 'desc' ? 'desc' : 'asc', includeOrphans: body.includeOrphans === true, source: body.source === 'complete' ? 'complete' : 'latest' };
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

function collectSpendFilterFields(group: SpendFilterGroup, fields: Set<string>): void {
  for (const item of group.items) item.kind === 'group' ? collectSpendFilterFields(item, fields) : fields.add(item.field);
}

function partialSpendProfiles(entityId: string, job: RetrievalJob, query: SpendProfilesQuery): SpendProfilesQueryResult {
  const candidates: Array<{ id: string; value: string }> = [];
  for (let start = 1; start <= job.materializedPageCount; start += 20) {
    const profiles: SpendProfileResource[] = [];
    for (const page of iterateRetrievalPages<SpendProfileResource>(job, start, Math.min(job.materializedPageCount, start + 19))) profiles.push(...page.resources);
    const identities = getActiveUsersByIds(entityId, profiles.map((profile) => profile.id), job.identityGeneration);
    for (const profile of profiles) {
      const identity = identities.get(profile.id);
      if (!query.includeOrphans && !identity) continue;
      const values = spendProfileValues(profile, identity);
      if (query.filters.items.length && !matchesGroup(values, query.filters)) continue;
      candidates.push({ id: profile.id, value: values[query.sortBy] ?? '' });
    }
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const direction = query.sortDir === 'asc' ? 1 : -1;
  candidates.sort((left, right) => collator.compare(left.value, right.value) * direction || collator.compare(left.id, right.id));
  const offset = Math.min(query.offset, candidates.length);
  const selectedIds = candidates.slice(offset, offset + query.limit).map(({ id }) => id);
  const wanted = new Set(selectedIds);
  const selectedProfiles = new Map<string, SpendProfileResource>();
  for (const page of iterateRetrievalPages<SpendProfileResource>(job, 1, job.materializedPageCount)) {
    for (const profile of page.resources) if (wanted.has(profile.id)) selectedProfiles.set(profile.id, profile);
    if (selectedProfiles.size === wanted.size) break;
  }
  const identities = getActiveUsersByIds(entityId, selectedIds, job.identityGeneration);
  const rows = selectedIds.flatMap((id) => {
    const profile = selectedProfiles.get(id);
    if (!profile) return [];
    const values = spendProfileValues(profile, identities.get(id));
    return [{ id, loginId: values.loginId, employeeNumber: values.employeeNumber, email: values.email, preferredName: values.preferredName, values }];
  });
  return {
    rows, total: candidates.length, snapshotCount: job.viewableCount, retrievedAt: job.lastCheckpointAt ?? job.updatedAt,
    offset, limit: query.limit, hasMore: offset + query.limit < candidates.length, complete: false, jobId: job.id,
    sourceGeneration: job.stagingGeneration ?? job.id, downloadedCount: job.retrievedCount, viewableCount: job.viewableCount,
  };
}

function shardedSpendSelection(entityId: string, query: SpendProfilesQuery) {
  const directory = shardedDirectory(entityId);
  const manifest = readShardedManifest(directory);
  if (!manifest) return null;
  const cacheKey = JSON.stringify({ entityId, generation: manifest.generation, filters: query.filters, sortBy: query.sortBy, sortDir: query.sortDir, includeOrphans: query.includeOrphans });
  const cached = shardedSelectionCache.get(cacheKey);
  if (cached) {
    shardedSelectionCache.delete(cacheKey);
    shardedSelectionCache.set(cacheKey, cached);
    return cached;
  }
  const fields = new Set<string>(['id', 'identityPresent', query.sortBy]);
  collectSpendFilterFields(query.filters, fields);
  const values = new Map<string, Map<string, string>>();
  for (const field of fields) values.set(field, new Map(readShardedIndex(directory, field, manifest.generation).map((entry) => [entry.id, entry.value])));
  const valueFor = (id: string): Record<string, string> => Object.fromEntries([...values].map(([field, entries]) => [field, entries.get(id) ?? '']));
  const ids = [...(values.get('id')?.keys() ?? [])].filter((id) => {
    const row = valueFor(id);
    if (!query.includeOrphans && row.identityPresent !== 'true') return false;
    return !query.filters.items.length || matchesGroup(row, query.filters);
  });
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const direction = query.sortDir === 'asc' ? 1 : -1;
  ids.sort((left, right) => collator.compare(values.get(query.sortBy)?.get(left) ?? '', values.get(query.sortBy)?.get(right) ?? '') * direction || collator.compare(left, right));
  const selection = { directory, manifest, ids };
  shardedSelectionCache.set(cacheKey, selection);
  if (shardedSelectionCache.size > 4) shardedSelectionCache.delete(shardedSelectionCache.keys().next().value!);
  return selection;
}

function shardedSpendProfiles(entityId: string, query: SpendProfilesQuery): SpendProfilesQueryResult | null {
  const selection = shardedSpendSelection(entityId, query);
  if (!selection) return null;
  const { directory, manifest, ids } = selection;
  const offset = Math.min(query.offset, ids.length);
  const selectedIds = ids.slice(offset, offset + query.limit);
  const profiles = readShardedRecords<SpendProfileResource>(directory, selectedIds, manifest.generation);
  const identities = getActiveUsersByIds(entityId, selectedIds, manifest.identityGeneration);
  const rows = selectedIds.flatMap((id) => {
    const profile = profiles.get(id);
    if (!profile) return [];
    const row = spendProfileValues(profile, identities.get(id));
    return [{ id, loginId: row.loginId, employeeNumber: row.employeeNumber, email: row.email, preferredName: row.preferredName, values: row }];
  });
  return { rows, total: ids.length, snapshotCount: manifest.count, retrievedAt: manifest.retrievedAt, offset, limit: query.limit, hasMore: offset + query.limit < ids.length, complete: true, sourceGeneration: manifest.generation };
}

export function querySpendProfiles(entityId: string, rawQuery: unknown): SpendProfilesQueryResult | null {
  const query = normalizedQuery(rawQuery);
  const job = query.source !== 'complete' ? readRetrievalJob(entityId, 'spend-profiles') : null;
  if (job && job.state !== 'complete' && job.materializedPageCount > 0) return partialSpendProfiles(entityId, job, query);
  const manifest = readShardedManifest(shardedDirectory(entityId));
  if (manifest) {
    const browse = querySpendProfilesBrowse(shardedDirectory(entityId), manifest.generation, query);
    if (browse) return browse;
  }
  const sharded = shardedSpendProfiles(entityId, query);
  if (sharded) return sharded;
  const snapshot = readSpendProfilesSnapshot(entityId);
  if (!snapshot) return null;
  const matching = filteredProfiles(entityId, snapshot, query);
  const offset = Math.min(query.offset, matching.length);
  const rows = matching.slice(offset, offset + query.limit).map((profile) => {
    const values = valuesFor(entityId, profile, snapshot);
    return { id: profile.id, loginId: values.loginId, employeeNumber: values.employeeNumber, email: values.email, preferredName: values.preferredName, values };
  });
  return { rows, total: matching.length, snapshotCount: snapshot.count, retrievedAt: snapshot.retrievedAt, offset, limit: query.limit, hasMore: offset + query.limit < matching.length, complete: true };
}

export function getSpendProfileDetail(entityId: string, userId: string, source: 'latest' | 'complete' = 'latest') {
  const job = source !== 'complete' ? readRetrievalJob(entityId, 'spend-profiles') : null;
  if (job && job.state !== 'complete' && job.materializedPageCount > 0) {
    for (const page of iterateRetrievalPages<SpendProfileResource>(job, 1, job.materializedPageCount)) {
      const spend = page.resources.find((profile) => profile.id === userId);
      if (spend) return { identity: getActiveUserById(entityId, userId, job.identityGeneration), spend, complete: false, jobId: job.id, identityGeneration: job.identityGeneration };
    }
    return null;
  }
  const manifest = readShardedManifest(shardedDirectory(entityId));
  if (manifest) {
    const spend = readShardedRecord<SpendProfileResource>(shardedDirectory(entityId), userId, manifest.generation);
    const identity = getActiveUserById(entityId, userId, manifest.identityGeneration);
    if (!identity && !spend) return null;
    return { identity, spend, complete: true, sourceGeneration: manifest.generation, identityGeneration: manifest.identityGeneration };
  }
  const snapshot = readSpendProfilesSnapshot(entityId);
  const identity = snapshot ? getActiveUserById(entityId, userId, snapshot.identityGeneration) : null;
  const spend = snapshot?.profiles.find((profile) => profile.id === userId) ?? null;
  if (!identity && !spend) return null;
  return { identity, spend, identityGeneration: snapshot?.identityGeneration };
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
  try { response = await upstreamFetch(url.toString(), { method: 'GET', headers: requestHeaders, signal: profilePageSignal() }); }
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
  const spendFields = new Set<string>();
  const customFields = new Set<string>();
  const seenIds = new Set<string>();
  job.phase = 'validating'; job.phasePercent = 0; job.lastHeartbeatAt = new Date().toISOString();
  writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
  for (const page of iterateRetrievalPages<SpendProfileResource>(job)) {
    if (page.hash !== retrievalPageHash(page.resources)) throw new Error(`Spend Profiles page ${page.sequence} failed checksum validation.`);
    for (const profile of page.resources) {
      if (!profile.id || seenIds.has(profile.id)) throw new Error(`Spend Profiles page ${page.sequence} contains a missing or duplicate ID.`);
      seenIds.add(profile.id);
      addProfileFields(profile, spendFields, customFields);
    }
    if (page.sequence % 20 === 0 || page.sequence === job.pageCount) {
      job.phasePercent = Math.floor((page.sequence / Math.max(1, job.pageCount)) * 100);
      job.lastHeartbeatAt = new Date().toISOString();
      writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
    }
  }
  if (seenIds.size !== job.retrievedCount || (job.totalResults !== null && seenIds.size !== job.totalResults)) throw new Error('Spend Profiles record count did not match the saved retrieval checkpoint.');
  const fields = fieldsFromSets(spendFields, customFields);
  job.spendFields = fields.spendFields; job.customFields = fields.customFields;
  const indexFields = ['id', 'identityPresent', 'loginId', 'employeeNumber', 'email', 'preferredName', ...fields.spendFields, ...fields.customFields];
  let identities = new Map<string, ActiveUserProfile>();
  let writer: ShardedSnapshotWriter<SpendProfileResource>;
  if (job.stagingGeneration) {
    writer = new ShardedSnapshotWriter<SpendProfileResource>(shardedDirectory(job.entityId), job.entityId, indexFields, (profile) => spendProfileValues(profile, identities.get(profile.id)), { generation: job.stagingGeneration, count: job.finalizedRecordCount });
    writer.restoreOffsets(job.materializationOffsets ?? {});
  } else {
    writer = new ShardedSnapshotWriter<SpendProfileResource>(shardedDirectory(job.entityId), job.entityId, indexFields, (profile) => spendProfileValues(profile, identities.get(profile.id)));
    job.stagingGeneration = writer.generation;
    job.materializationOffsets = {};
    job.finalizedPageCount = 0;
    job.finalizedRecordCount = 0;
  }
  job.phase = 'indexing'; job.phasePercent = Math.floor((job.finalizedPageCount / Math.max(1, job.pageCount)) * 100); writeRetrievalJob(job);
    let batch: SpendProfileResource[] = [];
    let batchEndPage = 0;
    let committedRecordCount = 0;
    const resumedPageCount = job.finalizedPageCount;
    const resumedRecordCount = job.finalizedRecordCount;
    for (const page of iterateRetrievalPages<SpendProfileResource>(job)) {
      if (page.sequence <= resumedPageCount) committedRecordCount += page.resources.length;
      else batch.push(...page.resources);
      batchEndPage = page.sequence;
      if (page.sequence > resumedPageCount && (page.sequence % 20 === 0 || page.sequence === job.pageCount)) {
        identities = getActiveUsersByIds(job.entityId, batch.map((profile) => profile.id), job.identityGeneration);
        await writer.appendAsync(batch);
        job.finalizedRecordCount += batch.length;
        batch = [];
        identities = new Map();
        job.finalizedPageCount = batchEndPage;
        job.materializationOffsets = writer.captureOffsets();
        job.phasePercent = Math.floor((batchEndPage / Math.max(1, job.pageCount)) * 100);
        job.lastHeartbeatAt = new Date().toISOString();
        writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
      }
    }
    if (committedRecordCount !== resumedRecordCount) throw new Error('Spend Profiles staging checkpoint does not match its saved pages.');
    job.phase = 'validating'; job.phasePercent = 0; job.lastHeartbeatAt = new Date().toISOString(); writeRetrievalJob(job);
    await validateShardedGeneration(shardedDirectory(job.entityId), writer.generation, indexFields, seenIds.size, (completed, total) => {
      if (completed % 16 && completed !== total) return;
      job.phasePercent = Math.floor((completed / total) * 100);
      job.lastHeartbeatAt = new Date().toISOString();
      writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
    });
    job.phase = 'committing'; job.phasePercent = 0; job.lastHeartbeatAt = new Date().toISOString(); writeRetrievalJob(job);
    const manifest = writer.prepare(retrievedAt, job.pageCount, { identityGeneration: job.identityGeneration, ...fields });
    writer.commit();
    try {
      writeJsonSnapshot(summaryPath(job.entityId), {
        entityId: job.entityId, retrievedAt, count: manifest.count, pageCount: job.pageCount,
        identityCount: readActiveUsersSummary(job.entityId)?.count ?? 0, generation: manifest.generation,
        identityGeneration: job.identityGeneration, identityStale: false, ...fields,
      } satisfies SpendProfilesSummary);
    } catch { /* The committed manifest is the canonical summary. */ }
    job.phasePercent = 100;
    try { unlinkSync(snapshotPath(job.entityId)); } catch { /* The first sharded retrieval has no legacy file. */ }
    await stopSupersededSpendProfilesBrowseWorkers(shardedDirectory(job.entityId), manifest.generation);
    pruneGenerations(shardedDirectory(job.entityId), [manifest.generation]);
    snapshotCache.delete(job.entityId);
    shardedSelectionCache.clear();
    void ensureSpendProfilesBrowseIndex(shardedDirectory(job.entityId), job.entityId, manifest.generation);
    return { entityId: job.entityId, retrievedAt, count: manifest.count, pageCount: job.pageCount, profiles: [], identityGeneration: job.identityGeneration };
}

async function runSpendProfilesJob(job: RetrievalJob): Promise<SpendProfilesSnapshot> {
  const pending = pendingRefreshes.get(job.entityId);
  if (pending) return pending;
  const run = (async () => {
    try {
      const seenIds = new Set<string>();
      for (const saved of iterateRetrievalPages<SpendProfileResource>(job)) for (const resource of saved.resources) seenIds.add(resource.id);
      if (job.pageCount > 0 && job.nextOffset !== null) {
        const last = readRetrievalPage<SpendProfileResource>(job, job.pageCount)!;
        const verification = await retryPage(job, (attempt) => spendPage(job.entityId, last.startIndex ?? 1, attempt));
        const verificationMatches = retrievalPageHash(verification.Resources ?? []) === last.hash
          && (last.totalResults === null || verification.totalResults === undefined || verification.totalResults === last.totalResults)
          && (verification.startIndex === undefined || verification.startIndex === last.startIndex)
          && (verification.itemsPerPage === undefined || verification.itemsPerPage === last.itemsPerPage);
        if (!verificationMatches) throw new Error('Spend Profiles changed at the saved pagination boundary. Restart retrieval to keep a stable snapshot.');
      }
      if (job.nextOffset === null && job.pageCount > 0) {
        job.state = 'finalizing'; job.phase = 'validating'; writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
        const snapshot = await spendSnapshotFromJob(job);
        job.state = 'complete'; job.phase = 'complete'; job.phasePercent = 100; job.retrievedCount = snapshot.count; job.totalResults = snapshot.count; job.viewableCount = snapshot.count; job.lastError = undefined; job.materializationOffsets = undefined; writeRetrievalJob(job); deleteRetrievalPages(job);
        progressByEntity.set(job.entityId, { ...progressFromJob(job), state: 'complete', percent: 100, updatedAt: snapshot.retrievedAt });
        return snapshot;
      }
      job.state = 'running'; job.phase = 'downloading'; job.lastError = undefined; writeRetrievalJob(job);
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
        const spendFields = new Set(job.spendFields ?? []);
        const customFields = new Set(job.customFields ?? []);
        for (const resource of resources) addProfileFields(resource, spendFields, customFields);
        const discovered = fieldsFromSets(spendFields, customFields);
        job.pageCount = saved.sequence; job.retrievedCount += resources.length; job.totalResults = totalResults; job.startIndex = saved.startIndex; job.itemsPerPage = itemsPerPage; job.nextOffset = nextOffset; job.lastPageHash = saved.hash; job.state = 'running';
        job.phase = 'downloading'; job.phasePercent = totalResults ? Math.min(100, Math.floor((job.retrievedCount / totalResults) * 100)) : 0;
        job.lastCheckpointAt = new Date().toISOString(); job.lastHeartbeatAt = job.lastCheckpointAt;
        job.spendFields = discovered.spendFields; job.customFields = discovered.customFields;
        if (job.pageCount % 20 === 0 || nextOffset === null) { job.materializedPageCount = job.pageCount; job.viewableCount = job.retrievedCount; }
        writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
        if (nextOffset === null) break;
      }
      if (job.totalResults !== null && job.retrievedCount !== job.totalResults) throw new Error('Spend Profiles record count did not match the saved total. Restart retrieval to keep a stable snapshot.');
      job.state = 'finalizing'; job.phase = 'validating'; writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
      const snapshot = await spendSnapshotFromJob(job);
      job.state = 'complete'; job.phase = 'complete'; job.phasePercent = 100; job.retrievedCount = snapshot.count; job.totalResults = snapshot.count; job.viewableCount = snapshot.count; job.lastError = undefined; job.materializationOffsets = undefined; writeRetrievalJob(job); deleteRetrievalPages(job);
      progressByEntity.set(job.entityId, { ...progressFromJob(job), state: 'complete', percent: 100, updatedAt: snapshot.retrievedAt });
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.state = /changed|pagination|repeated|checksum|duplicate|record count|staging/i.test(message) ? 'restart-required' : 'paused'; job.lastError = message;
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

export function restartSpendProfilesRetrieval(entityId: string): RetrievalJob {
  const directory = shardedDirectory(entityId);
  const stagingGeneration = readRetrievalJob(entityId, 'spend-profiles')?.stagingGeneration;
  const committedGeneration = readShardedManifest(directory)?.generation;
  if (stagingGeneration !== committedGeneration) discardShardedGeneration(directory, stagingGeneration);
  discardRetrievalJob(entityId, 'spend-profiles');
  return startSpendProfilesRetrieval(entityId);
}

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
  try {
    const summary = readSpendProfilesSummary(entityId);
    const browse = summary?.generation ? ensureSpendProfilesBrowseIndex(shardedDirectory(entityId), entityId, summary.generation) : undefined;
    sendJson(response, 200, {
      summary: summary ? {
        ...summary,
        browseIndexState: browse?.state,
        browseIndexPercent: browse?.percent,
        browseGeneration: browse?.browseGeneration,
        browseIndexPhase: browse?.phase,
        browseIndexError: browse?.error,
      } : null,
      identitySummary: readActiveUsersSummary(entityId),
    });
  }
  catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
export function handleGetSpendProfilesBrowseProgress(response: ServerResponse, entityId: string) {
  try {
    const manifest = readShardedManifest(shardedDirectory(entityId));
    const progress = manifest
      ? getSpendProfilesBrowseProgress(shardedDirectory(entityId), manifest.generation)
      : { state: 'missing', sourceGeneration: '', percent: 0 };
    sendJson(response, 200, { progress });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
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
export function handleResumeSpendProfilesBrowseIndex(response: ServerResponse, entityId: string) {
  try {
    const manifest = readShardedManifest(shardedDirectory(entityId));
    if (!manifest) return sendJson(response, 404, { error: 'No sharded Spend Profiles snapshot is available.' });
    sendJson(response, 202, { progress: resumeSpendProfilesBrowseIndex(shardedDirectory(entityId), entityId, manifest.generation) });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
export function handleRestartSpendProfiles(response: ServerResponse, entityId: string) {
  try { const job = restartSpendProfilesRetrieval(entityId); sendJson(response, 202, { job, progress: progressFromJob(job) }); }
  catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
export function handleQuerySpendProfiles(response: ServerResponse, entityId: string, body: unknown) {
  try {
    const query = normalizedQuery(body);
    const retrieval = query.source !== 'complete' ? readRetrievalJob(entityId, 'spend-profiles') : null;
    const partial = Boolean(retrieval && retrieval.state !== 'complete' && retrieval.materializedPageCount > 0);
    const manifest = readShardedManifest(shardedDirectory(entityId));
    if (!partial && manifest) {
      const result = querySpendProfilesBrowse(shardedDirectory(entityId), manifest.generation, query);
      if (result) return sendJson(response, 200, { result });
      const browse = ensureSpendProfilesBrowseIndex(shardedDirectory(entityId), entityId, manifest.generation);
      if (browse.state !== 'complete') {
        if (!canUseProvisionalSpendProfiles(query)) return sendJson(response, 409, { code: 'SPEND_BROWSE_INDEX_BUILDING', error: 'The local Spend Profiles browse index is still being prepared.' });
        return sendJson(response, 200, { result: readProvisionalSpendProfiles(shardedDirectory(entityId), manifest.generation, query) });
      }
    }
    sendJson(response, 200, { result: querySpendProfiles(entityId, query) });
  }
  catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
export function handleGetSpendProfileDetail(response: ServerResponse, entityId: string, userId: string, source: 'latest' | 'complete' = 'latest') {
  try {
    const detail = getSpendProfileDetail(entityId, userId, source);
    if (!detail) return sendJson(response, 404, { error: 'The Spend Profile was not found in the local snapshot.' });
    sendJson(response, 200, { detail });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
export async function handleExportSpendProfiles(response: ServerResponse, entityId: string, body: unknown) {
  try {
    const summary = readSpendProfilesSummary(entityId);
    const query = normalizedQuery(body);
    const job = query.source !== 'complete' ? readRetrievalJob(entityId, 'spend-profiles') : null;
    if (job && job.state !== 'complete' && job.materializedPageCount > 0) return sendJson(response, 409, { error: 'Export is unavailable while the Spend Profiles snapshot is incomplete.' });
    if (!summary) return sendJson(response, 404, { error: 'No Spend Profile snapshot is available.' });
    const manifest = readShardedManifest(shardedDirectory(entityId));
    if (manifest) {
      const browse = ensureSpendProfilesBrowseIndex(shardedDirectory(entityId), entityId, manifest.generation);
      if (browse.state !== 'complete') return sendJson(response, 409, { code: 'SPEND_BROWSE_INDEX_BUILDING', error: 'Export is unavailable while the local Spend Profiles browse index is being prepared.' });
    }
    const sharded = shardedSpendSelection(entityId, { ...query, source: 'complete' });
    const columns = exportColumns(summary, body && typeof body === 'object' ? (body as { columns?: unknown }).columns : undefined);
    const header = columns.map(csvCell).join(',');
    if (sharded) {
      response.writeHead(200, { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': `attachment; filename="concur-spend-profiles-${entityId}.csv"`, 'Cache-Control': 'no-store' });
      const chunks: string[] = [];
      const write = async (chunk: string) => {
        if (response.write && response.once) {
          if (!response.write(chunk)) await new Promise<void>((resolve) => response.once!('drain', resolve));
        } else chunks.push(chunk);
      };
      await write(`\uFEFF${header}\r\n`);
      for (let offset = 0; offset < sharded.ids.length; offset += 500) {
        const ids = sharded.ids.slice(offset, offset + 500);
        const profiles = readShardedRecords<SpendProfileResource>(sharded.directory, ids, sharded.manifest.generation);
        const identities = getActiveUsersByIds(entityId, ids, sharded.manifest.identityGeneration);
        for (let index = 0; index < ids.length; index += 1) {
          const profile = profiles.get(ids[index]);
          if (!profile) continue;
          const values = spendProfileValues(profile, identities.get(profile.id));
          await write(`${columns.map((column) => csvCell(values[column])).join(',')}${offset + index === sharded.ids.length - 1 ? '' : '\r\n'}`);
        }
      }
      response.end(response.write ? undefined : chunks.join(''));
      return;
    }
    const snapshot = readSpendProfilesSnapshot(entityId);
    if (!snapshot) return sendJson(response, 404, { error: 'No Spend Profile snapshot is available.' });
    const profiles = filteredProfiles(entityId, snapshot, query);
    response.writeHead(200, { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': `attachment; filename="concur-spend-profiles-${entityId}.csv"`, 'Cache-Control': 'no-store' });
    const rows = profiles.map((profile) => { const values = valuesFor(entityId, profile, snapshot); return columns.map((column) => csvCell(values[column])).join(','); });
    if (response.write && response.once) {
      const write = async (chunk: string) => { if (!response.write!(chunk)) await new Promise<void>((resolve) => response.once!('drain', resolve)); };
      await write(`\uFEFF${header}\r\n`);
      for (let index = 0; index < rows.length; index += 1) await write(`${rows[index]}${index === rows.length - 1 ? '' : '\r\n'}`);
      response.end();
    } else response.end(`\uFEFF${[header, ...rows].join('\r\n')}`);
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
