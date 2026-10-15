import { EventEmitter } from 'node:events';
import { join, resolve, sep } from 'node:path';
import { getServerAccessToken, refreshServerAccessToken } from './concurAuth';
import { logApiCall } from './logger';
import { createEntityRegistry } from './entities';
import { upstreamFetch } from './upstreamFetch';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';
import { sortItems } from './listItemOrder';
import {
  applyChildren,
  CachedListSnapshot,
  childrenOf,
  dirtySnapshots,
  invalidateSnapshot,
  loadSnapshot,
  markFlushed,
  peekSnapshot,
  ROOT_BUCKET,
  setDirtyFlushHandler,
  storeSnapshot,
} from './listItemsCache';

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
 * Flat storage serializes/searches/filters trivially; the tree shape is
 * rebuilt as a parent → children index by `listItemsCache`. Per-list files
 * mean viewing/refreshing one list never touches the others.
 *
 * Completeness: retrieval is unbounded by default so a snapshot always holds
 * the whole tree. `maxItems` remains available per request as an opt-in bound,
 * and a bounded run still persists what it got and records `truncated: true`
 * so the UI can say so honestly.
 */

const PAGE_LIMIT = 100;          // Concur page size for these endpoints
const CONCURRENCY = 4;           // parallel child-page requests per list

/**
 * Lazy expansion merges one node at a time, so opening several nodes would
 * otherwise rewrite a multi-megabyte snapshot once per click. The in-memory
 * cache is updated immediately and serves every read, while the file catches
 * up shortly after the burst.
 */
const SNAPSHOT_WRITE_DELAY_MS = 250;

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
  /** Pages spent on the last full retrieval; seeds the next run's progress estimate. */
  pageCount?: number;
}

export interface ItemIndexEntry {
  listId: string;
  count: number;
  retrievedAt: string;
  truncated: boolean;
  maxLevel: number;
  complete?: boolean;
  failedChildren?: number;
  pageCount?: number;
}

export interface ItemsIndex {
  lists: Record<string, ItemIndexEntry>;
}

