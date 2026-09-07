import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getServerAccessToken, refreshServerAccessToken } from './concurAuth';
import { createEntityRegistry } from './entities';
import { logApiCall, logApiCallFailure } from './logger';
import { upstreamFetch } from './upstreamFetch';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';
import { discardShardedGeneration, pruneGenerations, readAllShardedRecords, readShardedIndex, readShardedManifest, readShardedRecord, readShardedRecords, ShardedSnapshotWriter, validateShardedGeneration } from './shardedIdentitySnapshot';
import { createRetrievalJob, deleteRetrievalPages, discardRetrievalJob, iterateRetrievalPages, profilePageSignal, readRetrievalJob, retrievalIsStalled, retrievalPageHash, retryAfterMilliseconds, retryPage, saveRetrievalPage, UpstreamPageError, writeRetrievalJob, type RetrievalJob, type RetrievalJobState } from './retrievalJobs';
import { activeUsersBrowseGenerationsInProgress, buildActiveUsersBrowseIndex, canUseProvisionalActiveUsers, ensureActiveUsersBrowseIndex, getActiveUsersBrowseProgress, queryActiveUsersBrowse, readProvisionalActiveUsers, resumeActiveUsersBrowseIndex } from './activeUsersBrowseIndex';

const SEARCH_SCHEMA = 'urn:ietf:params:scim:api:messages:concur:2.0:SearchRequest';
const ENTERPRISE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const PAGE_SIZE = 100;
const ATTRIBUTES = [
  'id',
  'userName',
  'displayName',
  'name.givenName',
  'name.familyName',
  'name.middleName',
  'name.formatted',
  'emails.value',
  `${ENTERPRISE_SCHEMA}:employeeNumber`,
  `${ENTERPRISE_SCHEMA}:costCenter`,
  `${ENTERPRISE_SCHEMA}:startDate`,
];

export interface ActiveUserProfile {
  id: string;
  userName?: string;
  displayName?: string;
  preferredName?: string;
  active?: boolean;
  name?: { formatted?: string; givenName?: string; familyName?: string; middleName?: string | null };
  emails?: { value?: string; type?: string }[];
  [ENTERPRISE_SCHEMA]?: { employeeNumber?: string; costCenter?: string | null; startDate?: string | null };
}

interface SearchPage {
  Resources?: ActiveUserProfile[];
  nextCursor?: string | null;
  totalResults?: number;
  startIndex?: number;
  itemsPerPage?: number;
}

export interface ActiveUsersSnapshot {
  entityId: string;
  retrievedAt: string;
  count: number;
  pageCount: number;
  profiles: ActiveUserProfile[];
  generation?: string;
}

export type ActiveUsersProgressState = 'idle' | RetrievalJobState;

export interface ActiveUsersProgress {
  entityId: string;
  state: ActiveUsersProgressState;
  startedAt: string | null;
  updatedAt: string | null;
  retrievedCount: number;
  totalResults: number | null;
  pageCount: number;
  startIndex: number | null;
  itemsPerPage: number;
  percent: number;
  jobId?: string;
  phase?: string;
  restartRequired?: boolean;
  retryAttempt?: number;
  phasePercent?: number;
  downloadedCount?: number;
  viewableCount?: number;
  materializedPageCount?: number;
  lastRequestStartedAt?: string | null;
  lastCheckpointAt?: string | null;
  lastHeartbeatAt?: string | null;
  stalled?: boolean;
  error?: string;
}

const pendingRefreshes = new Map<string, Promise<ActiveUsersSnapshot>>();
const progressByEntity = new Map<string, ActiveUsersProgress>();
const activeQueryCache = new Map<string, { ids: string[]; count: number; retrievedAt: string }>();
const USER_INDEX_FIELDS = ['id', 'name', 'preferredName', 'firstName', 'lastName', 'login', 'employee', 'email', 'active', 'costCenter', 'startDate', 'loginId', 'employeeNumber'];

function idleProgress(entityId: string): ActiveUsersProgress {
  return {
    entityId, state: 'idle', startedAt: null, updatedAt: null,
    retrievedCount: 0, totalResults: null, pageCount: 0,
    startIndex: null, itemsPerPage: PAGE_SIZE, percent: 0,
  };
}

function progressFromJob(job: RetrievalJob): ActiveUsersProgress {
  const downloadPercent = job.state === 'finalizing' || job.state === 'complete'
    ? 100
    : job.totalResults && job.totalResults > 0 ? Math.min(99, Math.floor((job.retrievedCount / job.totalResults) * 100)) : 0;
  return {
    entityId: job.entityId, state: job.state, startedAt: job.startedAt, updatedAt: job.updatedAt,
    retrievedCount: job.retrievedCount, totalResults: job.totalResults, pageCount: job.pageCount,
    startIndex: job.startIndex, itemsPerPage: job.itemsPerPage,
    percent: downloadPercent,
    jobId: job.id, phase: job.phase, phasePercent: job.phasePercent, downloadedCount: job.retrievedCount,
    viewableCount: job.viewableCount, materializedPageCount: job.materializedPageCount,
    lastRequestStartedAt: job.lastRequestStartedAt, lastCheckpointAt: job.lastCheckpointAt,
    lastHeartbeatAt: job.lastHeartbeatAt, stalled: retrievalIsStalled(job),
    restartRequired: job.state === 'restart-required', retryAttempt: job.retryAttempt, error: job.lastError,
  };
}

export function getActiveUsersProgress(entityId: string): ActiveUsersProgress {
  const current = progressByEntity.get(entityId);
  if (current) {
    const durable = readRetrievalJob(entityId, 'active-users');
    if (durable && retrievalIsStalled(durable)) {
      durable.state = 'paused';
      durable.lastError = 'No retrieval heartbeat was recorded for 180 seconds. Resume from the last checkpoint.';
      writeRetrievalJob(durable);
      const paused = { ...progressFromJob(durable), stalled: true };
      progressByEntity.set(entityId, paused);
      return paused;
    }
    return durable ? progressFromJob(durable) : current;
  }
  const job = readRetrievalJob(entityId, 'active-users');
  if (job && job.state !== 'complete') {
    // A persisted running state cannot survive a server restart: no worker remains in
    // this process. Pause explicitly so the UI offers Resume instead of polling forever.
    if (job.state === 'running' || job.state === 'retrying' || job.state === 'finalizing') {
      job.state = 'paused';
      job.lastError = 'Retrieval was interrupted when the local server stopped. Resume to continue.';
      writeRetrievalJob(job);
    }
    return progressFromJob(job);
  }
  const snapshot = readActiveUsersSummary(entityId);
  if (!snapshot) return idleProgress(entityId);
  return {
    entityId,
    state: 'complete',
    startedAt: null,
    updatedAt: snapshot.retrievedAt,
    retrievedCount: snapshot.count,
    totalResults: snapshot.count,
    pageCount: snapshot.pageCount,
    startIndex: null,
    itemsPerPage: PAGE_SIZE,
    percent: 100,
  };
}

