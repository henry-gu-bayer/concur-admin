import { join } from 'node:path';
import { getServerAccessToken } from './concurAuth';
import { logApiCall } from './logger';
import { createEntityRegistry } from './entities';
import { upstreamFetch } from './upstreamFetch';
import { dedupeRefresh } from './refreshCoordinator';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';

/**
 * Server-side repository for Concur Lists v3.
 *
 * Fetches ALL lists by following the paginated `NextPage` URI until exhausted,
 * persists the result to a local JSON data file (`data/{entityId}/v3/lists.json`),
 * and serves it to the SPA. The UI reads the local snapshot; a separate endpoint
 * triggers a fresh retrieval.
 *
 * Note: The v3 API was deprecated on 04/16/2021 but remains functional.
 */

const PAGE_LIMIT = 100;

export interface ConcurListV3 {
  ID: string;
  Name?: string;
  ConnectorID?: string;
  DisplayCodeFirst?: string;
  ExternalThreshold?: string;
  IsVendorList?: boolean;
  SearchCriteriaCode?: string;
  URI?: string;
}

interface ListsV3FileData {
  retrievedAt: string;
  count: number;
  lists: ConcurListV3[];
}

interface ListsV3Page {
  Items?: ConcurListV3[];
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
  return join(entityDataDirectory(entityId), 'v3');
}

function listsFilePathFor(entityId: string): string {
  return join(dataDirectory(entityId), 'lists.json');
}

function baseUrl(entityId: string): string {
  return createEntityRegistry().require(entityId).baseUrl;
}

async function fetchPage(entityId: string, url: string, token: string): Promise<ListsV3Page> {
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
    throw new Error(`List v3 retrieval failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as ListsV3Page;
}

/** Fetch ALL lists across every page by following NextPage. */
export async function fetchAllListsV3(entityId: string): Promise<ListsV3FileData> {
  return dedupeRefresh(`lists-v3:${entityId}`, async () => {
    const token = await getServerAccessToken(entityId);
    let url: string | null =
      `${baseUrl(entityId)}/api/v3.0/common/lists?limit=${PAGE_LIMIT}`;
    const all: ConcurListV3[] = [];

    while (url) {
      const data = await fetchPage(entityId, url, token);
      const batch = data.Items ?? [];
      all.push(...batch);
      // v3 uses NextPage URI instead of links.next rel
      url = data.NextPage
        ? (data.NextPage.startsWith('http') ? data.NextPage : `${baseUrl(entityId)}${data.NextPage}`)
        : null;
    }

    const payload: ListsV3FileData = {
      retrievedAt: new Date().toISOString(),
      count: all.length,
      lists: all,
    };
    writeJsonSnapshot(listsFilePathFor(entityId), payload, true);
    return payload;
  });
}

/** Read the local snapshot, or null if none exists yet. */
export function readListsV3File(entityId: string): ListsV3FileData | null {
  return readJsonSnapshot<ListsV3FileData>(listsFilePathFor(entityId));
}

/** Ensure a snapshot exists: read it, or fetch it if missing/stale. */
export async function ensureListsV3Data(entityId: string): Promise<ListsV3FileData> {
  const existing = readListsV3File(entityId);
  if (existing) return existing;
  return fetchAllListsV3(entityId);
}

export function listsV3FilePath(entityId: string): string {
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

/** GET /api/local/v3/lists — return the local snapshot (fetching it first if absent). */
export async function handleGetListsV3(res: ServerResponse, entityId: string): Promise<void> {
  try {
    const data = await ensureListsV3Data(entityId);
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /api/local/v3/lists/refresh — force a fresh full retrieval from Concur. */
export async function handleRefreshListsV3(res: ServerResponse, entityId: string): Promise<void> {
  try {
    const data = await fetchAllListsV3(entityId);
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
