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
  let url: string | null = `${baseUrl()}/api/v3.0/expense/expensegroupconfigurations?limit=${PAGE_LIMIT}`;
  const all: ExpenseGroupConfiguration[] = [];
  const seenUrls = new Set<string>(); // guard against a NextPage loop
  let page = 0;

  while (url) {
    if (seenUrls.has(url)) break; // defensive: stop if the API repeats a page URL
    seenUrls.add(url);
    page += 1;
    const data = await fetchPage(url, token);
    all.push(...(data.Items ?? []));
    const next = data.NextPage ?? null;
    // NextPage may be relative; resolve against baseUrl.
    url = next ? (next.startsWith('http') ? next : `${baseUrl()}${next}`) : null;
  }

  const payload: ExpenseGroupsFileData = { retrievedAt: new Date().toISOString(), count: all.length, groups: all };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
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