function snapshotPath(entityId: string): string {
  return join(entityDataDirectory(entityId), 'identity', 'active-users.json');
}

function shardedDirectory(entityId: string): string { return join(entityDataDirectory(entityId), 'identity', 'active-users'); }

function summaryPath(entityId: string): string {
  return join(entityDataDirectory(entityId), 'identity', 'active-users-summary.json');
}

interface ActiveUsersSnapshotSummary {
  entityId: string;
  retrievedAt: string;
  count: number;
  pageCount: number;
  generation?: string;
}

/**
 * A Spend Profiles snapshot pins the Identity generation it was joined against
 * and keeps reading records from it, so that generation stays live even after a
 * newer retrieval supersedes it. Reading the pin from its sidecar keeps this
 * module free of a dependency on the Spend Profiles handlers, which import from
 * here. Returning null means the pin is unknown, and then nothing is pruned:
 * a retained generation only costs disk, while removing a pinned one breaks the
 * Spend Profiles detail view.
 */
function retainedGenerations(entityId: string, current: string): string[] | null {
  const identityDirectory = join(entityDataDirectory(entityId), 'identity');
  const retained = new Set([current]);
  for (const generation of activeUsersBrowseGenerationsInProgress(shardedDirectory(entityId))) retained.add(generation);
  const inFlightSpend = readRetrievalJob(entityId, 'spend-profiles');
  if (inFlightSpend && inFlightSpend.state !== 'complete' && inFlightSpend.identityGeneration) retained.add(inFlightSpend.identityGeneration);
  const spendManifest = readShardedManifest(join(identityDirectory, 'spend-profiles'));
  if (spendManifest?.identityGeneration) retained.add(spendManifest.identityGeneration);
  if (!existsSync(join(identityDirectory, 'spend-profiles.json'))) return [...retained];
  try {
    const summary = readJsonSnapshot<{ identityGeneration?: string }>(join(identityDirectory, 'spend-profiles-summary.json'));
    if (!summary) return null;
    if (summary.identityGeneration) retained.add(summary.identityGeneration);
    return [...retained];
  } catch {
    return null;
  }
}

function headerMap(headers: { forEach: (callback: (value: string, key: string) => void) => void }): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key.toLowerCase()] = value; });
  return result;
}

export function readActiveUsersSnapshot(entityId: string, generation?: string): ActiveUsersSnapshot | null {
  const manifest = readShardedManifest(shardedDirectory(entityId), generation);
  if (manifest) return { entityId, retrievedAt: manifest.retrievedAt, count: manifest.count, pageCount: manifest.pageCount, generation: manifest.generation, profiles: readAllShardedRecords<ActiveUserProfile>(shardedDirectory(entityId), manifest.generation) };
  if (generation) return null;
  const file = snapshotPath(entityId);
  if (!existsSync(file)) return null;
  const snapshot = readJsonSnapshot<ActiveUsersSnapshot>(file)!;
  if (snapshot.entityId !== entityId || !Array.isArray(snapshot.profiles)) {
    throw new CorruptSnapshotError(file, new Error('Snapshot metadata or profiles collection is invalid'));
  }
  return snapshot;
}

export function readActiveUsersSummary(entityId: string): ActiveUsersSnapshotSummary | null {
  const manifest = readShardedManifest(shardedDirectory(entityId));
  if (manifest) return { entityId, retrievedAt: manifest.retrievedAt, count: manifest.count, pageCount: manifest.pageCount, generation: manifest.generation };
  const file = summaryPath(entityId);
  if (existsSync(file)) {
    try {
      const summary = readJsonSnapshot<ActiveUsersSnapshotSummary>(file)!;
      if (summary.entityId === entityId && Number.isFinite(summary.count)) return summary;
    } catch {
      /* Fall back to the canonical snapshot and repair the sidecar below. */
    }
  }
  const snapshot = readActiveUsersSnapshot(entityId);
  if (!snapshot) return null;
  const summary = {
    entityId: snapshot.entityId,
    retrievedAt: snapshot.retrievedAt,
    count: snapshot.count,
    pageCount: snapshot.pageCount,
  };
  try {
    writeJsonSnapshot(file, summary);
  } catch {
    /* The full snapshot remains valid even if the optional sidecar cannot be written. */
  }
  return summary;
}


export type ActiveUserSortKey = 'id' | 'name' | 'preferredName' | 'firstName' | 'lastName' | 'login' | 'employee' | 'email' | 'active' | 'costCenter' | 'startDate';

export type UserProfileFilterOperator = 'eq' | 'ne' | 'contains' | 'startsWith' | 'endsWith' | 'empty' | 'notEmpty' | 'before' | 'after';
export interface UserProfileFilterCondition { id: string; kind: 'condition'; field: string; operator: UserProfileFilterOperator; value: string }
export interface UserProfileFilterGroup { id: string; kind: 'group'; logic: 'and' | 'or'; items: Array<UserProfileFilterCondition | UserProfileFilterGroup> }

export interface ActiveUsersLocalQuery {
  offset: number;
  limit: number;
  q?: string;
  filters?: UserProfileFilterGroup;
  sortBy: ActiveUserSortKey;
  sortDir: 'asc' | 'desc';
  source?: 'latest' | 'complete';
}

export interface ActiveUsersLocalResult {
  users: ActiveUserProfile[];
  total: number;
  snapshotCount: number;
  retrievedAt: string;
  offset: number;
  limit: number;
  hasMore: boolean;
  complete?: boolean;
  jobId?: string;
  sourceGeneration?: string;
  downloadedCount?: number;
  viewableCount?: number;
  provisional?: boolean;
  orderingReady?: boolean;
}

function enterprise(user: ActiveUserProfile) {
  return user[ENTERPRISE_SCHEMA];
}

