/**
 * One-time export: pull every available detail for a fixed list of expense
 * reports out of Concur (US production) and write it as JSON for offline
 * analysis of a posting issue.
 *
 * Why it runs against the local proxy: the OAuth refresh-token exchange needs
 * CLIENT_SECRET/REFRESH_TOKEN, which must stay server-side. Start the dev
 * server (`npm run dev`), then run this script; it only talks to
 * `http://127.0.0.1:PORT/api/concur`, and the proxy attaches the Bearer token.
 * The proxy also writes every upstream call to logs/<entity>/api.log.
 *
 * Usage:
 *   node scripts/export-report-details.mjs --ids scripts/report-ids.txt \
 *     [--base http://127.0.0.1:5566] [--entity us-production] [--out data/export]
 *
 * Output:
 *   <out>/reports/<REPORT_ID>.json   one self-contained file per report
 *   <out>/reports-all.json           every report in one array
 *   <out>/export-manifest.json       counts, errors, and timings
 *
 * Design notes:
 *  - The report header is fetched three ways on purpose. Reports v3 returns
 *    typed Custom/OrgUnit objects (with ListItemID), Reports v4 adds fields v3
 *    never exposes (employee, receiptStatus, reportNumber, …), and Report v2
 *    is the only endpoint that resolves the owner login without a user context
 *    — and it carries the legacy entry IDs used for posting reconciliation.
 *  - Entries v3 and Expenses v4 are both fetched and linked on the expense ID
 *    (v3 `ExpenseID` === v4 `expenseId`). v3 carries the full numeric custom
 *    field set; v4 is the only source of custom field data on the expense, but
 *    only from the single-expense endpoint — the expense *list* omits it.
 *  - Comments v4 and Exceptions v4 ignore their `expenseId` filter and always
 *    return the whole report's rows, so both are fetched once and partitioned
 *    locally. Rows with a null expenseId are report-header rows.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const options = {
    ids: 'scripts/report-ids.txt',
    base: `http://127.0.0.1:${process.env.PORT ?? 5173}`,
    entity: 'us-production',
    out: 'data/export',
    concurrency: 4,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith('--')) continue;
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    index += 1;
    const key = flag.slice(2);
    if (key === 'concurrency') options.concurrency = Math.max(1, Number(value) || 1);
    else if (key in options) options[key] = value;
    else throw new Error(`Unknown option ${flag}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const headers = { 'X-Concur-Entity': options.entity, Accept: 'application/json' };
const API = `${options.base.replace(/\/+$/, '')}/api/concur`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * GET one Concur path through the local proxy. Retries 429/5xx and transport
 * errors with exponential backoff; every other status is returned to the
 * caller so a partial export can record *why* a section is missing.
 */
