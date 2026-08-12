import { concurGet } from './concurFetch';
import type {
  EntriesResponse,
  EntriesResult,
  ExpenseEntry,
  ExpenseReport,
  ReportQuery,
  ReportSearchResult,
  ReportsResponse,
} from '../types';

const REPORTS_PATH = '/api/v3.0/expense/reports';
const ENTRIES_PATH = '/api/v3.0/expense/entries';
export const PAGE_LIMIT = 100;
const MAX_PAGES = 100; // safety valve: never follow more than 100 NextPage links

const DATE_PARAMS: [keyof ReportQuery, string][] = [
  ['createdAfter', 'createDateAfter'],
  ['createdBefore', 'createDateBefore'],
  ['submittedAfter', 'submitDateAfter'],
  ['submittedBefore', 'submitDateBefore'],
  ['paidAfter', 'paidDateAfter'],
  ['paidBefore', 'paidDateBefore'],
];

/**
 * Builds the Reports v3 request path with the combinable filters.
 * At least one criterion is required — an unfiltered crawl of all company
 * reports is almost never intended. Without a login ID the search spans
 * all report owners (user=ALL).
 */
export function buildReportsPath(query: ReportQuery): string {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_LIMIT));
  const loginId = query.loginId?.trim();
  params.set('user', loginId || 'ALL');
  const approval = query.approvalStatusCode?.trim();
  const payment = query.paymentStatusCode?.trim();
  const country = query.countryCode?.trim().toUpperCase();
  if (approval) params.set('approvalStatusCode', approval);
  if (payment) params.set('paymentStatusCode', payment);
  if (country) params.set('countryCode', country);
  for (const [key, param] of DATE_PARAMS) {
    const value = (query[key] as string | undefined)?.trim();
    if (value) params.set(param, value);
  }
  const hasDate = DATE_PARAMS.some(([key]) => Boolean((query[key] as string | undefined)?.trim()));
  if (!loginId && !approval && !payment && !country && !hasDate) {
    throw new Error('At least one search criterion is required');
  }
  return `${REPORTS_PATH}?${params.toString()}`;
}

/**
 * Builds the Entries v3 request path for one report. The owner login ID is
 * passed as `user` (requires the Web Services Admin role server-side).
 */
export function buildEntriesPath(reportId: string, loginId?: string): string {
  const id = reportId.trim();
  if (!id) throw new Error('A report ID is required to fetch entries');
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_LIMIT));
  params.set('reportID', id);
  const user = loginId?.trim();
  if (user) params.set('user', user);
  return `${ENTRIES_PATH}?${params.toString()}`;
}

/** NextPage comes back as an absolute URI; keep path + query for the proxy. */
function toRelativePath(uri: string): string {
  const url = new URL(uri);
  return `${url.pathname}${url.search}`;
}

/**
 * Fetches one report by ID via GET /api/v3.0/expense/reports/{id}?user=… —
 * the report owner's login ID is required to identify the report context. A
 * ReportsExceptionStatus comes back as HTTP 200 with an Error payload, so it
 * is mapped to a thrown error here.
 */
export async function fetchReportById(reportId: string, loginId: string): Promise<ExpenseReport> {
  const id = reportId.trim();
  if (!id) throw new Error('A report ID is required');
  const user = loginId.trim();
  if (!user) throw new Error('A login ID is required to look up a report by ID');
  const params = new URLSearchParams({ user });
  const res = await concurGet<ExpenseReport & { Error?: { Message?: string } }>(
    `${REPORTS_PATH}/${encodeURIComponent(id)}?${params.toString()}`,
  );
  if (res.Error) throw new Error(res.Error.Message?.trim() || 'Concur returned an error for this report ID');
  return res;
}

async function fetchReportsPage(path: string): Promise<{ items: ExpenseReport[]; nextPath: string | null }> {
  const res = await concurGet<ReportsResponse>(path);
  const next = res.NextPage?.trim();
  return { items: res.Items ?? [], nextPath: next ? toRelativePath(next) : null };
}

/** Fetches the first page only; `hasMore` signals that the server holds further pages. */
export async function searchReports(query: ReportQuery): Promise<ReportSearchResult> {
  const page = await fetchReportsPage(buildReportsPath(query));
  return { reports: page.items, hasMore: page.nextPath !== null };
}

/** Fetches every page, following NextPage links (capped by MAX_PAGES). */
export async function fetchAllReports(query: ReportQuery): Promise<ReportSearchResult> {
  let path: string | null = buildReportsPath(query);
  const reports: ExpenseReport[] = [];
  let pages = 0;
  while (path && pages < MAX_PAGES) {
    const page = await fetchReportsPage(path);
    reports.push(...page.items);
    path = page.nextPath;
    pages += 1;
  }
  return { reports, hasMore: path !== null };
}

/** Fetches every entry of a report, following NextPage links (capped by MAX_PAGES). */
export async function fetchReportEntries(reportId: string, loginId?: string): Promise<EntriesResult> {
  let path: string | null = buildEntriesPath(reportId, loginId);
  const entries: ExpenseEntry[] = [];
  let pages = 0;
  while (path && pages < MAX_PAGES) {
    const res: EntriesResponse = await concurGet<EntriesResponse>(path);
    entries.push(...(res.Items ?? []));
    const next: string | undefined = res.NextPage?.trim();
    path = next ? toRelativePath(next) : null;
    pages += 1;
  }
  return { entries, hasMore: path !== null };
}