function userName(user: ActiveUserProfile): string {
  return user.displayName ?? user.name?.formatted ?? ([user.name?.givenName, user.name?.familyName].filter(Boolean).join(' ') || user.userName || '');
}

function userEmail(user: ActiveUserProfile): string {
  return user.emails?.find((email) => email.type === 'work')?.value ?? user.emails?.[0]?.value ?? '';
}

function sortValue(user: ActiveUserProfile, key: ActiveUserSortKey): string {
  switch (key) {
    case 'id': return user.id;
    case 'name': return userName(user);
    case 'preferredName': return user.preferredName ?? '';
    case 'firstName': return user.name?.givenName ?? '';
    case 'lastName': return user.name?.familyName ?? '';
    case 'login': return user.userName ?? '';
    case 'employee': return enterprise(user)?.employeeNumber ?? '';
    case 'email': return userEmail(user);
    case 'active': return String(user.active ?? '');
    case 'costCenter': return enterprise(user)?.costCenter ?? '';
    case 'startDate': return enterprise(user)?.startDate ?? '';
  }
}

export function activeUserValues(user: ActiveUserProfile): Record<string, string> {
  return {
    id: user.id,
    name: userName(user),
    preferredName: user.preferredName ?? '',
    firstName: user.name?.givenName ?? '',
    lastName: user.name?.familyName ?? '',
    login: user.userName ?? '',
    loginId: user.userName ?? '',
    employee: enterprise(user)?.employeeNumber ?? '',
    employeeNumber: enterprise(user)?.employeeNumber ?? '',
    email: userEmail(user),
    active: String(user.active ?? ''),
    costCenter: enterprise(user)?.costCenter ?? '',
    startDate: enterprise(user)?.startDate ?? '',
  };
}

function matchesCondition(values: Record<string, string>, condition: UserProfileFilterCondition): boolean {
  const actual = (values[condition.field] ?? '').toLocaleLowerCase();
  const expected = condition.value.toLocaleLowerCase();
  switch (condition.operator) {
    case 'eq': return condition.field === 'startDate' ? actual.slice(0, 10) === expected : actual === expected;
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

function matchesGroup(values: Record<string, string>, group: UserProfileFilterGroup): boolean {
  if (!group.items.length) return true;
  const matches = group.items.map((item) => item.kind === 'group' ? matchesGroup(values, item) : matchesCondition(values, item));
  return group.logic === 'and' ? matches.every(Boolean) : matches.some(Boolean);
}

function normalizedFilters(value: unknown): UserProfileFilterGroup {
  const fallback: UserProfileFilterGroup = { id: 'root', kind: 'group', logic: 'and', items: [] };
  if (!value || typeof value !== 'object') return fallback;
  const normalize = (candidate: Record<string, unknown>, depth: number): UserProfileFilterGroup => ({
    id: typeof candidate.id === 'string' ? candidate.id : `group-${depth}`,
    kind: 'group',
    logic: candidate.logic === 'or' ? 'or' : 'and',
    items: depth >= 4 || !Array.isArray(candidate.items) ? [] : candidate.items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const object = item as Record<string, unknown>;
      if (object.kind === 'group') return [normalize(object, depth + 1)];
      if (object.kind !== 'condition' || typeof object.field !== 'string') return [];
      const allowed: UserProfileFilterOperator[] = ['eq', 'ne', 'contains', 'startsWith', 'endsWith', 'empty', 'notEmpty', 'before', 'after'];
      return [{ id: typeof object.id === 'string' ? object.id : `condition-${depth}`, kind: 'condition' as const, field: object.field, operator: allowed.includes(object.operator as UserProfileFilterOperator) ? object.operator as UserProfileFilterOperator : 'eq', value: typeof object.value === 'string' ? object.value : '' }];
    }),
  });
  return normalize(value as Record<string, unknown>, 0);
}

function normalizeLocalQuery(value: unknown): ActiveUsersLocalQuery {
  const query = value && typeof value === 'object' ? value as Partial<ActiveUsersLocalQuery> : {};
  const allowedSorts = new Set<ActiveUserSortKey>(['id', 'name', 'preferredName', 'firstName', 'lastName', 'login', 'employee', 'email', 'active', 'costCenter', 'startDate']);
  return {
    offset: Math.max(0, Number(query.offset) || 0),
    limit: Math.max(1, Math.min(Number(query.limit) || 200, 500)),
    q: typeof query.q === 'string' ? query.q : '',
    filters: normalizedFilters(query.filters),
    sortBy: query.sortBy && allowedSorts.has(query.sortBy) ? query.sortBy : 'name',
    sortDir: query.sortDir === 'desc' ? 'desc' : 'asc',
    source: query.source === 'complete' ? 'complete' : 'latest',
  };
}

function collectFilterFields(group: UserProfileFilterGroup, fields: Set<string>): void {
  for (const item of group.items) item.kind === 'group' ? collectFilterFields(item, fields) : fields.add(item.field);
}

function shardedMatchingIds(entityId: string, query: ActiveUsersLocalQuery): { ids: string[]; count: number; retrievedAt: string } | null {
  const directory = shardedDirectory(entityId);
  const manifest = readShardedManifest(directory);
  if (!manifest) return null;
  const cacheKey = JSON.stringify({ entityId, generation: manifest.generation, q: query.q ?? '', filters: query.filters, sortBy: query.sortBy, sortDir: query.sortDir });
  const cached = activeQueryCache.get(cacheKey);
  if (cached) {
    activeQueryCache.delete(cacheKey);
    activeQueryCache.set(cacheKey, cached);
    return cached;
  }
  const fields = new Set<string>(['id', query.sortBy]);
  if (query.filters?.items.length) collectFilterFields(query.filters, fields);
  const needle = (query.q ?? '').trim().toLocaleLowerCase();
  const searchFields = ['name', 'firstName', 'lastName', 'login', 'email', 'employee', 'costCenter', 'startDate'];
  if (needle) for (const field of searchFields) fields.add(field);
  const values = new Map<string, Map<string, string>>();
  for (const field of fields) values.set(field, new Map(readShardedIndex(directory, field).map((entry) => [entry.id, entry.value])));
  const ids = [...(values.get('id')?.keys() ?? [])];
  const valueFor = (id: string): Record<string, string> => Object.fromEntries([...values].map(([field, entries]) => [field, entries.get(id) ?? '']));
  const matching = ids.filter((id) => {
    const row = valueFor(id);
    if (needle && !searchFields.some((field) => (row[field] ?? '').toLocaleLowerCase().includes(needle))) return false;
    return !query.filters?.items.length || matchesGroup(row, query.filters);
  });
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const direction = query.sortDir === 'asc' ? 1 : -1;
  matching.sort((left, right) => collator.compare(values.get(query.sortBy)?.get(left) ?? '', values.get(query.sortBy)?.get(right) ?? '') * direction || collator.compare(left, right));
  const result = { ids: matching, count: manifest.count, retrievedAt: manifest.retrievedAt };
  activeQueryCache.set(cacheKey, result);
  if (activeQueryCache.size > 4) activeQueryCache.delete(activeQueryCache.keys().next().value!);
  return result;
}

