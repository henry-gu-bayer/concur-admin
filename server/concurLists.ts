import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { getServerAccessToken } from './concurAuth';
import { logApiCall } from './logger';

/**
 * Server-side repository for Concur Lists (LIST v4).
 *
 * Fetches ALL lists by following the paginated `links.next` rel until exhausted,
 * persists the result to a local JSON data file (`data/lists.json`), and serves
 * it to the SPA. The UI reads the local snapshot; a separate endpoint triggers
 * a fresh retrieval.
 */

const DATA_DIR = process.env.DATA_DIR ?? 'data';
const DATA_FILE = join(DATA_DIR, 'lists.json');
const PAGE_LIMIT = 100;

const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const upstreamFetch = (url: string, init: Record<string, unknown>) =>
  undiciFetch(url, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1]);

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

function baseUrl(): string {
  return (process.env.BASE_URL ?? '').replace(/\/+$/, '');
}

async function fetchPage(url: string, token: string): Promise<ListPage> {
  const requestHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const start = Date.now();
  const res = await upstreamFetch(url, { method: 'GET', headers: requestHeaders });
  const responseTimeMs = Date.now() - start;
  const text = await res.text();

  logApiCall({
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
export async function fetchAllLists(): Promise<ListsFileData> {
  const token = await getServerAccessToken();
  let url: string | null =
    `${baseUrl()}/list/v4/lists?sortBy=name&Deleted=false&limit=${PAGE_LIMIT}`;
  const all: ConcurList[] = [];
  let page = 0;

  while (url) {
    page += 1;
    const data = await fetchPage(url, token);
    const batch = data.content ?? [];
    all.push(...batch);
    const next = data.links?.find((l) => l.rel === 'next')?.href ?? null;
    // Concur returns relative hrefs on some pages; resolve them against baseUrl.
    url = next ? (next.startsWith('http') ? next : `${baseUrl()}${next}`) : null;
  }

  const payload: ListsFileData = { retrievedAt: new Date().toISOString(), count: all.length, lists: all };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
}

/** Read the local snapshot, or null if none exists yet. */
export function readListsFile(): ListsFileData | null {
  if (!existsSync(DATA_FILE)) return null;
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8')) as ListsFileData;
  } catch {
    return null;
  }
}

/** Ensure a snapshot exists: read it, or fetch it if missing/stale. */
export async function ensureListsData(): Promise<ListsFileData> {
  const existing = readListsFile();
  if (existing) return existing;
  return fetchAllLists();
}

export function listsFilePath(): string {
  return DATA_FILE;
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
export async function handleGetLists(res: ServerResponse): Promise<void> {
  try {
    const data = await ensureListsData();
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /api/local/lists/refresh — force a fresh full retrieval from Concur. */
export async function handleRefreshLists(res: ServerResponse): Promise<void> {
  try {
    const data = await fetchAllLists();
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
