import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
import { getServerAccessToken, refreshServerAccessToken } from './concurAuth';
import { logApiCall } from './logger';
import { createEntityRegistry } from './entities';
import { upstreamFetch } from './upstreamFetch';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';

/**
 * Server-side repository for Concur List Items (List Item v4).
 *
 * Retrieval strategy — BFS over the tree per list:
 *   GET /list/v4/lists/{listId}/children        → root items (paged)
 *   GET /list/v4/items/{itemId}/children        → children of one item (paged)
 * Every item carries `hasChildren` + `level`, so we only descend where needed.
 * The single-item endpoint (GET /list/v4/items/{itemId}) returns the same
 * shape, so the children traversal already captures full item data.
 *
 * Storage — per-list flat snapshots (NOT one nested mega-file):
 *   data/list-items/{listId}.json   → flat items[] with parentId/level/hasChildren
 *   data/list-items/index.json      → per-list counts + retrieval status
 * Flat storage serializes/searches/filters trivially; the UI rebuilds the tree
 * in memory (id → children map). Per-list files mean viewing/refreshing one
 * list never touches the others.
 *
 * Safety: multi-level "connected" lists can hold 100k+ nodes. A per-list item
 * cap bounds the blast radius; a partial snapshot is still persisted and the
 * index records `truncated: true` so the UI can say so honestly.
 */

const PAGE_LIMIT = 100;          // Concur page size ceiling for these endpoints
const CONCURRENCY = 4;           // parallel child-page requests per list
const DEFAULT_MAX_ITEMS = 50_000; // per-list item cap (override per request)
const BATCH_SIZE = 25;           // items between progress emissions

export interface ConcurListItem {
  id: string;
  code?: string;
  shortCode?: string;
  value?: string;
  parentId: string | null;
  level: number;
  hasChildren?: boolean;
  lists?: { id: string; hasChildren?: boolean }[];
  isDeleted?: boolean;
}

export interface ListItemsFileData {
  listId: string;
  retrievedAt: string;
  count: number;
  truncated: boolean;
  maxLevel: number;
  items: ConcurListItem[];
  /**
   * Incremental-cache bookkeeping for lazy loading:
   *  - rootsFetched: level-1 items are cached
   *  - fetchedChildren: parent ids whose direct children are already cached
   * The UI asks the backend for a node's children; the backend serves from
   * cache when present, otherwise fetches from Concur and merges into the file.
   */
  rootsFetched?: boolean;
  fetchedChildren?: string[];
  complete?: boolean;
  failedChildren?: { parentId: string; error: string }[];
}

export interface ItemIndexEntry {
  listId: string;
  count: number;
  retrievedAt: string;
  truncated: boolean;
  maxLevel: number;
  complete?: boolean;
  failedChildren?: number;
}

export interface ItemsIndex {
  lists: Record<string, ItemIndexEntry>;
}

export interface ItemsProgress {
  phase: 'list-start' | 'batch' | 'list-done' | 'list-error';
  listId: string;
  listName?: string;
  items: number;
  truncated?: boolean;
  error?: string;
  listIndex?: number;
  listTotal?: number;
}

export type SavedListItemSearchField = 'value' | 'code';

/** A compact item result returned by the local snapshot search endpoint. */
export interface SavedListItemSearchMatch {
  listId: string;
  itemId: string;
  value?: string;
  code?: string;
  shortCode?: string;
}

export interface SavedListItemSearchResult {
  matches: SavedListItemSearchMatch[];
  scannedLists: number;
  scannedItems: number;
  truncated: boolean;
}

interface ItemPage {
  content?: ConcurListItem[];
  links?: { rel: string; href: string }[];
  page?: { number?: number; size?: number; totalElements?: number; totalPages?: number };
}

interface AuthContext {
  token: string;
}

export class InvalidListItemIdError extends Error {}

/** IDs become both URL and file-path segments, so accept only opaque Concur ID characters. */
export function validateListItemId(value: string, label = 'list ID'): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    throw new InvalidListItemIdError(`Invalid ${label}`);
  }
  return id;
}

function headerMap(headers: { forEach: (cb: (v: string, k: string) => void) => void }): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function itemsDirectory(entityId: string): string {
  return join(entityDataDirectory(entityId), 'list-items');
}

function indexFilePath(entityId: string): string {
  return join(itemsDirectory(entityId), 'index.json');
}

