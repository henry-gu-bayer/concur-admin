import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { getServerAccessToken } from './concurAuth';
import { logApiCall } from './logger';
import { createEntityRegistry } from './entities';
import { upstreamFetch } from './upstreamFetch';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';

/**
 * Server-side repository for Concur List Items v3.
 *
 * Retrieval strategy — flat pagination per list:
 *   GET /api/v3.0/common/listitems?listId={id}&limit=100
 *   Follow NextPage until exhausted.
 * Unlike v4 (which does BFS over a tree), v3 returns all items for a list in
 * a flat stream. The tree structure is reconstructed client-side from ParentID.
 *
 * Storage — per-list flat snapshots:
 *   data/{entityId}/v3/list-items/{listId}.json  → flat items[]
 *   data/{entityId}/v3/list-items/index.json     → per-list counts + retrieval status
 *
 * Note: The v3 API was deprecated on 04/16/2021 but remains functional.
 */

const PAGE_LIMIT = 100;

export interface ConcurListItemV3 {
  ID: string;
  Name?: string;
  ListID?: string;
  ParentID?: string;
  Level1Code?: string;
  Level2Code?: string;
  Level3Code?: string;
  Level4Code?: string;
  Level5Code?: string;
  Level6Code?: string;
  Level7Code?: string;
  Level8Code?: string;
  Level9Code?: string;
  Level10Code?: string;
  URI?: string;
}

export interface ListItemsV3FileData {
  listId: string;
  retrievedAt: string;
  count: number;
  truncated: boolean;
  maxLevel: number;
  items: ConcurListItemV3[];
  complete?: boolean;
  pageCount?: number;
}

export interface ItemV3IndexEntry {
  listId: string;
  count: number;
  retrievedAt: string;
  truncated: boolean;
  maxLevel: number;
  complete?: boolean;
  pageCount?: number;
}

export interface ItemsV3Index {
  lists: Record<string, ItemV3IndexEntry>;
}

export interface ItemsV3Progress {
  phase: 'list-start' | 'batch' | 'list-done' | 'list-error' | 'list-skipped';
  listId: string;
  listName?: string;
  items: number;
  truncated?: boolean;
  error?: string;
  listIndex?: number;
  listTotal?: number;
  pagesDone?: number;
  pagesTotal?: number;
  percent?: number;
  overallPercent?: number;
}

interface ItemsV3Page {
  Items?: ConcurListItemV3[];
  NextPage?: string;
}

function headerMap(headers: { forEach: (cb: (v: string, k: string) => void) => void }): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function dataDirectory(entityId: string): string {
  return join(entityDataDirectory(entityId), 'v3', 'list-items');
}

function itemsFilePath(entityId: string, listId: string): string {
  return join(dataDirectory(entityId), `${listId}.json`);
}

function indexPath(entityId: string): string {
  return join(dataDirectory(entityId), 'index.json');
}

function baseUrl(entityId: string): string {
  return createEntityRegistry().require(entityId).baseUrl;
}

/** Compute the deepest level present in a v3 item by scanning Level1Code..Level10Code. */
function computeMaxLevel(item: ConcurListItemV3): number {
  for (let i = 10; i >= 1; i--) {
    const key = `Level${i}Code` as keyof ConcurListItemV3;
    if (item[key]) return i;
  }
  return 0;
}

