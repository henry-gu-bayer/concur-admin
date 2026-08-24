import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getServerAccessToken } from './concurAuth';
import { logApiCall } from './logger';
import { createEntityRegistry } from './entities';
import { upstreamFetch } from './upstreamFetch';

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

const PAGE_LIMIT = 10; // v3 caps `limit` at 10 (HTTP 400 above that)

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

function dataDirectory(entityId: string): string {
  return join(process.env.DATA_DIR ?? 'data', entityId);
}

function baseUrl(entityId: string): string {
  return createEntityRegistry().require(entityId).baseUrl;
}

function expenseGroupsFilePath(entityId: string): string {
  return join(dataDirectory(entityId), 'expense-groups.json');
}

function usersDirectory(entityId: string): string {
  return join(dataDirectory(entityId), 'expense-groups-by-user');
}

async function fetchPage(entityId: string, url: string, token: string): Promise<EgcPage> {
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
    throw new Error(`Expense group config retrieval failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as EgcPage;
}

/** Fetch ALL expense group configurations across every page (follow NextPage). */
export async function fetchAllExpenseGroups(entityId: string): Promise<ExpenseGroupsFileData> {
  const token = await getServerAccessToken(entityId);
  const all = await fetchGroupsPaged(entityId, token, 'ALL');
  const payload: ExpenseGroupsFileData = { retrievedAt: new Date().toISOString(), count: all.length, groups: all };
  mkdirSync(dataDirectory(entityId), { recursive: true });
  writeFileSync(expenseGroupsFilePath(entityId), JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
}

/**
 * Fetch every page of group configurations for one `user` scope.
 * `user` may be a login ID (that user's groups) or the literal `ALL` (the
 * whole entity's groups). Follows `NextPage` until exhausted.
 */
async function fetchGroupsPaged(entityId: string, token: string, user: string): Promise<ExpenseGroupConfiguration[]> {
  let url: string | null =
    `${baseUrl(entityId)}/api/v3.0/expense/expensegroupconfigurations?user=${encodeURIComponent(user)}&limit=${PAGE_LIMIT}`;
  const all: ExpenseGroupConfiguration[] = [];
  const seenUrls = new Set<string>(); // guard against a NextPage loop

  while (url) {
    if (seenUrls.has(url)) break; // defensive: stop if the API repeats a page URL
    seenUrls.add(url);
    const data = await fetchPage(entityId, url, token);
    all.push(...(data.Items ?? []));
    const next = data.NextPage ?? null;
    // NextPage may be relative; resolve against baseUrl.
    url = next ? (next.startsWith('http') ? next : `${baseUrl(entityId)}${next}`) : null;
  }
  return all;
}

/** Read the local snapshot, or null if none exists yet. */
export function readExpenseGroupsFile(entityId: string): ExpenseGroupsFileData | null {
  const file = expenseGroupsFilePath(entityId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as ExpenseGroupsFileData;
  } catch {
    return null;
  }
}

/** Ensure a snapshot exists: read it, or fetch it if missing. */
export async function ensureExpenseGroupsData(entityId: string): Promise<ExpenseGroupsFileData> {
  const existing = readExpenseGroupsFile(entityId);
  if (existing) return existing;
  return fetchAllExpenseGroups(entityId);
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
function userFilePath(entityId: string, loginId: string): string {
  return join(usersDirectory(entityId), `${encodeURIComponent(loginId)}.json`);
}

/** Read a user's cached configuration, or null if none. */
export function readUserExpenseGroups(entityId: string, loginId: string): UserExpenseGroupsData | null {
  const file = userFilePath(entityId, loginId);
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
export async function getUserExpenseGroups(entityId: string, loginId: string, refresh = false): Promise<UserExpenseGroupsData> {
  const id = loginId.trim();
  if (!id) throw new InvalidUserError(loginId, 'empty login ID');
  if (!refresh) {
    const cached = readUserExpenseGroups(entityId, id);
    if (cached) return cached;
  }

  const token = await getServerAccessToken(entityId);
  let groups: ExpenseGroupConfiguration[];
  try {
    groups = await fetchGroupsPaged(entityId, token, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Concur answers an unknown login ID with HTTP 400 "Invalid User".
    if (/\b400\b/.test(msg) || /invalid user/i.test(msg)) throw new InvalidUserError(id);
    throw err;
  }

  const payload: UserExpenseGroupsData = { loginId: id, retrievedAt: new Date().toISOString(), count: groups.length, groups };
  mkdirSync(usersDirectory(entityId), { recursive: true });
  writeFileSync(userFilePath(entityId, id), JSON.stringify(payload, null, 2), 'utf-8');
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
export async function handleGetExpenseGroups(res: ServerResponse, entityId: string): Promise<void> {
  try {
    const data = await ensureExpenseGroupsData(entityId);
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /api/local/expense-groups/refresh — force a fresh retrieval from Concur. */
export async function handleRefreshExpenseGroups(res: ServerResponse, entityId: string): Promise<void> {
  try {
    const data = await fetchAllExpenseGroups(entityId);
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
export async function handleGetUserExpenseGroups(res: ServerResponse, entityId: string, loginId: string, rawQuery: string): Promise<void> {
  try {
    const refresh = new URLSearchParams(rawQuery).get('refresh') === '1';
    const data = await getUserExpenseGroups(entityId, loginId, refresh);
    sendJson(res, 200, data);
  } catch (err) {
    if (err instanceof InvalidUserError) {
      sendJson(res, 404, { error: err.message });
      return;
    }
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