function baseUrl(entityId: string): string {
  return createEntityRegistry().require(entityId).baseUrl;
}

async function fetchItemPage(entityId: string, url: string, auth: AuthContext, retried = false): Promise<ItemPage> {
  const requestHeaders = { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' };
  const start = Date.now();
  const res = await upstreamFetch(url, { method: 'GET', headers: requestHeaders });
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

  if (res.status === 401 && !retried) {
    auth.token = await refreshServerAccessToken(entityId);
    return fetchItemPage(entityId, url, auth, true);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 160)}`);
  }
  return JSON.parse(text) as ItemPage;
}

/** Resolve a Concur `links.next` href (may be relative) against our base. */
function nextUrl(entityId: string, data: ItemPage): string | null {
  const next = data.links?.find((l) => l.rel === 'next')?.href ?? null;
  return next ? (next.startsWith('http') ? next : `${baseUrl(entityId)}${next}`) : null;
}

/** Fetch every page of one collection, calling `onItems` per page. */
async function fetchAllPages(
  entityId: string,
  firstUrl: string,
  auth: AuthContext,
  onItems: (items: ConcurListItem[]) => void
): Promise<void> {
  let url: string | null = firstUrl;
  while (url) {
    const data = await fetchItemPage(entityId, url, auth);
    const batch = data.content ?? [];
    if (batch.length) onItems(batch);
    url = nextUrl(entityId, data);
  }
}

/** Sort items so the UI can render the tree deterministically: level, then code. */
function sortItems(items: ConcurListItem[]): ConcurListItem[] {
  return [...items].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    const ac = a.code ?? a.shortCode ?? a.value ?? '';
    const bc = b.code ?? b.shortCode ?? b.value ?? '';
    return ac.localeCompare(bc, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/**
 * Retrieve every item of one list (all levels) and persist its snapshot.
 * Emits progress via `onProgress`. Returns the persisted payload.
 */
export async function fetchListItems(
  entityId: string,
  listId: string,
  opts: { maxItems?: number; onProgress?: (p: ItemsProgress) => void } = {}
): Promise<ListItemsFileData> {
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;
  const onProgress = opts.onProgress ?? (() => {});
  const listIdSafe = validateListItemId(listId);
  const auth = { token: await getServerAccessToken(entityId) };

  const byId = new Map<string, ConcurListItem>();
  let truncated = false;
  let maxLevel = 0;
  const fetchedChildren = new Set<string>();
  const failedChildren: { parentId: string; error: string }[] = [];

  const collect = (batch: ConcurListItem[]): ConcurListItem[] => {
    const fresh: ConcurListItem[] = [];
    for (const it of batch) {
      if (truncated) break;
      if (byId.size >= maxItems) {
        truncated = true;
        break;
      }
      if (!byId.has(it.id)) {
        byId.set(it.id, it);
        if (it.level > maxLevel) maxLevel = it.level;
        fresh.push(it);
      }
    }
    return fresh;
  };

  // Level 1: root items.
  await fetchAllPages(entityId, `${baseUrl(entityId)}/list/v4/lists/${encodeURIComponent(listIdSafe)}/children?page=1&limit=${PAGE_LIMIT}`, auth, (b) => {
    collect(b);
    if (byId.size % BATCH_SIZE < PAGE_LIMIT) {
      onProgress({ phase: 'batch', listId, items: byId.size });
    }
  });

  // Levels 2..N: BFS over items that report hasChildren.
  let frontier = [...byId.values()].filter((i) => i.hasChildren);
  while (frontier.length && !truncated) {
    const nextFrontier: ConcurListItem[] = [];
    // Bounded-concurrency worker pool over the current frontier.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < frontier.length && !truncated) {
        const parent = frontier[cursor++];
        try {
          await fetchAllPages(
            entityId,
            `${baseUrl(entityId)}/list/v4/items/${encodeURIComponent(validateListItemId(parent.id, 'item ID'))}/children?page=1&limit=${PAGE_LIMIT}`,
            auth,
            (b) => {
              const fresh = collect(b);
              for (const it of fresh) if (it.hasChildren) nextFrontier.push(it);
            }
          );
          fetchedChildren.add(parent.id);
        } catch (err) {
          failedChildren.push({ parentId: parent.id, error: err instanceof Error ? err.message : String(err) });
        }
        if (byId.size % BATCH_SIZE < PAGE_LIMIT || cursor === frontier.length) {
          onProgress({ phase: 'batch', listId, items: byId.size });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, frontier.length) }, worker));
    frontier = nextFrontier;
  }

  const payload: ListItemsFileData = {
    listId: listIdSafe,
    retrievedAt: new Date().toISOString(),
    count: byId.size,
    truncated,
    maxLevel,
    items: sortItems([...byId.values()]),
    // A full BFS caches every level, so mark roots + every expanded parent.
    rootsFetched: true,
    fetchedChildren: [...fetchedChildren],
    complete: !truncated && failedChildren.length === 0,
    failedChildren,
  };
  writeJsonSnapshot(itemsFilePath(entityId, listIdSafe), payload);
  updateIndex(entityId, listIdSafe, {
    listId: listIdSafe,
    count: payload.count,
    retrievedAt: payload.retrievedAt,
    truncated,
    maxLevel,
    complete: payload.complete,
    failedChildren: failedChildren.length,
  });
  return payload;
}

/* ── Local snapshot readers ─────────────────────────────────────────── */

export function itemsFilePath(entityId: string, listId: string): string {
  const id = validateListItemId(listId);
  const directory = resolve(itemsDirectory(entityId));
  const file = resolve(directory, `${id}.json`);
  if (!file.startsWith(`${directory}/`)) throw new InvalidListItemIdError('Invalid list ID');
  return file;
}

export function readListItems(entityId: string, listId: string): ListItemsFileData | null {
  return readJsonSnapshot<ListItemsFileData>(itemsFilePath(entityId, listId));
}

export function readIndex(entityId: string): ItemsIndex {
  return readJsonSnapshot<ItemsIndex>(indexFilePath(entityId)) ?? { lists: {} };
}

function updateIndex(entityId: string, listId: string, entry: ItemIndexEntry): void {
  const idx = readIndex(entityId);
  idx.lists[listId] = entry;
  writeJsonSnapshot(indexFilePath(entityId), idx, true);
}

/**
 * Search only the item snapshots already stored on disk. Each list contributes
 * at most one match, so a broad query remains useful instead of being consumed
 * by many matching values from a single very large list.
 */
export function searchSavedListItems(
  entityId: string,
  field: SavedListItemSearchField,
  rawQuery: string,
  requestedLimit = 200
): SavedListItemSearchResult {
  if (field !== 'value' && field !== 'code') throw new Error('Search field must be value or code');
  const query = rawQuery.trim().toLocaleLowerCase();
  if (query.length < 2 || query.length > 200) throw new Error('Search query must contain 2 to 200 characters');

  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 500) : 200;
  const matches: SavedListItemSearchMatch[] = [];
  let scannedLists = 0;
  let scannedItems = 0;

  for (const listId of Object.keys(readIndex(entityId).lists)) {
    const snapshot = readListItems(entityId, listId);
    if (!snapshot) continue;
    scannedLists += 1;
    for (const item of snapshot.items) {
      scannedItems += 1;
      const candidates = field === 'value'
        ? [item.value]
        : [item.code, item.shortCode];
      if (!candidates.some((candidate) => candidate?.toLocaleLowerCase().includes(query))) continue;

      matches.push({
        listId,
        itemId: item.id,
        value: item.value,
        code: item.code,
        shortCode: item.shortCode,
      });
      break;
    }
    if (matches.length >= limit) {
      return { matches, scannedLists, scannedItems, truncated: true };
    }
  }
  return { matches, scannedLists, scannedItems, truncated: false };
}

/* ── Lazy (per-node) retrieval with incremental cache ───────────────── */

/**
 * Merge freshly-fetched items into a list's cache file and persist.
 * Marks the relevant parent as fetched so repeat reads hit the cache.
 */
function mergeIntoCache(entityId: string, listId: string, fresh: ConcurListItem[], parentFetched: string | null): ListItemsFileData {
  const existing = readListItems(entityId, listId);
  const byId = new Map<string, ConcurListItem>();
  if (existing) for (const it of existing.items) byId.set(it.id, it);
  let maxLevel = existing?.maxLevel ?? 0;
  for (const it of fresh) {
    if (!byId.has(it.id)) byId.set(it.id, it);
    if (it.level > maxLevel) maxLevel = it.level;
  }

  const fetchedChildren = new Set(existing?.fetchedChildren ?? []);
  if (parentFetched) fetchedChildren.add(parentFetched);
  const failedChildren = (existing?.failedChildren ?? []).filter((failure) => failure.parentId !== parentFetched);

  const payload: ListItemsFileData = {
    listId,
    retrievedAt: new Date().toISOString(),
    count: byId.size,
    truncated: existing?.truncated ?? false,
    maxLevel,
    items: sortItems([...byId.values()]),
    rootsFetched: parentFetched === null ? true : existing?.rootsFetched ?? false,
    fetchedChildren: [...fetchedChildren],
    complete: existing?.complete === true && !payloadTruncated(existing) && failedChildren.length === 0,
    failedChildren,
  };
  writeJsonSnapshot(itemsFilePath(entityId, listId), payload);
  updateIndex(entityId, listId, {
    listId,
    count: payload.count,
    retrievedAt: payload.retrievedAt,
    truncated: payload.truncated,
    maxLevel: payload.maxLevel,
    complete: payload.complete,
    failedChildren: failedChildren.length,
  });
  return payload;
}

function payloadTruncated(existing: ListItemsFileData | null): boolean {
  return existing?.truncated ?? false;
}

/**
 * Get one level of children for a list node, lazily.
 *  - parentId === null → the root (level-1) items
 *  - otherwise → the direct children of that item
 * Serves from the incremental cache when that level was already fetched;
 * otherwise calls Concur, merges the result into the cache, and returns it.
 * Returns { items, fromCache } — items are the node's direct children only.
 */
export async function getChildrenLevel(
  entityId: string,
  listId: string,
  parentId: string | null
): Promise<{ items: ConcurListItem[]; fromCache: boolean }> {
  const listIdSafe = validateListItemId(listId);
  const parentIdSafe = parentId === null ? null : validateListItemId(parentId, 'parent item ID');
  const cached = readListItems(entityId, listIdSafe);
  const wantRoots = parentId === null;

  // Cache hit?
  if (cached) {
    const served = wantRoots ? cached.rootsFetched : cached.fetchedChildren?.includes(parentIdSafe!);
    if (served) {
      const items = cached.items.filter((i) => (wantRoots ? i.level === 1 : i.parentId === parentIdSafe));
      return { items, fromCache: true };
    }
  }

  // Cache miss → fetch this one level from Concur.
  const auth = { token: await getServerAccessToken(entityId) };
  const collected: ConcurListItem[] = [];
  const firstUrl = wantRoots
    ? `${baseUrl(entityId)}/list/v4/lists/${encodeURIComponent(listIdSafe)}/children?page=1&limit=${PAGE_LIMIT}`
    : `${baseUrl(entityId)}/list/v4/items/${encodeURIComponent(parentIdSafe!)}/children?page=1&limit=${PAGE_LIMIT}`;
  await fetchAllPages(entityId, firstUrl, auth, (b) => collected.push(...b));

  mergeIntoCache(entityId, listIdSafe, collected, parentIdSafe);
  return { items: collected, fromCache: false };
}

/** Read the cached items for a list (flat), or null if nothing cached yet. */
export function readCachedItems(entityId: string, listId: string): ListItemsFileData | null {
  return readListItems(entityId, listId);
}

/* ── Bulk job (all lists) with SSE progress ─────────────────────────── */

type Job = {
  id: string;
  entityId: string;
  emitter: EventEmitter;
  done: boolean;
  summary: { total: number; succeeded: number; failed: number; truncated: number };
};
const jobs = new Map<string, Job>();
let jobSeq = 0;

/** Start fetching items for many lists in the background; returns a job id. */
export function startItemsJob(entityId: string, listIds: string[], listNames: Record<string, string>, maxItems?: number): string {
  const safeListIds = listIds.map((listId) => validateListItemId(listId));
  const id = `items-job-${++jobSeq}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const job: Job = { id, entityId, emitter, done: false, summary: { total: safeListIds.length, succeeded: 0, failed: 0, truncated: 0 } };
  jobs.set(id, job);

  void (async () => {
    for (let i = 0; i < safeListIds.length; i++) {
      const listId = safeListIds[i];
      const listName = listNames[listId];
      emitter.emit('progress', { phase: 'list-start', listId, listName, items: 0, listIndex: i + 1, listTotal: safeListIds.length } satisfies ItemsProgress);
      try {
        const data = await fetchListItems(entityId, listId, {
          maxItems,
          onProgress: (p) => emitter.emit('progress', { ...p, listName, listIndex: i + 1, listTotal: safeListIds.length }),
        });
        if (data.truncated) job.summary.truncated += 1;
        job.summary.succeeded += 1;
        emitter.emit('progress', { phase: 'list-done', listId, listName, items: data.count, truncated: data.truncated, listIndex: i + 1, listTotal: safeListIds.length } satisfies ItemsProgress);
      } catch (err) {
        job.summary.failed += 1;
        emitter.emit('progress', {
          phase: 'list-error',
          listId,
          listName,
          items: 0,
          error: err instanceof Error ? err.message : String(err),
          listIndex: i + 1,
          listTotal: safeListIds.length,
        } satisfies ItemsProgress);
      }
    }
    job.done = true;
    emitter.emit('done', job.summary);
  })();

  return id;
}