function legacyMatchingUsers(entityId: string, query: ActiveUsersLocalQuery): ActiveUserProfile[] | null {
  const legacy = readJsonSnapshot<ActiveUsersSnapshot>(snapshotPath(entityId));
  if (!legacy) return null;
  const needle = (query.q ?? '').trim().toLocaleLowerCase();
  const matching = legacy.profiles.filter((user) => !needle || [userName(user), user.name?.givenName, user.name?.familyName, user.userName, userEmail(user), enterprise(user)?.employeeNumber, enterprise(user)?.costCenter, enterprise(user)?.startDate].some((value) => String(value ?? '').toLocaleLowerCase().includes(needle))).filter((user) => !query.filters?.items.length || matchesGroup(activeUserValues(user), query.filters));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return matching.sort((a, b) => collator.compare(sortValue(a, query.sortBy), sortValue(b, query.sortBy)) * (query.sortDir === 'asc' ? 1 : -1));
}

export function getActiveUserById(entityId: string, id: string, generation?: string): ActiveUserProfile | null {
  const manifest = readShardedManifest(shardedDirectory(entityId), generation);
  return manifest ? readShardedRecord<ActiveUserProfile>(shardedDirectory(entityId), id, manifest.generation) : generation ? null : readActiveUsersSnapshot(entityId)?.profiles.find((user) => user.id === id) ?? null;
}

export function getActiveUsersByIds(entityId: string, ids: string[], generation?: string): Map<string, ActiveUserProfile> {
  const manifest = readShardedManifest(shardedDirectory(entityId), generation);
  if (manifest) return readShardedRecords<ActiveUserProfile>(shardedDirectory(entityId), ids, manifest.generation);
  if (generation) return new Map();
  const wanted = new Set(ids);
  const profiles = readActiveUsersSnapshot(entityId)?.profiles ?? [];
  return new Map(profiles.filter((profile) => wanted.has(profile.id)).map((profile) => [profile.id, profile]));
}

export function resolveActiveUserReferences(entityId: string, ids: string[], generation?: string) {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const manifest = readShardedManifest(shardedDirectory(entityId), generation);
  const snapshotAvailable = Boolean(manifest) || (!generation && existsSync(snapshotPath(entityId)));
  const users = getActiveUsersByIds(entityId, uniqueIds, generation);
  return {
    snapshotAvailable,
    generation: manifest?.generation,
    users: uniqueIds.flatMap((id) => {
      const user = users.get(id);
      if (!user) return [];
      return [{
        id: user.id,
        userName: user.userName,
        displayName: user.displayName,
        preferredName: user.preferredName,
        name: user.name ? {
          formatted: user.name.formatted,
          givenName: user.name.givenName,
          familyName: user.name.familyName,
        } : undefined,
      }];
    }),
  };
}