export interface ItemsProgress {
  phase: 'list-start' | 'batch' | 'list-done' | 'list-error' | 'list-skipped';
  listId: string;
  listName?: string;
  items: number;
  truncated?: boolean;
  error?: string;
  listIndex?: number;
  listTotal?: number;
  /** Pages fetched so far for this list. */
  pagesDone?: number;
  /** Best current estimate of this list's total pages; grows as branches are discovered. */
  pagesTotal?: number;
  /** Completion of this list, 0-99 while running and 100 once done. Never decreases. */
  percent?: number;
  /** Completion across every list in the job, weighted by the current list's fraction. */
  overallPercent?: number;
  branchesDone?: number;
  branchesTotal?: number;
  /** Tree depth currently being traversed. */
  level?: number;
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

type PageMeta = ItemPage['page'];

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

/**
 * Fetch every page of one collection, calling `onItems` per page.
 * The page metadata is passed through because it carries `totalPages`, which
 * is what makes a real completion percentage possible.
 */
async function fetchAllPages(
  entityId: string,
  firstUrl: string,
  auth: AuthContext,
  onItems: (items: ConcurListItem[], page: PageMeta) => void
): Promise<void> {
  let url: string | null = firstUrl;
  while (url) {
    const data = await fetchItemPage(entityId, url, auth);
    onItems(data.content ?? [], data.page);
    url = nextUrl(entityId, data);
  }
}

/**
 * Page-based completion estimate for one list.
 *
 * BFS discovers branches while it runs, so the denominator grows: every
 * response reveals its own collection's `totalPages`, and each newly found
 * parent is worth at least one page nobody has requested yet. Pages beat
 * branches as the unit because fan-out is heavily skewed — on a real
 * 23,570-item list three of 98 branches hold half the pages — so branch counts
 * would race to ~97% and then stall for most of the wall time.
 *
 * Two rules keep the number well behaved:
 *  - a previous run's page count seeds the denominator, making a re-retrieval
 *    accurate from the first page;
 *  - with no such seed, nothing is reported until the root level is fully
 *    enumerated, because before that the estimate is wildly optimistic and the
 *    monotonic clamp would lock that optimism in.
 */
function createPageProgress(expectedPages: number | undefined) {
  let pagesDone = 0;
  let pagesKnown = 1;        // the root collection's first request
  let branchesPending = 0;   // parents discovered but not yet started
  let branchesDone = 0;
  let branchesTotal = 1;     // the root collection counts as one branch
  let reporting = (expectedPages ?? 0) > 0;
  let percent = 0;

  return {
    countPage(page: PageMeta): void {
      pagesDone += 1;
      // `totalPages` describes the whole collection, so only count it once.
      if ((page?.number ?? 1) === 1) {
        const totalPages = page?.totalPages ?? 1;
        if (totalPages > 1) pagesKnown += totalPages - 1;
      }
    },
    /** The root level is enumerated; estimates are meaningful from here on. */
    rootComplete(): void {
      reporting = true;
    },
    discoverBranches(count: number): void {
      branchesPending += count;
      branchesTotal += count;
    },
    startBranch(): void {
      if (branchesPending > 0) branchesPending -= 1;
      pagesKnown += 1;
    },
    finishBranch(): void {
      branchesDone += 1;
    },
    report(level: number): Pick<ItemsProgress, 'pagesDone' | 'pagesTotal' | 'percent' | 'branchesDone' | 'branchesTotal' | 'level'> {
      const estimate = Math.max(pagesDone, pagesKnown + branchesPending, expectedPages ?? 0);
      if (reporting) {
        percent = Math.max(percent, Math.min(99, Math.floor((pagesDone / estimate) * 100)));
      }
      return {
        pagesDone,
        pagesTotal: estimate,
        percent: reporting ? percent : undefined,
        branchesDone,
        branchesTotal,
        level,
      };
    },
    get pages(): number {
      return pagesDone;
    },
  };
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
  // Unbounded by default: a snapshot is only useful if it holds the whole tree.
  const maxItems = opts.maxItems && opts.maxItems > 0 ? opts.maxItems : Number.POSITIVE_INFINITY;
  const onProgress = opts.onProgress ?? (() => {});
  const listIdSafe = validateListItemId(listId);
  const auth = { token: await getServerAccessToken(entityId) };
  const progress = createPageProgress(readIndex(entityId).lists[listIdSafe]?.pageCount);

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

  const emit = (level: number) => {
    onProgress({ phase: 'batch', listId, items: byId.size, ...progress.report(level) });
  };

  // Level 1: root items.
  await fetchAllPages(
    entityId,
    `${baseUrl(entityId)}/list/v4/lists/${encodeURIComponent(listIdSafe)}/children?page=1&limit=${PAGE_LIMIT}`,
    auth,
    (batch, page) => {
      progress.countPage(page);
      const fresh = collect(batch);
      progress.discoverBranches(fresh.filter((it) => it.hasChildren).length);
      emit(1);
    }
  );
  progress.finishBranch();
  progress.rootComplete();

  // Levels 2..N: BFS over items that report hasChildren.
  let frontier = [...byId.values()].filter((i) => i.hasChildren);
  let level = 2;
  while (frontier.length && !truncated) {
    const nextFrontier: ConcurListItem[] = [];
    const currentLevel = level;
    // Bounded-concurrency worker pool over the current frontier.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < frontier.length && !truncated) {
        const parent = frontier[cursor++];
        progress.startBranch();
        try {
          await fetchAllPages(
            entityId,
            `${baseUrl(entityId)}/list/v4/items/${encodeURIComponent(validateListItemId(parent.id, 'item ID'))}/children?page=1&limit=${PAGE_LIMIT}`,
            auth,
            (batch, page) => {
              progress.countPage(page);
              const fresh = collect(batch);
              const branches = fresh.filter((it) => it.hasChildren);
              progress.discoverBranches(branches.length);
              nextFrontier.push(...branches);
              emit(currentLevel);
            }
          );
          fetchedChildren.add(parent.id);
        } catch (err) {
          failedChildren.push({ parentId: parent.id, error: err instanceof Error ? err.message : String(err) });
        }
        progress.finishBranch();
        emit(currentLevel);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, frontier.length) }, worker));
    frontier = nextFrontier;
    level += 1;
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
    pageCount: progress.pages,
  };
  const filePath = itemsFilePath(entityId, listIdSafe);
  writeJsonSnapshot(filePath, payload);
  storeSnapshot(entityId, listIdSafe, filePath, payload, false);
  updateIndex(entityId, listIdSafe, indexEntryFor(payload));
  return payload;
}

/* ── Local snapshot readers ─────────────────────────────────────────── */

export function itemsFilePath(entityId: string, listId: string): string {
  const id = validateListItemId(listId);
  const directory = resolve(itemsDirectory(entityId));
  const file = resolve(directory, `${id}.json`);
  // Defense in depth behind validateListItemId. `sep` rather than a literal
  // slash, so the guard holds on Windows instead of rejecting every path.
  if (!file.startsWith(`${directory}${sep}`)) throw new InvalidListItemIdError('Invalid list ID');
  return file;
}

/** The cache entry for a list, or null when nothing is stored yet. */
function cachedSnapshot(entityId: string, listId: string): CachedListSnapshot | null {
  return loadSnapshot(entityId, listId, itemsFilePath(entityId, listId));
}