async function get(path, { retries = 4 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${API}${path}`, { headers });
      const text = await response.text();
      if (response.ok) {
        try {
          return { ok: true, status: response.status, body: JSON.parse(text) };
        } catch {
          return { ok: false, status: response.status, error: `Non-JSON response: ${text.slice(0, 200)}` };
        }
      }
      lastError = `HTTP ${response.status} — ${text.slice(0, 300)}`;
      if (response.status !== 429 && response.status < 500) return { ok: false, status: response.status, error: lastError };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }
  return { ok: false, status: 0, error: lastError };
}

/** Fetch a section into `container`, capturing failure instead of aborting the report. */
async function section(container, name, path, errors) {
  const result = await get(path);
  if (result.ok) {
    container[name] = result.body;
    return result.body;
  }
  errors.push({ section: name, path, status: result.status, error: result.error });
  return null;
}

/** Follow v3 NextPage links, keeping path + query for the proxy. */
async function getPaged(path) {
  const items = [];
  let next = path;
  let pages = 0;
  while (next && pages < 100) {
    const result = await get(next);
    if (!result.ok) return { ok: false, items, error: result.error };
    items.push(...(result.body?.Items ?? []));
    const nextPage = result.body?.NextPage?.trim();
    next = nextPage ? `${new URL(nextPage).pathname}${new URL(nextPage).search}` : null;
    pages += 1;
  }
  return { ok: true, items };
}

/* ── Per-run caches: 96 owners over 116 reports ─────────────────────── */

const userIdByLogin = new Map();
const profilesByUserId = new Map();
const attendeeById = new Map();

/** Resolve the Identity v4 UUID that Reports v4 / Spend / Travel all key on. */
async function resolveUserId(loginId, errors) {
  const key = loginId.trim().toUpperCase();
  if (userIdByLogin.has(key)) return userIdByLogin.get(key);
  const filter = encodeURIComponent(`userName eq "${loginId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  const result = await get(`/profile/identity/v4/Users?filter=${filter}&attributes=id,userName`);
  const userId = result.ok
    ? (result.body?.Resources ?? []).find((user) => user.userName?.toUpperCase() === key)?.id
      ?? (result.body?.Resources?.length === 1 ? result.body.Resources[0].id : undefined)
    : undefined;
  if (!userId) {
    errors.push({ section: 'identity.userId', detail: result.ok ? 'No Identity v4 match' : result.error });
    return null;
  }
  userIdByLogin.set(key, userId);
  return userId;
}

/** Employee identity + spend + travel profiles, cached per user UUID. */
async function getEmployeeProfiles(userId, errors) {
  if (profilesByUserId.has(userId)) return profilesByUserId.get(userId);
  const [identity, spend, travel] = await Promise.all([
    get(`/profile/identity/v4/Users/${encodeURIComponent(userId)}`),
    get(`/profile/spend/v4.1/Users/${encodeURIComponent(userId)}`),
    get(`/travel/v4/Users/${encodeURIComponent(userId)}`),
  ]);
  // Identity v4.1 keys the extension the same way but omits it from some
  // tenants; read whichever schema the response actually carries.
  const identityBody = identity.ok ? identity.body : null;
  const spendBody = spend.ok ? spend.body : null;
  const travelBody = travel.ok ? travel.body : null;
  if (!identity.ok) errors.push({ section: 'employee.identity', detail: identity.error });
  if (!spend.ok) errors.push({ section: 'employee.spend', detail: spend.error });
  if (!travel.ok) errors.push({ section: 'employee.travel', detail: travel.error });

  const enterprise = identityBody?.['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] ?? {};
  const spendExtension = spendBody?.['urn:ietf:params:scim:schemas:extension:spend:2.0:User'] ?? {};
  const travelExtension = travelBody?.['urn:ietf:params:scim:schemas:extension:travel:2.0:User'] ?? {};
  const payroll = spendBody?.['urn:ietf:params:scim:schemas:extension:enterprise:2.0:Payroll'] ?? {};

  const profiles = {
    userId,
    // Flat summary so downstream analysis does not need to know the SCIM shape.
    employeeId: enterprise.employeeNumber ?? null,
    loginId: identityBody?.userName ?? null,
    displayName: identityBody?.displayName ?? null,
    name: identityBody?.name ?? null,
    active: identityBody?.active ?? null,
    emails: identityBody?.emails ?? null,
    employeeCustomFields: {
      // The posting-side identifiers come from these two extensions.
      spendCustomData: spendExtension.customData ?? [],
      travelCustomFields: travelExtension.customFields ?? [],
      payrollEnterprise: payroll,
    },
    raw: { identity: identityBody, spend: spendBody, travel: travelBody },
  };
  profilesByUserId.set(userId, profiles);
  return profiles;
}

/** Attendee records, cached across reports (the same attendee repeats). */
async function getAttendees(attendeeIds) {
  const missing = [...new Set(attendeeIds.filter(Boolean))].filter((id) => !attendeeById.has(id));
  for (let index = 0; index < missing.length; index += 10) {
    const batch = missing.slice(index, index + 10);
    const result = await get(`/v4/attendees?id=${batch.map(encodeURIComponent).join(',')}`);
    if (!result.ok) {
      for (const id of batch) attendeeById.set(id, { id, lookupError: result.error });
      continue;
    }
    for (const attendee of result.body?.items ?? result.body?.Items ?? []) {
      if (attendee.id) attendeeById.set(attendee.id, attendee);
    }
    for (const id of batch) if (!attendeeById.has(id)) attendeeById.set(id, { id, lookupError: 'Attendee v4 returned no record' });
  }
  return new Map(attendeeIds.filter(Boolean).map((id) => [id, attendeeById.get(id)]));
}

/* ── One report ─────────────────────────────────────────────────────── */

async function exportReport(reportId, index, total) {
  const startedAt = Date.now();
  const errors = [];
  const report = {
    reportId,
    exportIndex: index,
    exportedAt: new Date().toISOString(),
    entityId: options.entity,
    errors,
    header: {},
    entries: [],
    employee: null,
  };

  // 1. Report v2 — owner login + legacy entry IDs, no user context required.
  const v2 = await section(report.header, 'reportV2', `/api/expense/expensereport/v2.0/report/${encodeURIComponent(reportId)}`, errors);
  const loginId = v2?.UserLoginID?.trim();
  if (!loginId) {
    errors.push({ section: 'owner', detail: 'Report v2 did not return a UserLoginID; report skipped' });
    report.durationMs = Date.now() - startedAt;
    return report;
  }
  report.loginId = loginId;
  report.ownerName = v2.EmployeeName ?? null;

  // 2. Reports v3 header — typed Custom/OrgUnit values.
  await section(report.header, 'reportV3', `/api/v3.0/expense/reports/${encodeURIComponent(reportId)}?user=${encodeURIComponent(loginId)}`, errors);

  // 3. Resolve the v4 user UUID, then the v4 header and header-level children.
  const userId = await resolveUserId(loginId, errors);
  report.userId = userId ?? null;
  let expenses = [];
  if (userId) {
    const encodedUser = encodeURIComponent(userId);
    const encodedReport = encodeURIComponent(reportId);
    await section(report.header, 'reportV4', `/expensereports/v4/users/${encodedUser}/context/TRAVELER/reports/${encodedReport}`, errors);
    await section(report.header, 'comments', `/expensereports/v4/reports/${encodedReport}/comments?includeAllComments=true`, errors);
    await section(report.header, 'exceptions', `/expensereports/v4/reports/${encodedReport}/exceptions`, errors);
    await section(report.header, 'formFields', `/expensereports/v4/reports/${encodedReport}/formFields`, errors);

    // 4. Expense list: the list omits customData, so each expense is fetched
    //    individually below; the list is still the canonical ID set.
    const expenseList = await section(report.header, 'expenses', `/expensereports/v4/users/${encodedUser}/context/TRAVELER/reports/${encodedReport}/expenses`, errors);
    expenses = Array.isArray(expenseList) ? expenseList : [];
  }

  // 5. Entries v3 — the full numeric custom/OrgUnit field set per entry.
  const entriesV3 = await getPaged(`/api/v3.0/expense/entries?limit=100&reportID=${encodeURIComponent(reportId)}&user=${encodeURIComponent(loginId)}`);
  if (!entriesV3.ok) errors.push({ section: 'entriesV3', detail: entriesV3.error });
  const entryByExpenseId = new Map(entriesV3.items.flatMap((entry) => entry.ExpenseID ? [[entry.ExpenseID, entry]] : []));

  // 6. Partition report-level rows. Comments v4 and Exceptions v4 ignore the
  //    `expenseId` filter and always return every row on the report.
  const comments = Array.isArray(report.header.comments) ? report.header.comments : [];
  const exceptions = Array.isArray(report.header.exceptions) ? report.header.exceptions : [];
  report.header.comments = comments.filter((comment) => !comment.expenseId);
  report.header.exceptions = exceptions.filter((exception) => !exception.expenseId);

  // 7. Expense IDs: the v4 list first, then any v3-only entry so nothing is lost.
  const seen = new Set(expenses.map((expense) => expense.expenseId).filter(Boolean));
  const expenseIds = [
    ...expenses.map((expense) => expense.expenseId).filter(Boolean),
    // An entry present in v3 but missing from the v4 list must not be dropped.
    ...entriesV3.items.map((entry) => entry.ExpenseID).filter((id) => id && !seen.has(id)),
  ];

  for (const expenseId of expenseIds) {
    const encodedReport = encodeURIComponent(reportId);
    const encodedExpense = encodeURIComponent(expenseId);
    const entry = {
      expenseId,
      entryV3: entryByExpenseId.get(expenseId) ?? null,
      expenseV4: expenses.find((candidate) => candidate.expenseId === expenseId) ?? null,
      expenseV4Detail: null,
      formFields: null,
      comments: comments.filter((comment) => comment.expenseId === expenseId),
      exceptions: exceptions.filter((exception) => exception.expenseId === expenseId),
      attendees: null,
    };

    // Single-expense GET is the only source of expense customData. Unlike the
    // sibling comment/exception/attendee/formField routes it lives under the
    // TRAVELER user context, not the system-user `/reports/{id}` path.
    if (userId) {
      const detail = await get(
        `/expensereports/v4/users/${encodeURIComponent(userId)}/context/TRAVELER/reports/${encodedReport}/expenses/${encodedExpense}`,
      );
      if (detail.ok) entry.expenseV4Detail = detail.body;
      else errors.push({ section: `expense.${expenseId}.detail`, detail: detail.error });
    } else {
      errors.push({ section: `expense.${expenseId}.detail`, detail: 'Skipped: no user UUID to build the TRAVELER context path' });
    }

    const fields = await get(`/expensereports/v4/reports/${encodedReport}/expenses/${encodedExpense}/formFields`);
    if (fields.ok) entry.formFields = fields.body;
    else errors.push({ section: `expense.${expenseId}.formFields`, detail: fields.error });

    const associations = await get(`/expensereports/v4/reports/${encodedReport}/expenses/${encodedExpense}/attendees`);
    if (associations.ok) {
      const list = associations.body?.expenseAttendeeList ?? [];
      const records = await getAttendees(list.map((item) => item.attendeeId));
      entry.attendees = {
        noShowAttendeeCount: associations.body?.noShowAttendeeCount ?? 0,
        items: list.map((association) => ({
          association,
          attendee: association.attendeeId ? records.get(association.attendeeId) ?? null : null,
        })),
      };
    } else {
      errors.push({ section: `expense.${expenseId}.attendees`, detail: associations.error });
    }

    report.entries.push(entry);
  }

  // 8. Employee record (identity + names + employee ID + custom fields).
  if (userId) report.employee = await getEmployeeProfiles(userId, errors);

  report.counts = {
    entriesV3: entriesV3.items.length,
    expensesV4: expenses.length,
    linkedEntries: report.entries.filter((entry) => entry.entryV3).length,
    headerComments: report.header.comments.length,
    headerExceptions: report.header.exceptions.length,
  };
  report.durationMs = Date.now() - startedAt;
  process.stdout.write(`[${index}/${total}] ${reportId} entries=${report.entries.length} errors=${errors.length} ${report.durationMs}ms\n`);
  return report;
}

/* ── Main ───────────────────────────────────────────────────────────── */

const idsPath = resolve(options.ids);
const reportIds = readFileSync(idsPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim().toUpperCase())
  .filter(Boolean);
const uniqueIds = [...new Set(reportIds)];
if (!uniqueIds.length) throw new Error(`No report IDs found in ${idsPath}`);

const outputDirectory = resolve(options.out);
const reportsDirectory = join(outputDirectory, 'reports');
mkdirSync(reportsDirectory, { recursive: true });

const startedAt = Date.now();
const results = new Array(uniqueIds.length);
let cursor = 0;

async function worker() {
  while (cursor < uniqueIds.length) {
    const index = cursor;
    cursor += 1;
    const reportId = uniqueIds[index];
    try {
      results[index] = await exportReport(reportId, index + 1, uniqueIds.length);
    } catch (error) {
      results[index] = {
        reportId,
        exportIndex: index + 1,
        exportedAt: new Date().toISOString(),
        entityId: options.entity,
        fatalError: error instanceof Error ? error.message : String(error),
        errors: [],
        header: {},
        entries: [],
      };
      process.stderr.write(`[${index + 1}/${uniqueIds.length}] ${reportId} FAILED: ${results[index].fatalError}\n`);
    }
    writeFileSync(join(reportsDirectory, `${reportId}.json`), JSON.stringify(results[index], null, 2));
  }
}

await Promise.all(Array.from({ length: Math.min(options.concurrency, uniqueIds.length) }, worker));

const manifest = {
  entityId: options.entity,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  idSource: idsPath,
  reportCount: results.length,
  loginIds: [...new Set(results.map((report) => report.loginId).filter(Boolean))].length,
  userIds: [...new Set(results.map((report) => report.userId).filter(Boolean))].length,
  reportsWithErrors: results.filter((report) => (report.errors?.length ?? 0) > 0 || report.fatalError).length,
  errorSections: results.flatMap((report) => [...(report.errors ?? []).map((error) => error.section ?? error.detail), ...(report.fatalError ? [report.fatalError] : [])]),
  reports: results.map((report) => ({
    reportId: report.reportId,
    loginId: report.loginId ?? null,
    userId: report.userId ?? null,
    entryCount: report.entries?.length ?? 0,
    counts: report.counts ?? null,
    fatalError: report.fatalError ?? null,
    errors: report.errors ?? [],
  })),
};

writeFileSync(join(outputDirectory, 'reports-all.json'), JSON.stringify(results, null, 2));
writeFileSync(join(outputDirectory, 'export-manifest.json'), JSON.stringify(manifest, null, 2));

process.stdout.write(
  `\nExported ${results.length} reports to ${outputDirectory}\n`
  + `  reports/<ID>.json     one file per report\n`
  + `  reports-all.json      combined array\n`
  + `  export-manifest.json  ${manifest.reportsWithErrors} report(s) with errors\n`,
);