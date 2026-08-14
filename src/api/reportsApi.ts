import { concurGet } from './concurFetch';
import type {
  AttendeeV4,
  EntriesResponse,
  EntriesResult,
  ExpenseEntry,
  ExpenseAttendeeAssociationsV4,
  ExpenseAttendeeV4,
  ExpenseReport,
  ExpenseReportV4,
  ExpenseV4,
  IdentityV4SearchResponse,
  ReportCommentV4,
  ReportExceptionV4,
  ReportQuery,
  ReportSearchResult,
  ReportsResponse,
} from '../types';

const REPORTS_PATH = '/api/v3.0/expense/reports';
const ENTRIES_PATH = '/api/v3.0/expense/entries';
const IDENTITY_V4_USERS_PATH = '/profile/identity/v4/Users';
const REPORTS_V4_PATH = '/expensereports/v4/users';
const REPORTS_V4_SYSTEM_PATH = '/expensereports/v4/reports';
const ATTENDEES_V4_PATH = '/v4/attendees';
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
  const expenseType = query.expenseTypeCode?.trim();
  if (approval) params.set('approvalStatusCode', approval);
  if (payment) params.set('paymentStatusCode', payment);
  if (country) params.set('countryCode', country);
  if (expenseType) params.set('expenseTypeCode', expenseType);
  // Reports v3 booleans use the JSON-style true/false format.
  if (query.hasImages !== undefined) params.set('hasImages', String(query.hasImages));
  if (query.hasAttendees !== undefined) params.set('hasAttendees', String(query.hasAttendees));
  for (const [key, param] of DATE_PARAMS) {
    const value = (query[key] as string | undefined)?.trim();
    if (value) params.set(param, value);
  }
  const hasDate = DATE_PARAMS.some(([key]) => Boolean((query[key] as string | undefined)?.trim()));
  if (!loginId && !approval && !payment && !country && !expenseType
    && query.hasImages === undefined && query.hasAttendees === undefined && !hasDate) {
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

function escapeScimFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Resolve the v4 user UUID from the Reports v3 owner login ID via Identity v4. */
export async function resolveIdentityUserIdV4(loginId: string): Promise<string> {
  const login = loginId.trim();
  if (!login) throw new Error('A report owner login ID is required for Reports v4');
  const params = new URLSearchParams({
    filter: `userName eq "${escapeScimFilterValue(login)}"`,
    attributes: 'id,userName',
    count: '2',
  });
  const response = await concurGet<IdentityV4SearchResponse>(`${IDENTITY_V4_USERS_PATH}?${params.toString()}`);
  const users = response.Resources ?? [];
  const exact = users.find((user) => user.userName?.toLowerCase() === login.toLowerCase()) ?? (users.length === 1 ? users[0] : undefined);
  const userId = exact?.id?.trim();
  if (!userId) throw new Error(`Identity v4 did not return a user ID for ${login}`);
  return userId;
}

/** Retrieve a report header through Reports v4 using TRAVELER context. */
export async function fetchReportV4(reportId: string, loginId: string): Promise<{ userId: string; report: ExpenseReportV4 }> {
  const id = reportId.trim();
  if (!id) throw new Error('A report ID is required for Reports v4');
  const userId = await resolveIdentityUserIdV4(loginId);
  const path = `${REPORTS_V4_PATH}/${encodeURIComponent(userId)}/context/TRAVELER/reports/${encodeURIComponent(id)}`;
  const report = await concurGet<ExpenseReportV4>(path);
  return { userId, report };
}

/** Retrieve report-header exceptions only, reusing the Identity v4 user UUID. */
export async function fetchReportExceptionsV4(reportId: string, userId: string): Promise<ReportExceptionV4[]> {
  const id = reportId.trim();
  if (!id) throw new Error('A report ID is required for Exceptions v4');
  const user = userId.trim();
  if (!user) throw new Error('A user ID is required for Exceptions v4');
  const params = new URLSearchParams({ excludeExpenses: 'true' });
  return concurGet<ReportExceptionV4[]>(
    `${REPORTS_V4_PATH}/${encodeURIComponent(user)}/context/TRAVELER/reports/${encodeURIComponent(id)}/exceptions?${params.toString()}`,
  );
}

/** Retrieve only report-header comments through the Comments v4 system-user endpoint. */
export async function fetchReportCommentsV4(reportId: string): Promise<ReportCommentV4[]> {
  const id = reportId.trim();
  if (!id) throw new Error('A report ID is required for Comments v4');
  const params = new URLSearchParams({ includeAllComments: 'false' });
  return concurGet<ReportCommentV4[]>(
    `${REPORTS_V4_SYSTEM_PATH}/${encodeURIComponent(id)}/comments?${params.toString()}`,
  );
}

/**
 * Retrieve every expense on one report through Expenses v4 using TRAVELER
 * context. The userID is the owner's Identity v4 UUID — the same one resolved
 * for the Reports v4 header call.
 */
export async function fetchReportExpensesV4(reportId: string, userId: string): Promise<ExpenseV4[]> {
  const id = reportId.trim();
  if (!id) throw new Error('A report ID is required for Expenses v4');
  const user = userId.trim();
  if (!user) throw new Error('A user ID is required for Expenses v4');
  const result = await concurGet<ExpenseV4[] | { expenses?: ExpenseV4[]; Items?: ExpenseV4[] }>(
    `${REPORTS_V4_PATH}/${encodeURIComponent(user)}/context/TRAVELER/reports/${encodeURIComponent(id)}/expenses`,
  );
  if (Array.isArray(result)) return result;
  return result.expenses ?? result.Items ?? [];
}

/** Retrieve exceptions for one expense through the Exceptions v4 system-user endpoint. */
export async function fetchExpenseExceptionsV4(reportId: string, expenseId: string): Promise<ReportExceptionV4[]> {
  const report = reportId.trim();
  if (!report) throw new Error('A report ID is required for Exceptions v4');
  const expense = expenseId.trim();
  if (!expense) throw new Error('An expense ID is required for Exceptions v4');
  const params = new URLSearchParams({ expenseId: expense });
  return concurGet<ReportExceptionV4[]>(
    `${REPORTS_V4_SYSTEM_PATH}/${encodeURIComponent(report)}/exceptions?${params.toString()}`,
  );
}

/** Retrieve comments for one expense through the Comments v4 system-user endpoint. */
export async function fetchExpenseCommentsV4(reportId: string, expenseId: string): Promise<ReportCommentV4[]> {
  const report = reportId.trim();
  if (!report) throw new Error('A report ID is required for Comments v4');
  const expense = expenseId.trim();
  if (!expense) throw new Error('An expense ID is required for Comments v4');
  const params = new URLSearchParams({ expenseId: expense, includeAllComments: 'true' });
  return concurGet<ReportCommentV4[]>(
    `${REPORTS_V4_SYSTEM_PATH}/${encodeURIComponent(report)}/comments?${params.toString()}`,
  );
}

/** Retrieve attendee associations for one expense through the system-user endpoint. */
export async function fetchExpenseAttendeeAssociationsV4(
  reportId: string,
  expenseId: string,
): Promise<ExpenseAttendeeAssociationsV4> {
  const report = reportId.trim();
  if (!report) throw new Error('A report ID is required for Attendee Associations v4');
  const expense = expenseId.trim();
  if (!expense) throw new Error('An expense ID is required for Attendee Associations v4');
  return concurGet<ExpenseAttendeeAssociationsV4>(
    `${REPORTS_V4_SYSTEM_PATH}/${encodeURIComponent(report)}/expenses/${encodeURIComponent(expense)}/attendees`,
  );
}

/** Retrieve attendee records in batches of at most 10 IDs, as required by Attendees v4. */
export async function fetchAttendeesV4ByIds(attendeeIds: string[]): Promise<AttendeeV4[]> {
  const ids = [...new Set(attendeeIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += 10) batches.push(ids.slice(index, index + 10));
  const responses = await Promise.all(batches.map(async (batch) => {
    const params = new URLSearchParams({ id: batch.join(',') });
    const response = await concurGet<{ items?: AttendeeV4[]; Items?: AttendeeV4[] }>(
      `${ATTENDEES_V4_PATH}?${params.toString()}`,
    );
    return response.items ?? response.Items ?? [];
  }));
  return responses.flat();
}

/** Resolve an expense's attendee associations into complete Attendees v4 records. */
export async function fetchExpenseAttendeesV4(reportId: string, expenseId: string): Promise<{
  attendees: ExpenseAttendeeV4[];
  noShowAttendeeCount: number;
}> {
  const associations = await fetchExpenseAttendeeAssociationsV4(reportId, expenseId);
  const associationItems = associations.expenseAttendeeList ?? [];
  const attendeeRecords = await fetchAttendeesV4ByIds(
    associationItems.flatMap((association) => association.attendeeId?.trim() ? [association.attendeeId.trim()] : []),
  );
  const attendeeById = new Map(attendeeRecords.flatMap((attendee) => attendee.id?.trim()
    ? [[attendee.id.trim().toLowerCase(), attendee] as const]
    : []));
  const attendees = associationItems.flatMap((association) => {
    const id = association.attendeeId?.trim();
    if (!id) return [];
    return [{ ...(attendeeById.get(id.toLowerCase()) ?? { id }), association }];
  });
  return { attendees, noShowAttendeeCount: associations.noShowAttendeeCount ?? 0 };
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