async function fetchPage(entityId: string, url: string, token: string): Promise<ItemsV3Page> {
  const requestHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
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

  if (!res.ok) {
    throw new Error(`List items v3 retrieval failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as ItemsV3Page;
}

function readIndex(entityId: string): ItemsV3Index {
  return readJsonSnapshot<ItemsV3Index>(indexPath(entityId)) ?? { lists: {} };
}

function writeIndex(entityId: string, index: ItemsV3Index): void {
  writeJsonSnapshot(indexPath(entityId), index, true);
}

/** Fetch ALL items for one list by paginating through the v3 endpoint. */
export async function fetchListItemsV3(
  entityId: string,
  listId: string,
  opts: {
    onProgress?: (p: ItemsV3Progress) => void;
  } = {}
): Promise<ListItemsV3FileData> {
  const token = await getServerAccessToken(entityId);
  let url: string | null =
    `${baseUrl(entityId)}/api/v3.0/common/listitems?listId=${encodeURIComponent(listId)}&limit=${PAGE_LIMIT}`;
  const all: ConcurListItemV3[] = [];
  let pageCount = 0;

  opts.onProgress?.({
    phase: 'batch',
    listId,
    items: 0,
    pagesDone: 0,
    pagesTotal: undefined,
    percent: 0,
  });

  while (url) {
    const data = await fetchPage(entityId, url, token);
    const batch = data.Items ?? [];
    all.push(...batch);
    pageCount++;

    opts.onProgress?.({
      phase: 'batch',
      listId,
      items: all.length,
      pagesDone: pageCount,
      pagesTotal: undefined, // v3 doesn't tell us total pages upfront
      percent: Math.min(99, pageCount * 5), // rough estimate
    });

    // v3 uses NextPage URI
    url = data.NextPage
      ? (data.NextPage.startsWith('http') ? data.NextPage : `${baseUrl(entityId)}${data.NextPage}`)
      : null;
  }

  // Compute maxLevel across all items
  let maxLevel = 0;
  for (const item of all) {
    const lvl = computeMaxLevel(item);
    if (lvl > maxLevel) maxLevel = lvl;
  }

  const payload: ListItemsV3FileData = {
    listId,
    retrievedAt: new Date().toISOString(),
    count: all.length,
    truncated: false,
    maxLevel,
    items: all,
    complete: true,
    pageCount,
  };

  writeJsonSnapshot(itemsFilePath(entityId, listId), payload, true);

  // Update index
  const index = readIndex(entityId);
  index.lists[listId] = {
    listId,
    count: all.length,
    retrievedAt: payload.retrievedAt,
    truncated: false,
    maxLevel,
    complete: true,
    pageCount,
  };
  writeIndex(entityId, index);

  return payload;
}

/** Read the cached items for a list, or null if nothing cached yet. */
export function readListItemsV3(entityId: string, listId: string): ListItemsV3FileData | null {
  return readJsonSnapshot<ListItemsV3FileData>(itemsFilePath(entityId, listId));
}

/** Ensure items exist for a list: read from cache, or fetch if absent. */
export async function ensureListItemsV3(entityId: string, listId: string): Promise<ListItemsV3FileData> {
  const existing = readListItemsV3(entityId, listId);
  if (existing) return existing;
  return fetchListItemsV3(entityId, listId);
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

export interface ItemsV3JobOptions {
  force?: boolean;
}

/** Start fetching items for many lists in the background; returns a job id. */
export function startItemsV3Job(
  entityId: string,
  listIds: string[],
  listNames: Record<string, string>,
  options: ItemsV3JobOptions = {}
): string {
  const id = `items-v3-job-${++jobSeq}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const job: Job = {
    id,
    entityId,
    emitter,
    done: false,
    summary: { total: listIds.length, succeeded: 0, failed: 0, truncated: 0, skipped: 0 },
  };
  jobs.set(id, job);

  void (async () => {
    await Promise.resolve();

    const listTotal = listIds.length;
    for (let i = 0; i < listTotal; i++) {
      const listId = listIds[i];
      const listName = listNames[listId];
      const listIndex = i + 1;
      const overall = (fraction: number) => Math.min(100, Math.round(((i + fraction) / listTotal) * 100));

      // Skip if complete snapshot already exists
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
        } satisfies ItemsV3Progress);
        continue;
      }

      emitter.emit('progress', {
        phase: 'list-start',
        listId,
        listName,
        items: 0,
        listIndex,
        listTotal,
        percent: 0,
        overallPercent: overall(0),
      } satisfies ItemsV3Progress);

      try {
        const data = await fetchListItemsV3(entityId, listId, {
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
        } satisfies ItemsV3Progress);
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
        } satisfies ItemsV3Progress);
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

/** GET /api/local/v3/list-items-index — per-list retrieval status. */
export function handleGetItemsV3Index(res: ServerResponse, entityId: string): void {
  try {
    sendJson(res, 200, readIndex(entityId));
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** GET /api/local/v3/list-items/{listId} — one list's snapshot. */
export async function handleGetListItemsV3(res: ServerResponse, entityId: string, listId: string, refresh = false): Promise<void> {
  try {
    if (!refresh) {
      const existing = readListItemsV3(entityId, listId);
      if (existing) return sendJson(res, 200, existing);
    }
    const data = await fetchListItemsV3(entityId, listId);
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /api/local/v3/list-items/{listId}/refresh — force fresh retrieval of one list. */
export async function handleRefreshListItemsV3(res: ServerResponse, entityId: string, listId: string): Promise<void> {
  return handleGetListItemsV3(res, entityId, listId, true);
}

/**
 * POST /api/local/v3/list-items/bulk — start a background job over many lists,
 * then stream progress as Server-Sent Events.
 * Body: { listIds: string[], listNames?: Record<string,string>, force?: boolean }
 */
export function handleBulkListItemsV3(
  res: ServerResponse,
  entityId: string,
  body: { listIds?: string[]; listNames?: Record<string, string>; force?: boolean }
): void {
  const listIds = body.listIds ?? [];
  if (!listIds.length) return sendJson(res, 400, { error: 'listIds required' });
  let jobId: string;
  try {
    jobId = startItemsV3Job(entityId, listIds, body.listNames ?? {}, { force: body.force === true });
  } catch (err) {
    return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
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
  const onProgress = (p: ItemsV3Progress) => send('progress', p);
  const onDone = (summary: Job['summary']) => {
    send('done', summary);
    res.end();
    jobs.delete(jobId);
  };
  job.emitter.on('progress', onProgress);
  job.emitter.on('done', onDone);
}