export function readListItems(entityId: string, listId: string): ListItemsFileData | null {
  return cachedSnapshot(entityId, listId)?.data ?? null;
}

export function readIndex(entityId: string): ItemsIndex {
  return readJsonSnapshot<ItemsIndex>(indexFilePath(entityId)) ?? { lists: {} };
}

function indexEntryFor(data: ListItemsFileData): ItemIndexEntry {
  return {
    listId: data.listId,
    count: data.count,
    retrievedAt: data.retrievedAt,
    truncated: data.truncated,
    maxLevel: data.maxLevel,
    complete: data.complete,
    failedChildren: data.failedChildren?.length ?? 0,
    pageCount: data.pageCount,
  };
}

function updateIndex(entityId: string, listId: string, entry: ItemIndexEntry): void {
  const idx = readIndex(entityId);
  idx.lists[listId] = entry;
  writeJsonSnapshot(indexFilePath(entityId), idx, true);
}

/* ── Coalesced snapshot writes ──────────────────────────────────────── */

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function flushSnapshot(entry: CachedListSnapshot): void {
  const pending = pendingWrites.get(entry.filePath);
  if (pending) {
    clearTimeout(pending);
    pendingWrites.delete(entry.filePath);
  }
  if (!entry.dirty) return;
  try {
    writeJsonSnapshot(entry.filePath, entry.data);
    markFlushed(entry);
    updateIndex(entry.entityId, entry.listId, indexEntryFor(entry.data));
  } catch (error) {
    console.warn('[concur:list-items] failed to persist snapshot:', error instanceof Error ? error.message : error);
  }
}

function scheduleSnapshotWrite(entry: CachedListSnapshot): void {
  const pending = pendingWrites.get(entry.filePath);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => {
    pendingWrites.delete(entry.filePath);
    flushSnapshot(entry);
  }, SNAPSHOT_WRITE_DELAY_MS);
  timer.unref?.();
  pendingWrites.set(entry.filePath, timer);
}

/** Persist every snapshot whose in-memory copy is ahead of its file. */
export function flushPendingListItemWrites(): void {
  for (const entry of dirtySnapshots()) flushSnapshot(entry);
}

// A dirty entry must never be dropped from the cache without reaching disk.
setDirtyFlushHandler(flushSnapshot);
process.once('exit', flushPendingListItemWrites);

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
    // Scanning every list would evict the browsing cache, so read straight from
    // disk unless an entry is already resident (and possibly ahead of the file).
    const filePath = itemsFilePath(entityId, listId);
    const snapshot = peekSnapshot(filePath)?.data ?? readJsonSnapshot<ListItemsFileData>(filePath);
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

/** An empty snapshot to merge the first lazily fetched level into. */
function emptySnapshot(listId: string): ListItemsFileData {
  return {
    listId,
    retrievedAt: new Date().toISOString(),
    count: 0,
    truncated: false,
    maxLevel: 0,
    items: [],
    rootsFetched: false,
    fetchedChildren: [],
    complete: false,
    failedChildren: [],
  };
}

/**
 * Merge one freshly-fetched level into a list's cache and schedule a write.
 * Only the affected parent bucket is re-sorted, and the file write is
 * coalesced, so expanding many nodes in a row stays cheap even on a snapshot
 * with tens of thousands of items.
 */
function mergeLevelIntoCache(
  entityId: string,
  listId: string,
  fresh: ConcurListItem[],
  parentFetched: string | null
): CachedListSnapshot {
  const filePath = itemsFilePath(entityId, listId);
  const entry = loadSnapshot(entityId, listId, filePath)
    ?? storeSnapshot(entityId, listId, filePath, emptySnapshot(listId), true);

  applyChildren(entry, parentFetched ?? ROOT_BUCKET, fresh);

  const data = entry.data;
  data.retrievedAt = new Date().toISOString();
  if (parentFetched === null) data.rootsFetched = true;
  else data.fetchedChildren = [...new Set([...(data.fetchedChildren ?? []), parentFetched])];
  data.failedChildren = (data.failedChildren ?? []).filter((failure) => failure.parentId !== parentFetched);
  // A lazily grown snapshot is only "complete" if a full BFS previously said so
  // and nothing has since been left unresolved.
  data.complete = data.complete === true && !data.truncated && data.failedChildren.length === 0;

  scheduleSnapshotWrite(entry);
  return entry;
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
  const cached = cachedSnapshot(entityId, listIdSafe);
  const wantRoots = parentId === null;

  // Cache hit? The parent index answers this without scanning the snapshot.
  if (cached) {
    const served = wantRoots ? cached.data.rootsFetched : cached.data.fetchedChildren?.includes(parentIdSafe!);
    if (served) {
      return { items: childrenOf(cached, parentIdSafe ?? ROOT_BUCKET), fromCache: true };
    }
  }

  // Cache miss → fetch this one level from Concur.
  const auth = { token: await getServerAccessToken(entityId) };
  const collected: ConcurListItem[] = [];
  const firstUrl = wantRoots
    ? `${baseUrl(entityId)}/list/v4/lists/${encodeURIComponent(listIdSafe)}/children?page=1&limit=${PAGE_LIMIT}`
    : `${baseUrl(entityId)}/list/v4/items/${encodeURIComponent(parentIdSafe!)}/children?page=1&limit=${PAGE_LIMIT}`;
  await fetchAllPages(entityId, firstUrl, auth, (batch) => collected.push(...batch));

  const entry = mergeLevelIntoCache(entityId, listIdSafe, collected, parentIdSafe);
  return { items: childrenOf(entry, parentIdSafe ?? ROOT_BUCKET), fromCache: false };
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
  summary: { total: number; succeeded: number; failed: number; truncated: number; skipped: number };
};
const jobs = new Map<string, Job>();
let jobSeq = 0;

