import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { getServerAccessToken } from './concurAuth';
import { logApiCall } from './logger';

/**
 * Server-side repository for Expense Group Configurations (v3).
 *
 * Endpoint: GET /api/v3.0/expense/expensegroupconfigurations
 * Returns expense group configurations, each carrying the four collections the
 * UI surfaces: PaymentTypes, Policies (with their ExpenseTypes), AttendeeTypes,
 * and the policy→expense-type mapping. Pagination follows the v3 convention:
 * the response includes a `NextPage` URL when more pages exist; we follow it
 * until exhausted and persist the full set to `data/expense-groups.json`.
 *
 * (This Concur entity currently returns a single group with no NextPage, but
 * the loop honours the documented mechanism so multi-group entities work.)
 */

const DATA_DIR = process.env.DATA_DIR ?? 'data';
const DATA_FILE = join(DATA_DIR, 'expense-groups.json');
const USERS_DIR = join(DATA_DIR, 'expense-groups-by-user');
const PAGE_LIMIT = 10; // v3 caps `limit` at 10 (HTTP 400 above that)

const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const upstreamFetch = (url: string, init: Record<string, unknown>) =>
  undiciFetch(url, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1]);

export interface ExpenseType {
  Code?: string;
  Name?: string;
  ExpenseCode?: string;
}

export interface PaymentType {
  ID?: string;
  Name?: string;
  IsDefault?: boolean;
}

export interface Policy {
  ID?: string;
  Name?: string;
  IsDefault?: boolean;
  IsInheritable?: boolean;
  ExpenseTypes?: ExpenseType[];
}

export interface AttendeeType {
  Code?: string;
  Name?: string;
}

export interface CashAdvance {
  WorkflowID?: string;
  Name?: string;
  AllowUserCarryBalance?: boolean;
  AllowUserLinkMultiple?: boolean;
  AllowUserUpdateExchangeRate?: boolean;
}

export interface ExpenseGroupConfiguration {
  ID?: string;
  Name?: string;
  URI?: string;
  AttendeeListFormID?: string;
  AttendeeListFormName?: string;
  AllowUserRegisterYodlee?: boolean;
  AllowUserDigitalTaxInvoice?: boolean;
  CashAdvance?: CashAdvance;
  PaymentTypes?: PaymentType[];
  Policies?: Policy[];
  AttendeeTypes?: AttendeeType[];
}

export interface ExpenseGroupsFileData {
  retrievedAt: string;
  count: number;
  groups: ExpenseGroupConfiguration[];
}

