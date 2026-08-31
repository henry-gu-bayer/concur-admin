import { join } from 'node:path';
import { getServerAccessToken } from './concurAuth';
import { logApiCall } from './logger';
import { createEntityRegistry } from './entities';
import { upstreamFetch } from './upstreamFetch';
import { dedupeRefresh } from './refreshCoordinator';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';

/**
 * Server-side repository for Concur Lists (LIST v4).
 *
 * Fetches ALL lists by following the paginated `links.next` rel until exhausted,
 * persists the result to a local JSON data file (`data/lists.json`), and serves
 * it to the SPA. The UI reads the local snapshot; a separate endpoint triggers
 * a fresh retrieval.
 */

const PAGE_LIMIT = 100;

export interface ConcurList {
  id: string;
  value?: string; // the list name in LIST v4
  name?: string;
  displayName?: string;
  levelCount?: number;
  searchCriteria?: string;
  displayFormat?: string;
  isReadOnly?: boolean;
  isDeleted?: boolean;
  managedBy?: string | null;
  category?: { id: string; type: string };
}

interface ListsFileData {
  retrievedAt: string;
  count: number;
  lists: ConcurList[];
}

interface ListPage {
  content?: ConcurList[];
  links?: { rel: string; href: string }[];
}

function headerMap(headers: { forEach: (cb: (v: string, k: string) => void) => void }): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function dataDirectory(entityId: string): string {
  return join(process.env.DATA_DIR ?? 'data', entityId);
}

function listsFilePathFor(entityId: string): string {
  return join(dataDirectory(entityId), 'lists.json');
}

function baseUrl(entityId: string): string {
  return createEntityRegistry().require(entityId).baseUrl;
}

async function fetchPage(entityId: string, url: string, token: string): Promise<ListPage> {
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
    throw new Error(`List retrieval failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as ListPage;
}

/** Fetch ALL lists across every page by following links.next. */
export async function fetchAllLists(entityId: string): Promise<ListsFileData> {
  return dedupeRefresh(`lists:${entityId}`, async () => {
    const token = await getServerAccessToken(entityId);
    let url: string | null =
      `${baseUrl(entityId)}/list/v4/lists?sortBy=name&Deleted=false&limit=${PAGE_LIMIT}`;
    const all: ConcurList[] = [];

    while (url) {
      const data = await fetchPage(entityId, url, token);
      const batch = data.content ?? [];
      all.push(...batch);
      const next = data.links?.find((l) => l.rel === 'next')?.href ?? null;
      // Concur returns relative hrefs on some pages; resolve them against baseUrl.
      url = next ? (next.startsWith('http') ? next : `${baseUrl(entityId)}${next}`) : null;
    }

    const payload: ListsFileData = { retrievedAt: new Date().toISOString(), count: all.length, lists: all };
    writeJsonSnapshot(listsFilePathFor(entityId), payload, true);
    return payload;
  });
}

/** Read the local snapshot, or null if none exists yet. */
export function readListsFile(entityId: string): ListsFileData | null {
  return readJsonSnapshot<ListsFileData>(listsFilePathFor(entityId));
}

/** Ensure a snapshot exists: read it, or fetch it if missing/stale. */
export async function ensureListsData(entityId: string): Promise<ListsFileData> {
  const existing = readListsFile(entityId);
  if (existing) return existing;
  return fetchAllLists(entityId);
}

export function listsFilePath(entityId: string): string {
  return listsFilePathFor(entityId);
}

/* ── HTTP handlers (wired into the dev-server middleware) ───────────── */

interface ServerResponse {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** GET /api/local/lists — return the local snapshot (fetching it first if absent). */
export async function handleGetLists(res: ServerResponse, entityId: string): Promise<void> {
  try {
    const data = await ensureListsData(entityId);
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /api/local/lists/refresh — force a fresh full retrieval from Concur. */
export async function handleRefreshLists(res: ServerResponse, entityId: string): Promise<void> {
  try {
    const data = await fetchAllLists(entityId);
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