export interface ItemsJobOptions {
  maxItems?: number;
  /** Re-retrieve lists whose snapshot is already complete. */
  force?: boolean;
}

/** Start fetching items for many lists in the background; returns a job id. */
export function startItemsJob(
  entityId: string,
  listIds: string[],
  listNames: Record<string, string>,
  options: ItemsJobOptions = {}
): string {
  const safeListIds = listIds.map((listId) => validateListItemId(listId));
  const id = `items-job-${++jobSeq}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const job: Job = {
    id,
    entityId,
    emitter,
    done: false,
    summary: { total: safeListIds.length, succeeded: 0, failed: 0, truncated: 0, skipped: 0 },
  };
  jobs.set(id, job);

  void (async () => {
    // Yield once so the caller can attach its listeners first. Without this a
    // job that only skips lists would emit every event, including `done`,
    // before anyone is subscribed, and the SSE stream would never close.
    await Promise.resolve();

    const listTotal = safeListIds.length;
    for (let i = 0; i < listTotal; i++) {
      const listId = safeListIds[i];
      const listName = listNames[listId];
      const listIndex = i + 1;
      /** Weight the finished lists plus however far the current one has got. */
      const overall = (fraction: number) => Math.min(100, Math.round(((i + fraction) / listTotal) * 100));

      // A complete snapshot is already the whole tree; re-fetching it would cost
      // hundreds of Concur requests to produce the same file.
      const existing = readIndex(entityId).lists[listId];
      if (!options.force && existing?.complete === true && !existing.truncated) {
        job.summary.skipped += 1;
        job.summary.succeeded += 1;
        emitter.emit('progress', {
          phase: 'list-skipped',
          listId,
          listName,
          items: existing.count,
          listIndex,
          listTotal,
          percent: 100,
          overallPercent: overall(1),
        } satisfies ItemsProgress);
        continue;
      }

      emitter.emit('progress', {
        phase: 'list-start', listId, listName, items: 0, listIndex, listTotal, percent: 0, overallPercent: overall(0),
      } satisfies ItemsProgress);
      try {
        const data = await fetchListItems(entityId, listId, {
          maxItems: options.maxItems,
          onProgress: (p) => emitter.emit('progress', {
            ...p,
            listName,
            listIndex,
            listTotal,
            overallPercent: overall((p.percent ?? 0) / 100),
          }),
        });
        if (data.truncated) job.summary.truncated += 1;
        job.summary.succeeded += 1;
        emitter.emit('progress', {
          phase: 'list-done',
          listId,
          listName,
          items: data.count,
          truncated: data.truncated,
          listIndex,
          listTotal,
          percent: 100,
          overallPercent: overall(1),
          pagesDone: data.pageCount,
          pagesTotal: data.pageCount,
        } satisfies ItemsProgress);
      } catch (err) {
        job.summary.failed += 1;
        emitter.emit('progress', {
          phase: 'list-error',
          listId,
          listName,
          items: 0,
          error: err instanceof Error ? err.message : String(err),
          listIndex,
          listTotal,
          overallPercent: overall(1),
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
    } else {
      invalidateSnapshot(itemsFilePath(entityId, listId));
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
 * Body: { listIds: string[], listNames?: Record<string,string>, maxItems?: number, force?: boolean }
 */
export function handleBulkListItems(
  res: ServerResponse,
  entityId: string,
  body: { listIds?: string[]; listNames?: Record<string, string>; maxItems?: number; force?: boolean }
): void {
  const listIds = body.listIds ?? [];
  if (!listIds.length) return sendJson(res, 400, { error: 'listIds required' });
  let jobId: string;
  try {
    jobId = startItemsJob(entityId, listIds, body.listNames ?? {}, { maxItems: body.maxItems, force: body.force === true });
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
