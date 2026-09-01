import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getServerAccessToken } from './concurAuth';
import { createEntityRegistry } from './entities';
import { logApiCall, logApiCallFailure } from './logger';
import { upstreamFetch } from './upstreamFetch';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';
import { pruneGenerations, readAllShardedRecords, readShardedIndex, readShardedManifest, readShardedRecord, readShardedRecords, ShardedSnapshotWriter } from './shardedIdentitySnapshot';

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

export type ActiveUsersProgressState = 'idle' | 'running' | 'complete' | 'error';

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
  error?: string;
}

const pendingRefreshes = new Map<string, Promise<ActiveUsersSnapshot>>();
const progressByEntity = new Map<string, ActiveUsersProgress>();
const USER_INDEX_FIELDS = ['id', 'name', 'preferredName', 'firstName', 'lastName', 'login', 'employee', 'email', 'active', 'costCenter', 'startDate', 'loginId', 'employeeNumber'];

function idleProgress(entityId: string): ActiveUsersProgress {
  return {
    entityId, state: 'idle', startedAt: null, updatedAt: null,
    retrievedCount: 0, totalResults: null, pageCount: 0,
    startIndex: null, itemsPerPage: PAGE_SIZE, percent: 0,
  };
}

export function getActiveUsersProgress(entityId: string): ActiveUsersProgress {
  const current = progressByEntity.get(entityId);
  if (current) return current;
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
  if (!existsSync(join(identityDirectory, 'spend-profiles.json'))) return [current];
  try {
    const summary = readJsonSnapshot<{ identityGeneration?: string }>(join(identityDirectory, 'spend-profiles-summary.json'));
    if (!summary) return null;
    return summary.identityGeneration ? [current, summary.identityGeneration] : [current];
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

export type UserProfileFilterOperator = 'eq' | 'ne' | 'contains' | 'startsWith' | 'endsWith' | 'empty' | 'notEmpty';
export interface UserProfileFilterCondition { id: string; kind: 'condition'; field: string; operator: UserProfileFilterOperator; value: string }
export interface UserProfileFilterGroup { id: string; kind: 'group'; logic: 'and' | 'or'; items: Array<UserProfileFilterCondition | UserProfileFilterGroup> }

export interface ActiveUsersLocalQuery {
  offset: number;
  limit: number;
  q?: string;
  filters?: UserProfileFilterGroup;
  sortBy: ActiveUserSortKey;
  sortDir: 'asc' | 'desc';
}

export interface ActiveUsersLocalResult {
  users: ActiveUserProfile[];
  total: number;
  snapshotCount: number;
  retrievedAt: string;
  offset: number;
  limit: number;
  hasMore: boolean;
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
    case 'eq': return actual === expected;
    case 'ne': return actual !== expected;
    case 'contains': return actual.includes(expected);
    case 'startsWith': return actual.startsWith(expected);
    case 'endsWith': return actual.endsWith(expected);
    case 'empty': return !actual;
    case 'notEmpty': return Boolean(actual);
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
      const allowed: UserProfileFilterOperator[] = ['eq', 'ne', 'contains', 'startsWith', 'endsWith', 'empty', 'notEmpty'];
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
  };
}

function collectFilterFields(group: UserProfileFilterGroup, fields: Set<string>): void {
  for (const item of group.items) item.kind === 'group' ? collectFilterFields(item, fields) : fields.add(item.field);
}

function shardedMatchingIds(entityId: string, query: ActiveUsersLocalQuery): { ids: string[]; count: number; retrievedAt: string } | null {
  const directory = shardedDirectory(entityId);
  const manifest = readShardedManifest(directory);
  if (!manifest) return null;
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
  return { ids: matching, count: manifest.count, retrievedAt: manifest.retrievedAt };
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

export function queryActiveUsers(entityId: string, query: ActiveUsersLocalQuery): ActiveUsersLocalResult | null {
  const sharded = shardedMatchingIds(entityId, query);
  if (sharded) {
    const offset = Math.max(0, Math.min(query.offset, sharded.ids.length));
    const users = [...readShardedRecords<ActiveUserProfile>(shardedDirectory(entityId), sharded.ids.slice(offset, offset + query.limit)).values()];
    const ordered = new Map(users.map((user) => [user.id, user]));
    return { users: sharded.ids.slice(offset, offset + query.limit).flatMap((id) => ordered.get(id) ?? []), total: sharded.ids.length, snapshotCount: sharded.count, retrievedAt: sharded.retrievedAt, offset, limit: query.limit, hasMore: offset + query.limit < sharded.ids.length };
  }
  const users = legacyMatchingUsers(entityId, query);
  if (!users) return null;
  const legacy = readJsonSnapshot<ActiveUsersSnapshot>(snapshotPath(entityId))!;
  const offset = Math.max(0, Math.min(query.offset, users.length));
  return { users: users.slice(offset, offset + query.limit), total: users.length, snapshotCount: legacy.count, retrievedAt: legacy.retrievedAt, offset, limit: query.limit, hasMore: offset + query.limit < users.length };
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
    response = await upstreamFetch(url, { method: 'POST', headers: requestHeaders, body: requestBody });
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
  if (!response.ok) throw new Error(`Active user retrieval failed: HTTP ${response.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  return JSON.parse(text) as SearchPage;
}

export async function fetchActiveUsersSnapshot(entityId: string): Promise<ActiveUsersSnapshot> {
  const pending = pendingRefreshes.get(entityId);
  if (pending) return pending;

  const startedAt = new Date().toISOString();
  progressByEntity.set(entityId, {
    ...idleProgress(entityId), state: 'running', startedAt, updatedAt: startedAt,
  });
  let writer: ShardedSnapshotWriter<ActiveUserProfile> | null = null;

  const refresh = (async () => {
    const token = await getServerAccessToken(entityId);
    writer = new ShardedSnapshotWriter<ActiveUserProfile>(shardedDirectory(entityId), entityId, USER_INDEX_FIELDS, activeUserValues);
    let retrievedCount = 0;
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let pageCount = 0;

    do {
      const body: Record<string, unknown> = cursor
        ? { schemas: [SEARCH_SCHEMA], count: PAGE_SIZE, cursor }
        : { schemas: [SEARCH_SCHEMA], filter: 'active eq true', attributes: ATTRIBUTES, count: PAGE_SIZE };
      const page = await fetchPage(entityId, token, body);
      const resources = page.Resources ?? [];
      writer.append(resources);
      retrievedCount += resources.length;
      pageCount += 1;
      const previousProgress = getActiveUsersProgress(entityId);
      const totalResults = page.totalResults ?? previousProgress.totalResults;
      const itemsPerPage = page.itemsPerPage ?? previousProgress.itemsPerPage;
      progressByEntity.set(entityId, {
        entityId,
        state: 'running',
        startedAt,
        updatedAt: new Date().toISOString(),
        retrievedCount,
        totalResults,
        pageCount,
        startIndex: page.startIndex ?? null,
        itemsPerPage,
        percent: totalResults === null || totalResults <= 0 ? 0 : Math.min(99, Math.floor((retrievedCount / totalResults) * 100)),
      });
      const next = page.nextCursor?.trim() || null;
      if (next && seenCursors.has(next)) throw new Error('Active user retrieval stopped because Concur repeated a pagination cursor.');
      if (next) seenCursors.add(next);
      cursor = next;
      // No page ceiling: the snapshot must cover every active user. A repeated
      // cursor (checked above) is what distinguishes a stuck feed from a long one.
    } while (cursor);

    const retrievedAt = new Date().toISOString();
    const manifest = writer.finalize(retrievedAt, pageCount);
    // The old monolithic snapshot is intentionally retained until this new
    // generation is valid and the current pointer has been atomically updated.
    try { unlinkSync(snapshotPath(entityId)); } catch { /* A first sharded retrieve has no legacy file. */ }
    const snapshot: ActiveUsersSnapshot = { entityId, retrievedAt, count: manifest.count, pageCount, generation: manifest.generation, profiles: [] };
    writeJsonSnapshot(summaryPath(entityId), { entityId, retrievedAt, count: manifest.count, pageCount, generation: manifest.generation });
    // Pruning runs only once the new pointer is committed, so it can never
    // affect the generation readers resolve.
    const retained = retainedGenerations(entityId, manifest.generation);
    if (retained) pruneGenerations(shardedDirectory(entityId), retained);
    progressByEntity.set(entityId, {
      entityId,
      state: 'complete',
      startedAt,
      updatedAt: snapshot.retrievedAt,
      retrievedCount: manifest.count,
      totalResults: manifest.count,
      pageCount,
      startIndex: getActiveUsersProgress(entityId).startIndex,
      itemsPerPage: getActiveUsersProgress(entityId).itemsPerPage,
      percent: 100,
    });
    return snapshot;
  })().catch((error: unknown) => {
    writer?.discard();
    const current = getActiveUsersProgress(entityId);
    progressByEntity.set(entityId, {
      ...current,
      state: 'error',
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }).finally(() => pendingRefreshes.delete(entityId));

  pendingRefreshes.set(entityId, refresh);
  return refresh;
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
  };
}

export function handleGetActiveUsers(response: ServerResponse, entityId: string): void {
  try {
    sendJson(response, 200, { snapshot: readActiveUsersSnapshot(entityId) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleGetActiveUsersSummary(response: ServerResponse, entityId: string): void {
  try {
    const snapshot = readActiveUsersSummary(entityId);
    sendJson(response, 200, {
      summary: snapshot ? {
        entityId: snapshot.entityId,
        retrievedAt: snapshot.retrievedAt,
        count: snapshot.count,
        pageCount: snapshot.pageCount,
      } : null,
    });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function handleQueryActiveUsers(response: ServerResponse, entityId: string, rawQuery: unknown): void {
  try {
    const query = typeof rawQuery === 'string' ? localQueryFromUrl(rawQuery) : normalizeLocalQuery(rawQuery);
    sendJson(response, 200, { result: queryActiveUsers(entityId, query) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function handleExportActiveUsers(response: ServerResponse, entityId: string, rawQuery: unknown): Promise<void> {
  try {
    const body = rawQuery && typeof rawQuery === 'object' ? rawQuery as ActiveUsersLocalQuery & { columns?: string[] } : null;
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

export async function handleRefreshActiveUsers(response: ServerResponse, entityId: string): Promise<void> {
  try {
    const snapshot = await fetchActiveUsersSnapshot(entityId);
    sendJson(response, 200, {
      summary: {
        entityId: snapshot.entityId,
        retrievedAt: snapshot.retrievedAt,
        count: snapshot.count,
        pageCount: snapshot.pageCount,
      },
    });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}