function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/* ── HTTP handlers (wired into the dev-server middleware) ───────────── */

interface ServerResponse {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
  write?: (chunk: string) => void;
  flushHeaders?: () => void;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** GET /api/local/list-items-index — per-list retrieval status. */
export function handleGetItemsIndex(res: ServerResponse, entityId: string): void {
  try {
    sendJson(res, 200, readIndex(entityId));
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** GET /api/local/list-items/search?field=value|code&q=… — search disk snapshots only. */
export function handleSearchSavedListItems(res: ServerResponse, entityId: string, rawQuery: string): void {
  try {
    const query = new URLSearchParams(rawQuery);
    const field = query.get('field');
    if (field !== 'value' && field !== 'code') throw new Error('Search field must be value or code');
    const result = searchSavedListItems(
      entityId,
      field,
      query.get('q') ?? '',
      Number(query.get('limit') ?? '200')
    );
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** GET /api/local/list-items/{listId} — one list's snapshot (fetch if absent). */
export async function handleGetListItems(res: ServerResponse, entityId: string, listId: string, refresh = false): Promise<void> {
  try {
    if (!refresh) {
      const existing = readListItems(entityId, listId);
      if (existing) return sendJson(res, 200, existing);
    }
    const data = await fetchListItems(entityId, listId);
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, err instanceof InvalidListItemIdError ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * GET /api/local/list-items/{listId}/children[?parent={itemId}]
 * Lazy per-node retrieval for the tree UI. Omits `parent` (or `parent=root`)
 * for level-1. Serves from the incremental cache when available, else fetches
 * from Concur and merges. Returns { items, fromCache, parent }.
 */
export async function handleGetChildren(res: ServerResponse, entityId: string, listId: string, rawQuery: string): Promise<void> {
  try {
    const parent = new URLSearchParams(rawQuery).get('parent');
    const parentId = !parent || parent === 'root' ? null : parent;
    const { items, fromCache } = await getChildrenLevel(entityId, listId, parentId);
    sendJson(res, 200, { listId, parent: parentId, items, fromCache });
  } catch (err) {
    sendJson(res, err instanceof InvalidListItemIdError ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /api/local/list-items/refresh — force fresh retrieval of one list. */
export async function handleRefreshListItems(res: ServerResponse, entityId: string, listId: string): Promise<void> {
  return handleGetListItems(res, entityId, listId, true);
}

/**
 * POST /api/local/list-items/bulk — start a background job over many lists,
 * then stream progress as Server-Sent Events on the same connection.
 * Body: { listIds: string[], listNames?: Record<string,string>, maxItems?: number }
 */
export function handleBulkListItems(
  res: ServerResponse,
  entityId: string,
  body: { listIds?: string[]; listNames?: Record<string, string>; maxItems?: number }
): void {
  const listIds = body.listIds ?? [];
  if (!listIds.length) return sendJson(res, 400, { error: 'listIds required' });
  let jobId: string;
  try {
    jobId = startItemsJob(entityId, listIds, body.listNames ?? {}, body.maxItems);
  } catch (err) {
    return sendJson(res, err instanceof InvalidListItemIdError ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
  }
  const job = getJob(jobId);
  if (!job) return sendJson(res, 500, { error: 'failed to start job' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write?.(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const onProgress = (p: ItemsProgress) => send('progress', p);
  const onDone = (summary: Job['summary']) => {
    send('done', summary);
    res.end();
    jobs.delete(jobId);
  };
  job.emitter.on('progress', onProgress);
  job.emitter.on('done', onDone);
}