interface EgcPage {
  Items?: ExpenseGroupConfiguration[];
  NextPage?: string | null;
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

async function fetchPage(url: string, token: string): Promise<EgcPage> {
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
    throw new Error(`Expense group config retrieval failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as EgcPage;
}

/** Fetch ALL expense group configurations across every page (follow NextPage). */
export async function fetchAllExpenseGroups(): Promise<ExpenseGroupsFileData> {
  const token = await getServerAccessToken();
  const all = await fetchGroupsPaged(token, 'ALL');
  const payload: ExpenseGroupsFileData = { retrievedAt: new Date().toISOString(), count: all.length, groups: all };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
}

/**
 * Fetch every page of group configurations for one `user` scope.
 * `user` may be a login ID (that user's groups) or the literal `ALL` (the
 * whole entity's groups). Follows `NextPage` until exhausted.
 */
async function fetchGroupsPaged(token: string, user: string): Promise<ExpenseGroupConfiguration[]> {
  let url: string | null =
    `${baseUrl()}/api/v3.0/expense/expensegroupconfigurations?user=${encodeURIComponent(user)}&limit=${PAGE_LIMIT}`;
  const all: ExpenseGroupConfiguration[] = [];
  const seenUrls = new Set<string>(); // guard against a NextPage loop

  while (url) {
    if (seenUrls.has(url)) break; // defensive: stop if the API repeats a page URL
    seenUrls.add(url);
    const data = await fetchPage(url, token);
    all.push(...(data.Items ?? []));
    const next = data.NextPage ?? null;
    // NextPage may be relative; resolve against baseUrl.
    url = next ? (next.startsWith('http') ? next : `${baseUrl()}${next}`) : null;
  }
  return all;
}

/** Read the local snapshot, or null if none exists yet. */
export function readExpenseGroupsFile(): ExpenseGroupsFileData | null {
  if (!existsSync(DATA_FILE)) return null;
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8')) as ExpenseGroupsFileData;
  } catch {
    return null;
  }
}

/** Ensure a snapshot exists: read it, or fetch it if missing. */
export async function ensureExpenseGroupsData(): Promise<ExpenseGroupsFileData> {
  const existing = readExpenseGroupsFile();
  if (existing) return existing;
  return fetchAllExpenseGroups();
}

/* ── Per-user lookup with local cache ───────────────────────────────── */

/** Snapshot for one user's group configuration(s). */
export interface UserExpenseGroupsData {
  loginId: string;
  retrievedAt: string;
  count: number;
  groups: ExpenseGroupConfiguration[];
}

/** Thrown when Concur rejects the login ID (HTTP 400 "Invalid User"). */
export class InvalidUserError extends Error {
  constructor(loginId: string, detail?: string) {
    super(`No expense group configuration found for login ID "${loginId}"${detail ? `: ${detail}` : ''}`);
    this.name = 'InvalidUserError';
  }
}

/** Filesystem-safe cache filename for a login ID. */
function userFilePath(loginId: string): string {
  return join(USERS_DIR, `${encodeURIComponent(loginId)}.json`);
}

/** Read a user's cached configuration, or null if none. */
export function readUserExpenseGroups(loginId: string): UserExpenseGroupsData | null {
  const file = userFilePath(loginId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as UserExpenseGroupsData;
  } catch {
    return null;
  }
}

/**
 * Retrieve the expense group configuration for one user login ID.
 * Serves from the per-user cache when present (unless `refresh`), otherwise
 * fetches from Concur (following pagination) and caches the result locally
 * under `data/expense-groups-by-user/{loginId}.json` for later retrieval.
 */
export async function getUserExpenseGroups(loginId: string, refresh = false): Promise<UserExpenseGroupsData> {
  const id = loginId.trim();
  if (!id) throw new InvalidUserError(loginId, 'empty login ID');
  if (!refresh) {
    const cached = readUserExpenseGroups(id);
    if (cached) return cached;
  }

  const token = await getServerAccessToken();
  let groups: ExpenseGroupConfiguration[];
  try {
    groups = await fetchGroupsPaged(token, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Concur answers an unknown login ID with HTTP 400 "Invalid User".
    if (/\b400\b/.test(msg) || /invalid user/i.test(msg)) throw new InvalidUserError(id);
    throw err;
  }

  const payload: UserExpenseGroupsData = { loginId: id, retrievedAt: new Date().toISOString(), count: groups.length, groups };
  mkdirSync(USERS_DIR, { recursive: true });
  writeFileSync(userFilePath(id), JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
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

/** GET /api/local/expense-groups — return the local snapshot (fetch if absent). */
export async function handleGetExpenseGroups(res: ServerResponse): Promise<void> {
  try {
    const data = await ensureExpenseGroupsData();
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /api/local/expense-groups/refresh — force a fresh retrieval from Concur. */
export async function handleRefreshExpenseGroups(res: ServerResponse): Promise<void> {
  try {
    const data = await fetchAllExpenseGroups();
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * GET /api/local/expense-groups/user/{loginId}[?refresh=1]
 * Return the expense group configuration for one user login ID, from the
 * per-user cache when available, else fetched from Concur and cached locally.
 */
export async function handleGetUserExpenseGroups(res: ServerResponse, loginId: string, rawQuery: string): Promise<void> {
  try {
    const refresh = new URLSearchParams(rawQuery).get('refresh') === '1';
    const data = await getUserExpenseGroups(loginId, refresh);
    sendJson(res, 200, data);
  } catch (err) {
    if (err instanceof InvalidUserError) {
      sendJson(res, 404, { error: err.message });
      return;
    }
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