export function queryActiveUsers(entityId: string, query: ActiveUsersLocalQuery): ActiveUsersLocalResult | null {
  const retrieval = query.source !== 'complete' ? readRetrievalJob(entityId, 'active-users') : null;
  if (retrieval && retrieval.state !== 'complete' && retrieval.materializedPageCount > 0) {
    const needle = (query.q ?? '').trim().toLocaleLowerCase();
    const searchFields = ['name', 'firstName', 'lastName', 'login', 'email', 'employee', 'costCenter', 'startDate'];
    const candidates: Array<{ id: string; value: string }> = [];
    for (const page of iterateRetrievalPages<ActiveUserProfile>(retrieval, 1, retrieval.materializedPageCount)) {
      for (const user of page.resources) {
        const values = activeUserValues(user);
        if (needle && !searchFields.some((field) => (values[field] ?? '').toLocaleLowerCase().includes(needle))) continue;
        if (query.filters?.items.length && !matchesGroup(values, query.filters)) continue;
        candidates.push({ id: user.id, value: values[query.sortBy] ?? '' });
      }
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const direction = query.sortDir === 'asc' ? 1 : -1;
    candidates.sort((left, right) => collator.compare(left.value, right.value) * direction || collator.compare(left.id, right.id));
    const offset = Math.max(0, Math.min(query.offset, candidates.length));
    const selectedIds = candidates.slice(offset, offset + query.limit).map(({ id }) => id);
    const wanted = new Set(selectedIds);
    const selected = new Map<string, ActiveUserProfile>();
    for (const page of iterateRetrievalPages<ActiveUserProfile>(retrieval, 1, retrieval.materializedPageCount)) {
      for (const user of page.resources) if (wanted.has(user.id)) selected.set(user.id, user);
      if (selected.size === wanted.size) break;
    }
    return {
      users: selectedIds.flatMap((id) => selected.get(id) ?? []), total: candidates.length,
      snapshotCount: retrieval.viewableCount, retrievedAt: retrieval.lastCheckpointAt ?? retrieval.updatedAt,
      offset, limit: query.limit, hasMore: offset + query.limit < candidates.length, complete: false,
      jobId: retrieval.id, sourceGeneration: retrieval.stagingGeneration ?? retrieval.id,
      downloadedCount: retrieval.retrievedCount, viewableCount: retrieval.viewableCount,
    };
  }
  const currentManifest = readShardedManifest(shardedDirectory(entityId));
  if (currentManifest) {
    const browseResult = queryActiveUsersBrowse(shardedDirectory(entityId), currentManifest.generation, query);
    if (browseResult) return browseResult;
  }
  const sharded = shardedMatchingIds(entityId, query);
  if (sharded) {
    const offset = Math.max(0, Math.min(query.offset, sharded.ids.length));
    const users = [...readShardedRecords<ActiveUserProfile>(shardedDirectory(entityId), sharded.ids.slice(offset, offset + query.limit)).values()];
    const ordered = new Map(users.map((user) => [user.id, user]));
    return { users: sharded.ids.slice(offset, offset + query.limit).flatMap((id) => ordered.get(id) ?? []), total: sharded.ids.length, snapshotCount: sharded.count, retrievedAt: sharded.retrievedAt, offset, limit: query.limit, hasMore: offset + query.limit < sharded.ids.length, complete: true, sourceGeneration: readShardedManifest(shardedDirectory(entityId))?.generation };
  }
  const users = legacyMatchingUsers(entityId, query);
  if (!users) return null;
  const legacy = readJsonSnapshot<ActiveUsersSnapshot>(snapshotPath(entityId))!;
  const offset = Math.max(0, Math.min(query.offset, users.length));
  return { users: users.slice(offset, offset + query.limit), total: users.length, snapshotCount: legacy.count, retrievedAt: legacy.retrievedAt, offset, limit: query.limit, hasMore: offset + query.limit < users.length, complete: true };
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function activeUsersForExport(entityId: string, query: Omit<ActiveUsersLocalQuery, 'offset' | 'limit'>): ActiveUserProfile[] | null {
  const sharded = shardedMatchingIds(entityId, { ...query, offset: 0, limit: 500 });
  if (sharded) return sharded.ids.flatMap((id) => getActiveUserById(entityId, id) ?? []);
  return legacyMatchingUsers(entityId, { ...query, offset: 0, limit: 500 });
}

const USER_EXPORT_COLUMNS: Record<string, { label: string; value: (user: ActiveUserProfile) => string }> = {
  id: { label: 'User ID', value: (user) => user.id },
  name: { label: 'Name', value: userName },
  preferredName: { label: 'Preferred Name', value: (user) => user.preferredName ?? '' },
  firstName: { label: 'First Name', value: (user) => user.name?.givenName ?? '' },
  lastName: { label: 'Last Name', value: (user) => user.name?.familyName ?? '' },
  login: { label: 'Login ID', value: (user) => user.userName ?? '' },
  employee: { label: 'Employee Number', value: (user) => enterprise(user)?.employeeNumber ?? '' },
  email: { label: 'Email', value: userEmail },
  active: { label: 'Active', value: (user) => String(user.active ?? '') },
  costCenter: { label: 'Cost Center', value: (user) => enterprise(user)?.costCenter ?? '' },
  startDate: { label: 'Start Date', value: (user) => enterprise(user)?.startDate ?? '' },
};

function selectedExportColumns(requested?: string[]): string[] {
  const required = ['login', 'employee'];
  const selected = requested?.filter((key) => key in USER_EXPORT_COLUMNS) ?? ['name', 'preferredName', 'firstName', 'lastName', 'login', 'employee', 'email', 'active'];
  return [...required, ...selected.filter((key) => !required.includes(key))];
}

function activeUserCsvRow(user: ActiveUserProfile, columns = selectedExportColumns()): string {
  return columns.map((key) => csvCell(USER_EXPORT_COLUMNS[key].value(user))).join(',');
}

export function activeUsersCsv(entityId: string, query: Omit<ActiveUsersLocalQuery, 'offset' | 'limit'>, requestedColumns?: string[]): string | null {
  const users = activeUsersForExport(entityId, query);
  if (!users) return null;
  const columns = selectedExportColumns(requestedColumns);
  const header = columns.map((key) => csvCell(USER_EXPORT_COLUMNS[key].label)).join(',');
  const rows = users.map((user) => activeUserCsvRow(user, columns));
  return [header, ...rows].join('\r\n');
}

async function fetchPage(entityId: string, token: string, body: Record<string, unknown>): Promise<SearchPage> {
  const url = `${createEntityRegistry().require(entityId).baseUrl}/profile/identity/v4.1/Users/.search`;
  const requestBody = JSON.stringify(body);
  const requestHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const start = Date.now();
  let response;
  try {
    response = await upstreamFetch(url, { method: 'POST', headers: requestHeaders, body: requestBody, signal: profilePageSignal() });
  } catch (error) {
    logApiCallFailure(entityId, {
      method: 'POST', url, requestHeaders, requestBody,
      error: error instanceof Error ? error.message : String(error),
      responseTimeMs: Date.now() - start,
    });
    throw error;
  }
  const text = await response.text();
  logApiCall(entityId, {
    method: 'POST', url, requestHeaders, requestBody,
    response: { status: response.status, headers: headerMap(response.headers), body: text },
    responseTimeMs: Date.now() - start,
  });
  const headers = headerMap(response.headers);
  if (!response.ok) throw new UpstreamPageError(`Active user retrieval failed: HTTP ${response.status}${text ? ` — ${text.slice(0, 200)}` : ''}`, response.status, retryAfterMilliseconds(headers['retry-after']));
  return JSON.parse(text) as SearchPage;
}

async function activePage(entityId: string, body: Record<string, unknown>, _retryAttempt: number): Promise<SearchPage> {
  let token = await getServerAccessToken(entityId);
  try {
    return await fetchPage(entityId, token, body);
  } catch (error) {
    if (!(error instanceof UpstreamPageError) || error.status !== 401) throw error;
    token = await refreshServerAccessToken(entityId);
    return fetchPage(entityId, token, body);
  }
}

async function activeSnapshotFromJob(job: RetrievalJob): Promise<ActiveUsersSnapshot> {
  const retrievedAt = new Date().toISOString();
  let writer: ShardedSnapshotWriter<ActiveUserProfile>;
  if (job.stagingGeneration) {
    writer = new ShardedSnapshotWriter<ActiveUserProfile>(shardedDirectory(job.entityId), job.entityId, USER_INDEX_FIELDS, activeUserValues, { generation: job.stagingGeneration, count: job.finalizedRecordCount });
    writer.restoreOffsets(job.materializationOffsets ?? {});
  } else {
    writer = new ShardedSnapshotWriter<ActiveUserProfile>(shardedDirectory(job.entityId), job.entityId, USER_INDEX_FIELDS, activeUserValues);
    job.stagingGeneration = writer.generation;
    job.materializationOffsets = {};
    job.finalizedPageCount = 0;
    job.finalizedRecordCount = 0;
  }
  const seenIds = new Set<string>();
  let batch: ActiveUserProfile[] = [];
  let batchEndPage = 0;
  let committedRecordCount = 0;
  const resumedPageCount = job.finalizedPageCount;
  const resumedRecordCount = job.finalizedRecordCount;
  job.phase = 'indexing'; job.phasePercent = Math.floor((job.finalizedPageCount / Math.max(1, job.pageCount)) * 100); job.lastHeartbeatAt = new Date().toISOString();
  writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
  for (const page of iterateRetrievalPages<ActiveUserProfile>(job)) {
    if (page.hash !== retrievalPageHash(page.resources)) throw new Error(`Active user page ${page.sequence} failed checksum validation.`);
    for (const profile of page.resources) {
      if (!profile.id || seenIds.has(profile.id)) throw new Error(`Active user page ${page.sequence} contains a missing or duplicate ID.`);
      seenIds.add(profile.id);
      if (page.sequence <= resumedPageCount) committedRecordCount += 1;
      else batch.push(profile);
    }
    batchEndPage = page.sequence;
    if (page.sequence > resumedPageCount && (page.sequence % 20 === 0 || page.sequence === job.pageCount)) {
      await writer.appendAsync(batch);
      job.finalizedRecordCount += batch.length;
      batch = [];
      job.finalizedPageCount = batchEndPage;
      job.materializationOffsets = writer.captureOffsets();
      job.phasePercent = Math.floor((batchEndPage / Math.max(1, job.pageCount)) * 100);
      job.lastHeartbeatAt = new Date().toISOString();
      writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
    }
  }
  if (committedRecordCount !== resumedRecordCount) throw new Error('Active user staging checkpoint does not match its saved pages.');
  if (seenIds.size !== job.retrievedCount) {
    throw new Error('Active user record count did not match the saved retrieval checkpoint.');
  }
  job.phase = 'validating'; job.phasePercent = 0; job.lastHeartbeatAt = new Date().toISOString();
  writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
  await validateShardedGeneration(shardedDirectory(job.entityId), writer.generation, USER_INDEX_FIELDS, seenIds.size, (completed, total) => {
    if (completed % 16 && completed !== total) return;
    job.phasePercent = Math.floor((completed / total) * 100);
    job.lastHeartbeatAt = new Date().toISOString();
    writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
  });
  job.phase = 'committing'; job.phasePercent = 0; writeRetrievalJob(job);
  const manifest = writer.prepare(retrievedAt, job.pageCount);
  await buildActiveUsersBrowseIndex(shardedDirectory(job.entityId), job.entityId, manifest.generation, (browse) => {
    job.phase = 'browse-index';
    job.phasePercent = browse.percent;
    job.lastHeartbeatAt = new Date().toISOString();
    writeRetrievalJob(job);
    progressByEntity.set(job.entityId, progressFromJob(job));
  });
  job.phase = 'committing'; job.phasePercent = 99; writeRetrievalJob(job);
  writer.commit();
  try { writeJsonSnapshot(summaryPath(job.entityId), { entityId: job.entityId, retrievedAt, count: manifest.count, pageCount: job.pageCount, generation: manifest.generation }); } catch { /* The committed manifest is the canonical summary. */ }
  try { unlinkSync(snapshotPath(job.entityId)); } catch { /* A first sharded retrieve has no legacy file. */ }
  const retained = retainedGenerations(job.entityId, manifest.generation);
  if (retained) pruneGenerations(shardedDirectory(job.entityId), retained);
  job.phasePercent = 100; job.lastHeartbeatAt = new Date().toISOString();
  return { entityId: job.entityId, retrievedAt, count: manifest.count, pageCount: job.pageCount, generation: manifest.generation, profiles: [] };
}

async function runActiveUsersJob(job: RetrievalJob): Promise<ActiveUsersSnapshot> {
  const pending = pendingRefreshes.get(job.entityId);
  if (pending) return pending;
  const run = (async () => {
    try {
      const seenCursors = new Set<string>();
      for (const page of iterateRetrievalPages<ActiveUserProfile>(job)) if (page.nextCursor) seenCursors.add(page.nextCursor);
      if (job.nextCursor === null && job.pageCount > 0) {
        job.state = 'finalizing';
        writeRetrievalJob(job);
        const snapshot = await activeSnapshotFromJob(job);
        job.state = 'complete'; job.phase = 'complete'; job.phasePercent = 100; job.retrievedCount = snapshot.count; job.totalResults = snapshot.count; job.viewableCount = snapshot.count; job.lastError = undefined; job.materializationOffsets = undefined;
        writeRetrievalJob(job); deleteRetrievalPages(job);
        progressByEntity.set(job.entityId, { ...progressFromJob(job), state: 'complete', percent: 100, updatedAt: snapshot.retrievedAt });
        return snapshot;
      }
      job.state = 'running'; job.phase = 'downloading'; job.lastError = undefined; writeRetrievalJob(job);
      for (;;) {
        const body: Record<string, unknown> = job.nextCursor
          ? { schemas: [SEARCH_SCHEMA], count: PAGE_SIZE, cursor: job.nextCursor }
          : { schemas: [SEARCH_SCHEMA], filter: 'active eq true', attributes: ATTRIBUTES, count: PAGE_SIZE };
        const page = await retryPage(job, (attempt) => activePage(job.entityId, body, attempt));
        const resources = page.Resources ?? [];
        const nextCursor = page.nextCursor?.trim() || null;
        if (nextCursor && seenCursors.has(nextCursor)) throw new UpstreamPageError('Active user retrieval stopped because Concur repeated a pagination cursor.');
        const saved = saveRetrievalPage(job, { request: { cursor: job.nextCursor }, resources, totalResults: page.totalResults ?? job.totalResults, startIndex: page.startIndex ?? null, itemsPerPage: page.itemsPerPage ?? PAGE_SIZE, nextCursor });
        if (nextCursor) seenCursors.add(nextCursor);
        const retrievedCount = job.retrievedCount + resources.length;
        // Concur recalculates totalResults while a cursor traversal is running,
        // so additions or deactivations can legitimately change it between
        // pages. The cursor is the traversal boundary; totalResults is only a
        // progress estimate. Cursor repetition, page hashes and unique IDs are
        // still validated before the generation is committed.
        const reportedTotal = Number.isFinite(page.totalResults) && page.totalResults! >= 0 ? page.totalResults! : 0;
        const estimatedTotal = Math.max(job.totalResults ?? 0, reportedTotal, retrievedCount);
        job.pageCount = saved.sequence; job.retrievedCount = retrievedCount; job.totalResults = estimatedTotal; job.startIndex = saved.startIndex; job.itemsPerPage = saved.itemsPerPage; job.nextCursor = nextCursor; job.lastPageHash = saved.hash; job.state = 'running';
        job.phase = 'downloading'; job.phasePercent = job.totalResults ? Math.min(100, Math.floor((job.retrievedCount / job.totalResults) * 100)) : 0;
        job.lastCheckpointAt = new Date().toISOString(); job.lastHeartbeatAt = job.lastCheckpointAt;
        if (job.pageCount % 20 === 0 || !nextCursor) { job.materializedPageCount = job.pageCount; job.viewableCount = job.retrievedCount; }
        writeRetrievalJob(job);
        progressByEntity.set(job.entityId, progressFromJob(job));
        if (!nextCursor) break;
      }
      job.state = 'finalizing'; writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
      const snapshot = await activeSnapshotFromJob(job);
      job.state = 'complete'; job.phase = 'complete'; job.phasePercent = 100; job.retrievedCount = snapshot.count; job.totalResults = snapshot.count; job.viewableCount = snapshot.count; job.lastError = undefined; job.materializationOffsets = undefined;
      writeRetrievalJob(job); deleteRetrievalPages(job);
      progressByEntity.set(job.entityId, { ...progressFromJob(job), state: 'complete', percent: 100, updatedAt: snapshot.retrievedAt });
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Concur rejects an expired cursor as a client error. It is not safe to
      // continue from a different boundary, because that would mix snapshots.
      const rejectedCursor = error instanceof UpstreamPageError && Boolean(job.nextCursor) && (error.status === 400 || error.status === 404);
      job.state = rejectedCursor || /cursor|pagination|checksum|duplicate|record count|staging/i.test(message) ? 'restart-required' : 'paused'; job.lastError = message;
      writeRetrievalJob(job); progressByEntity.set(job.entityId, progressFromJob(job));
      throw error;
    }
  })().finally(() => pendingRefreshes.delete(job.entityId));
  pendingRefreshes.set(job.entityId, run);
  return run;
}

export function startActiveUsersRetrieval(entityId: string): RetrievalJob {
  const existing = readRetrievalJob(entityId, 'active-users');
  if (existing && existing.state !== 'complete') return existing;
  const job = createRetrievalJob(entityId, 'active-users');
  progressByEntity.set(entityId, progressFromJob(job));
  void runActiveUsersJob(job).catch(() => undefined);
  return job;
}

export function resumeActiveUsersRetrieval(entityId: string): RetrievalJob {
  const job = readRetrievalJob(entityId, 'active-users');
  if (!job) throw new Error('No interrupted User Profiles retrieval is available.');
  if (job.state === 'restart-required') throw new Error('The saved User Profiles cursor is no longer safe to resume. Restart retrieval instead.');
  if (job.state !== 'complete') {
    job.state = 'running';
    job.lastError = undefined;
    writeRetrievalJob(job);
    progressByEntity.set(entityId, progressFromJob(job));
    void runActiveUsersJob(job).catch(() => undefined);
  }
  return job;
}

export function restartActiveUsersRetrieval(entityId: string): RetrievalJob {
  const directory = shardedDirectory(entityId);
  const stagingGeneration = readRetrievalJob(entityId, 'active-users')?.stagingGeneration;
  const committedGeneration = readShardedManifest(directory)?.generation;
  if (stagingGeneration !== committedGeneration) discardShardedGeneration(directory, stagingGeneration);
  discardRetrievalJob(entityId, 'active-users');
  return startActiveUsersRetrieval(entityId);
}

export async function fetchActiveUsersSnapshot(entityId: string): Promise<ActiveUsersSnapshot> {
  const existing = readRetrievalJob(entityId, 'active-users');
  if (existing && existing.state === 'restart-required') throw new Error('The saved User Profiles cursor is no longer safe to resume. Restart retrieval instead.');
  if (existing && existing.state !== 'complete') return runActiveUsersJob(existing);
  discardRetrievalJob(entityId, 'active-users');
  const job = createRetrievalJob(entityId, 'active-users');
  progressByEntity.set(entityId, progressFromJob(job));
  return runActiveUsersJob(job);
}

interface ServerResponse {
  writeHead: (status: number, headers: Record<string, string>) => void;
  write?: (chunk: string) => boolean;
  once?: (event: 'drain', listener: () => void) => void;
  end: (body?: string) => void;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function localQueryFromUrl(rawUrl: string): ActiveUsersLocalQuery {
  const params = new URL(rawUrl, 'http://localhost').searchParams;
  const allowedSorts = new Set<ActiveUserSortKey>(['id', 'name', 'preferredName', 'firstName', 'lastName', 'login', 'employee', 'email', 'active', 'costCenter', 'startDate']);
  const sortByValue = params.get('sortBy') as ActiveUserSortKey | null;
  return {
    offset: Number.parseInt(params.get('offset') ?? '0', 10) || 0,
    limit: Number.parseInt(params.get('limit') ?? '200', 10) || 200,
    q: params.get('q') ?? '', filters: normalizedFilters(null),
    sortBy: sortByValue && allowedSorts.has(sortByValue) ? sortByValue : 'name',
    sortDir: params.get('sortDir') === 'desc' ? 'desc' : 'asc',
    source: params.get('source') === 'complete' ? 'complete' : 'latest',
  };
}

export function handleGetActiveUsers(response: ServerResponse, entityId: string): void {
  try {
    sendJson(response, 200, { snapshot: readActiveUsersSnapshot(entityId) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleResolveActiveUsers(response: ServerResponse, entityId: string, rawUrl: string): void {
  try {
    const params = new URL(rawUrl, 'http://localhost').searchParams;
    const ids = params.getAll('id');
    if (!ids.length) {
      sendJson(response, 400, { error: 'At least one user ID is required.' });
      return;
    }
    if (ids.length > 50) {
      sendJson(response, 400, { error: 'At most 50 user IDs can be resolved at once.' });
      return;
    }
    sendJson(response, 200, resolveActiveUserReferences(entityId, ids, params.get('generation') ?? undefined));
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleGetActiveUsersSummary(response: ServerResponse, entityId: string): void {
  try {
    const snapshot = readActiveUsersSummary(entityId);
    const browseIndex = snapshot?.generation
      ? ensureActiveUsersBrowseIndex(shardedDirectory(entityId), entityId, snapshot.generation)
      : undefined;
    sendJson(response, 200, {
      summary: snapshot ? {
        entityId: snapshot.entityId,
        retrievedAt: snapshot.retrievedAt,
        count: snapshot.count,
        pageCount: snapshot.pageCount,
        generation: snapshot.generation,
        browseIndexState: browseIndex?.state,
        browseIndexPercent: browseIndex?.percent,
        browseGeneration: browseIndex?.browseGeneration,
        browseIndexPhase: browseIndex?.phase,
        browseIndexError: browseIndex?.error,
      } : null,
    });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleQueryActiveUsers(response: ServerResponse, entityId: string, rawQuery: unknown): void {
  try {
    const query = typeof rawQuery === 'string' ? localQueryFromUrl(rawQuery) : normalizeLocalQuery(rawQuery);
    const retrieval = query.source !== 'complete' ? readRetrievalJob(entityId, 'active-users') : null;
    const partial = Boolean(retrieval && retrieval.state !== 'complete' && retrieval.materializedPageCount > 0);
    const manifest = readShardedManifest(shardedDirectory(entityId));
    if (!partial && manifest) {
      const result = queryActiveUsersBrowse(shardedDirectory(entityId), manifest.generation, query);
      if (result) {
        sendJson(response, 200, { result });
        return;
      }
      const browse = ensureActiveUsersBrowseIndex(shardedDirectory(entityId), entityId, manifest.generation);
      if (browse.state !== 'complete') {
        if (!canUseProvisionalActiveUsers(query)) {
          sendJson(response, 409, { code: 'BROWSE_INDEX_BUILDING', error: 'The local User Profiles browse index is still being prepared.' });
          return;
        }
        const users = readProvisionalActiveUsers(shardedDirectory(entityId), manifest.generation, query.offset, query.limit);
        sendJson(response, 200, { result: {
          users, total: manifest.count, snapshotCount: manifest.count, retrievedAt: manifest.retrievedAt,
          offset: query.offset, limit: query.limit, hasMore: false,
          complete: true, sourceGeneration: manifest.generation, provisional: true, orderingReady: false,
        } });
        return;
      }
    }
    sendJson(response, 200, { result: queryActiveUsers(entityId, query) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleGetActiveUsersBrowseProgress(response: ServerResponse, entityId: string): void {
  try {
    const manifest = readShardedManifest(shardedDirectory(entityId));
    const progress = manifest
      ? getActiveUsersBrowseProgress(shardedDirectory(entityId), manifest.generation)
      : { state: 'missing', sourceGeneration: '', percent: 0 };
    sendJson(response, 200, { progress });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleResumeActiveUsersBrowseIndex(response: ServerResponse, entityId: string): void {
  try {
    const manifest = readShardedManifest(shardedDirectory(entityId));
    if (!manifest) {
      sendJson(response, 404, { error: 'No sharded User Profiles snapshot is available.' });
      return;
    }
    sendJson(response, 202, { progress: resumeActiveUsersBrowseIndex(shardedDirectory(entityId), entityId, manifest.generation) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function handleExportActiveUsers(response: ServerResponse, entityId: string, rawQuery: unknown): Promise<void> {
  try {
    const body = rawQuery && typeof rawQuery === 'object' ? rawQuery as ActiveUsersLocalQuery & { columns?: string[] } : null;
    const retrieval = body?.source !== 'complete' ? readRetrievalJob(entityId, 'active-users') : null;
    if (retrieval && retrieval.state !== 'complete' && retrieval.materializedPageCount > 0) {
      sendJson(response, 409, { error: 'Export is unavailable while the User Profiles snapshot is incomplete.' });
      return;
    }
    const manifest = readShardedManifest(shardedDirectory(entityId));
    if (manifest) {
      const browse = ensureActiveUsersBrowseIndex(shardedDirectory(entityId), entityId, manifest.generation);
      if (browse.state !== 'complete') {
        sendJson(response, 409, { code: 'BROWSE_INDEX_BUILDING', error: 'Export is unavailable while the local User Profiles browse index is being prepared.' });
        return;
      }
    }
    const query = typeof rawQuery === 'string' ? localQueryFromUrl(rawQuery) : normalizeLocalQuery(rawQuery);
    const users = activeUsersForExport(entityId, { q: query.q, filters: query.filters, sortBy: query.sortBy, sortDir: query.sortDir });
    if (users === null) {
      sendJson(response, 404, { error: 'No active user snapshot is available.' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': `attachment; filename="concur-user-profiles-${entityId}.csv"`,
      'Cache-Control': 'no-store',
    });
    const columns = selectedExportColumns(body?.columns);
    const header = columns.map((key) => csvCell(USER_EXPORT_COLUMNS[key].label)).join(',');
    if (response.write && response.once) {
      const write = async (chunk: string) => {
        if (response.write!(chunk)) return;
        await new Promise<void>((resolve) => response.once!('drain', resolve));
      };
      await write(`\uFEFF${header}\r\n`);
      for (let index = 0; index < users.length; index += 1) {
        await write(`${activeUserCsvRow(users[index], columns)}${index === users.length - 1 ? '' : '\r\n'}`);
      }
      response.end();
    } else {
      response.end(`\uFEFF${[header, ...users.map((user) => activeUserCsvRow(user, columns))].join('\r\n')}`);
    }
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleGetActiveUsersProgress(response: ServerResponse, entityId: string): void {
  try {
    sendJson(response, 200, { progress: getActiveUsersProgress(entityId) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleRefreshActiveUsers(response: ServerResponse, entityId: string): void {
  try {
    const job = startActiveUsersRetrieval(entityId);
    sendJson(response, 202, { job, progress: progressFromJob(job) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleResumeActiveUsers(response: ServerResponse, entityId: string): void {
  try { const job = resumeActiveUsersRetrieval(entityId); sendJson(response, 202, { job, progress: progressFromJob(job) }); }
  catch (error) { sendJson(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
}

export function handleRestartActiveUsers(response: ServerResponse, entityId: string): void {
  try { const job = restartActiveUsersRetrieval(entityId); sendJson(response, 202, { job, progress: progressFromJob(job) }); }
  catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}
