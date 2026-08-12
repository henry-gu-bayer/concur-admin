import { FormEvent, useEffect, useRef, useState } from 'react';
import { fetchAllReports, fetchReportById, fetchReportEntries, searchReports } from '../api/reportsApi';
import { getActiveEntityId } from '../entities/entityStore';
import { loadReportsViewSession, saveReportsViewSession } from './reportsSessionCache';
import { EMPTY_REFERENCES, ensureLocationsLoaded, getReportReferences, loadReportReferences } from './reportsReferences';
import type { ReportReferences } from './reportsReferences';
import type { EntriesResult, ExpenseEntry, ExpenseReport, ReportQuery, ReportSearchResult } from '../types';
import countriesData from '../data/countries.json';
import subdivisionsData from '../data/subdivisions.json';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import { Modal } from './ui/Modal';

interface CountryOption {
  code: string;
  name: string;
}

interface SubdivisionOption {
  code: string;
  name: string;
}

const countries = countriesData as CountryOption[];
const subdivisions = subdivisionsData as Record<string, SubdivisionOption[]>;
const countryNameByCode = new Map(countries.map((c) => [c.code, c.name]));

/** Concur Expense standard approval status codes (Reports v3 docs). */
const APPROVAL_STATUSES: [string, string][] = [
  ['A_NOTF', 'Not submitted'],
  ['A_FILE', 'Submitted'],
  ['A_PEND', 'Pending manager approval'],
  ['A_ACCO', 'Pending reviews'],
  ['A_APPR', 'Approved'],
  ['A_EXTV', 'Pending external validation'],
  ['A_PBDG', 'Pending budget approval'],
  ['A_PECO', 'Pending cost object approval'],
  ['A_PVAL', 'Pending prepayment validation'],
  ['A_RESU', 'Needs resubmission'],
  ['A_RHLD', 'Pending receipt images'],
  ['A_TEXP', 'Expired in approval queue'],
  ['A_AAFH', 'Anomaly and fraud check'],
];

/** Concur Expense standard payment status codes (Reports v3 docs). */
const PAYMENT_STATUSES: [string, string][] = [
  ['P_NOTP', 'Not paid'],
  ['P_PROC', 'In process'],
  ['P_PAID', 'Paid'],
  ['P_PAYC', 'Payment confirmed'],
  ['P_HOLD', 'On hold'],
];

/**
 * Expense Reports view — searches report headers live via Reports v3. The
 * default row takes a login ID and/or a report ID; a report ID goes straight
 * to GET /reports/{id}?user=<loginId> (the owner's login ID is required) and
 * auto-selects the report. Approval/payment status, country, and date ranges
 * live in an Advanced search dialog. The selected report's header details
 * show in a side panel, and the report's expense entries (Entries v3) open in
 * a dialog where any entry can be expanded to its full field list.
 */
export function ReportsView() {
  // Search parameters and fetched results are cached per entity in
  // sessionStorage so switching pages does not lose them.
  const [entityId] = useState(() => getActiveEntityId());
  const [cached] = useState(() => loadReportsViewSession(entityId));

  const [loginId, setLoginId] = useState(cached?.loginId ?? '');
  const [reportId, setReportId] = useState(cached?.reportId ?? '');
  const [reportIdError, setReportIdError] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState(cached?.advanced.approvalStatusCode ?? '');
  const [paymentStatus, setPaymentStatus] = useState(cached?.advanced.paymentStatusCode ?? '');
  const [country, setCountry] = useState(cached?.advanced.countryCode ?? '');
  const [createdFrom, setCreatedFrom] = useState(cached?.advanced.createdAfter ?? '');
  const [createdTo, setCreatedTo] = useState(cached?.advanced.createdBefore ?? '');
  const [submittedFrom, setSubmittedFrom] = useState(cached?.advanced.submittedAfter ?? '');
  const [submittedTo, setSubmittedTo] = useState(cached?.advanced.submittedBefore ?? '');
  const [paidFrom, setPaidFrom] = useState(cached?.advanced.paidAfter ?? '');
  const [paidTo, setPaidTo] = useState(cached?.advanced.paidBefore ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [searching, setSearching] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportSearchResult | null>(cached?.result ?? null);
  const [lastQuery, setLastQuery] = useState<ReportQuery | null>(cached?.lastQuery ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(cached?.selectedId ?? null);

  const [entries, setEntries] = useState<{ reportId: string; result: EntriesResult } | null>(cached?.entries ?? null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [entriesOpen, setEntriesOpen] = useState(cached?.entriesOpen ?? false);

  const [references, setReferences] = useState<ReportReferences>(EMPTY_REFERENCES);

  const searchSeq = useRef(0);
  const entriesSeq = useRef(0);

  // Policy / payment type / form names come from already-fetched snapshots;
  // location names from a one-time Locations crawl. Missing data is ignored.
  useEffect(() => {
    let cancelled = false;
    void loadReportReferences().then((refs) => {
      if (!cancelled) setReferences({ ...refs });
    });
    void ensureLocationsLoaded().then(() => {
      if (!cancelled) setReferences({ ...getReportReferences() });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveReportsViewSession(entityId, {
      loginId,
      reportId,
      advanced: {
        approvalStatusCode: approvalStatus || undefined,
        paymentStatusCode: paymentStatus || undefined,
        countryCode: country || undefined,
        createdAfter: createdFrom || undefined,
        createdBefore: createdTo || undefined,
        submittedAfter: submittedFrom || undefined,
        submittedBefore: submittedTo || undefined,
        paidAfter: paidFrom || undefined,
        paidBefore: paidTo || undefined,
      },
      result,
      lastQuery,
      selectedId,
      entries,
      entriesOpen,
    });
  }, [approvalStatus, country, createdFrom, createdTo, entityId, entries, entriesOpen, lastQuery, loginId,
    paidFrom, paidTo, paymentStatus, reportId, result, selectedId, submittedFrom, submittedTo]);

  const query: ReportQuery = {
    loginId: loginId.trim() || undefined,
    approvalStatusCode: approvalStatus || undefined,
    paymentStatusCode: paymentStatus || undefined,
    countryCode: country || undefined,
    createdAfter: createdFrom || undefined,
    createdBefore: createdTo || undefined,
    submittedAfter: submittedFrom || undefined,
    submittedBefore: submittedTo || undefined,
    paidAfter: paidFrom || undefined,
    paidBefore: paidTo || undefined,
  };
  const trimmedReportId = reportId.trim();
  const byReportId = trimmedReportId !== '';
  const hasAdvanced = approvalStatus !== '' || paymentStatus !== '' || country !== ''
    || createdFrom !== '' || createdTo !== '' || submittedFrom !== '' || submittedTo !== ''
    || paidFrom !== '' || paidTo !== '';
  // A report ID lookup needs the owner's login ID as the `user` context.
  const canSearch = Object.values(query).some((v) => v !== undefined)
    || (byReportId && query.loginId !== undefined);

  const reports = result?.reports ?? [];
  const selected = reports.find((r) => r.ID === selectedId) ?? null;
  const selectedEntries = entries && entries.reportId === selected?.ID ? entries.result : null;

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (byReportId && !query.loginId) {
      setReportIdError('Enter the report owner’s login ID to search by report ID.');
      return;
    }
    if (!canSearch || searching) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    setError(null);
    setSelectedId(null);
    setEntries(null);
    setEntriesError(null);
    setEntriesOpen(false);
    try {
      if (byReportId) {
        // Report ID wins: GET /reports/{id}?user=<loginId> returns one full header.
        const report = await fetchReportById(trimmedReportId, query.loginId!);
        if (seq !== searchSeq.current) return;
        setResult({ reports: [report], hasMore: false });
        setLastQuery(null);
        setSelectedId(report.ID);
      } else {
        const firstPage = await searchReports(query);
        if (seq !== searchSeq.current) return;
        setResult(firstPage);
        setLastQuery(query);
      }
    } catch (err) {
      if (seq !== searchSeq.current) return;
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const loadAll = async () => {
    if (!lastQuery || loadingAll) return;
    const seq = searchSeq.current;
    setLoadingAll(true);
    setError(null);
    try {
      const all = await fetchAllReports(lastQuery);
      if (seq !== searchSeq.current) return;
      setResult(all);
    } catch (err) {
      if (seq !== searchSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === searchSeq.current) setLoadingAll(false);
    }
  };

  const selectReport = (report: ExpenseReport) => {
    setSelectedId(report.ID);
    setEntriesError(null);
    setEntriesOpen(false);
    if (entries && entries.reportId !== report.ID) setEntries(null);
  };

  const retrieveEntries = async (report: ExpenseReport) => {
    if (entriesLoading) return;
    const seq = ++entriesSeq.current;
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const res = await fetchReportEntries(report.ID, report.OwnerLoginID);
      if (seq !== entriesSeq.current) return;
      setEntries({ reportId: report.ID, result: res });
      setEntriesOpen(true);
    } catch (err) {
      if (seq !== entriesSeq.current) return;
      setEntries(null);
      setEntriesError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === entriesSeq.current) setEntriesLoading(false);
    }
  };

  const dateRange = (
    label: string,
    from: string,
    to: string,
    setFrom: (v: string) => void,
    setTo: (v: string) => void,
  ) => (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input type="date" aria-label={`${label} from`} value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full px-2 text-xs" />
      <span className="text-xs text-muted-foreground">–</span>
      <Input type="date" aria-label={`${label} to`} value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-full px-2 text-xs" />
    </div>
  );

  const clearAdvanced = () => {
    setApprovalStatus('');
    setPaymentStatus('');
    setCountry('');
    setCreatedFrom('');
    setCreatedTo('');
    setSubmittedFrom('');
    setSubmittedTo('');
    setPaidFrom('');
    setPaidTo('');
  };

  return (
    <div>
      <form onSubmit={search} className="mb-3">
        <div data-testid="report-filter-row" className="flex min-w-0 flex-nowrap items-center gap-2">
          <label className="sr-only" htmlFor="report-login-id">Login ID</label>
          <div className="min-w-0 flex-1 basis-0">
            <Input
              id="report-login-id"
              aria-label="Login ID"
              aria-invalid={byReportId && !query.loginId ? true : undefined}
              value={loginId}
              onChange={(e) => { setLoginId(e.target.value); setReportIdError(null); }}
              placeholder={byReportId ? 'Login ID (required for report ID)' : 'Login ID (any owner)'}
              className="h-9"
            />
          </div>

          <label className="sr-only" htmlFor="report-id">Report ID</label>
          <div className="min-w-0 flex-1 basis-0">
            <Input
              id="report-id"
              aria-label="Report ID"
              value={reportId}
              onChange={(e) => { setReportId(e.target.value); setReportIdError(null); }}
              placeholder="Report ID (exact match)"
              className="h-9"
            />
          </div>

          <Button type="submit" size="sm" loading={searching} disabled={!canSearch} className="h-9 shrink-0">
            {searching ? 'Searching…' : 'Search'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAdvancedOpen(true)}
            aria-haspopup="dialog"
            className="h-9 shrink-0"
          >
            Advanced search{hasAdvanced ? ' •' : ''}
          </Button>
        </div>
        {reportIdError && (
          <p className="mt-1.5 text-xs text-destructive" role="alert">{reportIdError}</p>
        )}
      </form>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <section aria-label="Report search results" className="min-w-0">
          {result === null ? (
            <EmptyPanel
              title="Search expense reports"
              message="Enter a login ID, or an exact report ID together with the owner’s login ID. Approval/payment status, country, and date ranges are under Advanced search."
            />
          ) : reports.length === 0 ? (
            <EmptyPanel title="No reports found" message="Try different filters or broaden the query." />
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
                {reports.length} result{reports.length === 1 ? '' : 's'}
                {result.hasMore ? ' (first page)' : ''}
              </div>
              {result.hasMore && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <span>More reports match the current filters. Refine the filters or load all records.</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => void loadAll()} loading={loadingAll}>
                    {loadingAll ? 'Loading all…' : 'Load all'}
                  </Button>
                </div>
              )}
              <table className="w-full text-sm" aria-label="Report search results">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-2">Name</th>
                    <th scope="col" className="px-3 py-2">Owner</th>
                    <th scope="col" className="px-3 py-2">Approval</th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">Payment</th>
                    <th scope="col" className="px-3 py-2 text-right">Total</th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => {
                    const isSelected = report.ID === selectedId;
                    return (
                      <tr
                        key={report.ID}
                        aria-selected={isSelected}
                        className={`border-b last:border-0 hover:bg-accent/40 ${isSelected ? 'bg-accent/60' : ''}`}
                      >
                        <td className="px-3 py-2 text-xs font-medium text-foreground">
                          <button
                            type="button"
                            onClick={() => selectReport(report)}
                            className="rounded-sm text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {report.Name ?? '—'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{report.OwnerName ?? report.OwnerLoginID ?? '—'}</td>
                        <td className="px-3 py-2">
                          {report.ApprovalStatusName
                            ? <Badge tone={report.ApprovalStatusCode === 'A_APPR' ? 'success' : 'primary'}>{report.ApprovalStatusName}</Badge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="hidden px-3 py-2 md:table-cell">
                          {report.PaymentStatusName
                            ? <Badge tone={report.PaymentStatusCode === 'P_PAID' ? 'success' : 'muted'}>{report.PaymentStatusName}</Badge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-foreground">{fmtAmount(report.Total, report.CurrencyCode)}</td>
                        <td className="hidden px-3 py-2 text-xs text-muted-foreground lg:table-cell">{fmtDate(report.SubmitDate) ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <ReportDetailsPanel
          report={selected}
          entriesResult={selectedEntries}
          entriesLoading={entriesLoading}
          entriesError={entriesError}
          references={references}
          onRetrieveEntries={retrieveEntries}
          onViewEntries={() => setEntriesOpen(true)}
        />
      </div>

      {selected && selectedEntries && (
        <EntriesDialog
          open={entriesOpen}
          report={selected}
          result={selectedEntries}
          references={references}
          onClose={() => setEntriesOpen(false)}
        />
      )}

      <Modal
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        title="Advanced search"
        description="Combine these filters with the login ID on the main form."
        width="max-w-2xl"
        footer={(
          <>
            <Button type="button" variant="ghost" size="sm" onClick={clearAdvanced} disabled={!hasAdvanced}>
              Clear all
            </Button>
            <Button type="button" size="sm" onClick={() => setAdvancedOpen(false)}>
              Done
            </Button>
          </>
        )}
      >
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Approval status</span>
              <Select aria-label="Approval status" value={approvalStatus} onChange={(e) => setApprovalStatus(e.target.value)} className="h-9">
                <option value="">Any</option>
                {APPROVAL_STATUSES.map(([code, label]) => (
                  <option key={code} value={code}>{label} ({code})</option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Payment status</span>
              <Select aria-label="Payment status" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="h-9">
                <option value="">Any</option>
                {PAYMENT_STATUSES.map(([code, label]) => (
                  <option key={code} value={code}>{label} ({code})</option>
                ))}
              </Select>
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Country/Region</span>
            <Select aria-label="Country/Region" value={country} onChange={(e) => setCountry(e.target.value)} className="h-9">
              <option value="">Any</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
              ))}
            </Select>
          </label>
          <fieldset className="grid gap-2.5">
            <legend className="sr-only">Date ranges</legend>
            {dateRange('Created', createdFrom, createdTo, setCreatedFrom, setCreatedTo)}
            {dateRange('Submitted', submittedFrom, submittedTo, setSubmittedFrom, setSubmittedTo)}
            {dateRange('Paid', paidFrom, paidTo, setPaidFrom, setPaidTo)}
          </fieldset>
        </div>
      </Modal>
    </div>
  );
}

/* ── Formatting helpers ─────────────────────────────────────────────── */

function fmtAmount(amount?: number | null, currency?: string): string {
  if (amount === undefined || amount === null) return '—';
  const n = amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${n} ${currency}` : n;
}

function fmtDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 10);
}

function fmtDateTime(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.replace('T', ' ').slice(0, 16);
}

function countryLabel(code?: string): string | undefined {
  if (!code) return undefined;
  const name = countryNameByCode.get(code);
  return name ? `${name} (${code})` : code;
}

function subdivisionLabel(code?: string | null): string | undefined {
  if (!code) return undefined;
  const countryCode = code.split('-')[0];
  const entry = subdivisions[countryCode]?.find((s) => s.code === code);
  return entry ? `${entry.name} (${code})` : code;
}

function booleanLabel(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ? 'Yes' : 'No';
}

/* ── Panels ─────────────────────────────────────────────────────────── */

function EmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="grid grid-cols-[136px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-all text-xs text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function ReportDetailsPanel({
  report,
  entriesResult,
  entriesLoading,
  entriesError,
  references,
  onRetrieveEntries,
  onViewEntries,
}: {
  report: ExpenseReport | null;
  entriesResult: EntriesResult | null;
  entriesLoading: boolean;
  entriesError: string | null;
  references: ReportReferences;
  onRetrieveEntries: (report: ExpenseReport) => void;
  onViewEntries: () => void;
}) {
  const policyName = report?.PolicyID ? references.policyNameById.get(report.PolicyID) : undefined;
  return (
    <aside aria-label="Report details" className="min-w-0 rounded-lg border bg-card p-4 shadow-sm">
      {!report ? (
        <div className="flex min-h-56 flex-col items-center justify-center text-center">
          <h2 className="text-base font-semibold">No report selected</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Choose a report from the search results to inspect its header details.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2 border-b pb-3">
            <div className="flex items-center gap-1.5">
              {entriesResult ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={onViewEntries}
                  className="bg-blue-600 text-white shadow-sm hover:bg-blue-700 active:bg-blue-800"
                >
                  View entries ({entriesResult.entries.length})
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onRetrieveEntries(report)}
                  loading={entriesLoading}
                  className="bg-blue-600 text-white shadow-sm hover:bg-blue-700 active:bg-blue-800"
                >
                  {entriesLoading ? 'Loading…' : 'Retrieve entries'}
                </Button>
              )}
              {entriesResult && (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => onRetrieveEntries(report)}
                  loading={entriesLoading}
                  aria-label="Refresh entries"
                  title="Refresh entries"
                >
                  {!entriesLoading && (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </Button>
              )}
            </div>
            {entriesError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
                {entriesError}
              </p>
            )}
          </div>

          <div className="flex min-w-0 items-baseline gap-x-2">
            <h2 className="min-w-0 break-all text-sm font-semibold text-foreground">{report.Name ?? 'Unnamed report'}</h2>
            <p className="shrink-0 break-all font-mono text-xs text-muted-foreground">{report.ID}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {report.ApprovalStatusName && <Badge tone={report.ApprovalStatusCode === 'A_APPR' ? 'success' : 'primary'}>{report.ApprovalStatusName}</Badge>}
            {report.PaymentStatusName && <Badge tone={report.PaymentStatusCode === 'P_PAID' ? 'success' : 'muted'}>{report.PaymentStatusName}</Badge>}
            {report.HasException && <Badge tone="destructive">Exception</Badge>}
            {report.EverSentBack && <Badge tone="warning">Sent back</Badge>}
          </div>
          <dl className="grid gap-1.5">
            <Field label="Owner" value={report.OwnerName} />
            <Field label="Owner login ID" value={report.OwnerLoginID} mono />
            <Field label="Approver" value={report.ApproverName} />
            <Field label="Approver login" value={report.ApproverLoginID} mono />
            <Field label="Country" value={countryLabel(report.Country)} />
            <Field label="Subdivision" value={subdivisionLabel(report.CountrySubdivision)} />
            <Field label="Total" value={fmtAmount(report.Total, report.CurrencyCode)} />
            <Field label="Claimed" value={fmtAmount(report.TotalClaimedAmount, report.CurrencyCode)} />
            <Field label="Approved amount" value={fmtAmount(report.TotalApprovedAmount, report.CurrencyCode)} />
            <Field label="Due employee" value={fmtAmount(report.AmountDueEmployee, report.CurrencyCode)} />
            <Field label="Due company card" value={fmtAmount(report.AmountDueCompanyCard, report.CurrencyCode)} />
            <Field label="Personal amount" value={fmtAmount(report.PersonalAmount, report.CurrencyCode)} />
            <Field label="Ledger" value={report.LedgerName} />
            <Field label="Policy ID" value={report.PolicyID} mono />
            {policyName && <Field label="Policy name" value={policyName} />}
            <Field label="Created" value={fmtDateTime(report.CreateDate)} />
            <Field label="Submitted" value={fmtDateTime(report.SubmitDate)} />
            <Field label="Processing payment" value={fmtDateTime(report.ProcessingPaymentDate)} />
            <Field label="Paid date" value={fmtDateTime(report.PaidDate)} />
            <Field label="Last modified" value={fmtDateTime(report.LastModifiedDate)} />
            <Field label="User-defined date" value={fmtDate(report.UserDefinedDate)} />
            <Field label="Last comment" value={report.LastComment} />
            <Field label="Receipts received" value={booleanLabel(report.ReceiptsReceived)} />
            {customFields(report).map(({ label, value, type }) => (
              <div key={label} className="grid grid-cols-[136px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
                <dt className="flex flex-wrap items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                  {type && <Badge tone="muted">{type}</Badge>}
                </dt>
                <dd className="min-w-0 break-all text-xs text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </aside>
  );
}

/** Non-empty OrgUnit1-6 / Custom1-40 fields, in stable order, with the field type when set. */
function customFields(record: ExpenseReport | ExpenseEntry): { label: string; value: string; type?: string }[] {
  const out: { label: string; value: string; type?: string }[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const f = record[`OrgUnit${i}`];
    if (f?.Value) out.push({ label: `Org unit ${i}`, value: f.Code ? `${f.Value} (${f.Code})` : f.Value, type: f.Type || undefined });
  }
  for (let i = 1; i <= 40; i += 1) {
    const f = record[`Custom${i}`];
    if (f?.Value) out.push({ label: `Custom ${i}`, value: f.Code ? `${f.Value} (${f.Code})` : f.Value, type: f.Type || undefined });
  }
  return out;
}

/* ── Entries dialog ─────────────────────────────────────────────────── */

function EntriesDialog({
  open,
  report,
  result,
  references,
  onClose,
}: {
  open: boolean;
  report: ExpenseReport;
  result: EntriesResult;
  references: ReportReferences;
  onClose: () => void;
}) {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const reportName = report.Name ?? 'report';
  const entries = result.entries;
  const selected = entries.find((e) => e.ID === selectedEntryId) ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Expense entries — ${reportName}`}
      description={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${result.hasMore ? ' (first pages)' : ''} · click an entry to see every populated field`}
      width="max-w-6xl"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <div className="min-w-0">
          {entries.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No entries recorded for this report.
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <table className="w-full text-sm" aria-label={`Entries for ${reportName}`}>
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-muted text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-2 py-1.5">Date</th>
                    <th scope="col" className="px-2 py-1.5">Type</th>
                    <th scope="col" className="px-2 py-1.5">Vendor</th>
                    <th scope="col" className="hidden px-2 py-1.5 md:table-cell">Payment</th>
                    <th scope="col" className="px-2 py-1.5 text-right">Amount</th>
                    <th scope="col" className="px-2 py-1.5">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const isSelected = entry.ID === selectedEntryId;
                    const typeLabel = entry.ExpenseTypeName ?? entry.ExpenseTypeCode ?? entry.ID;
                    return (
                      <tr
                        key={entry.ID}
                        aria-selected={isSelected}
                        className={`border-b last:border-0 hover:bg-accent/40 ${isSelected ? 'bg-accent/60' : ''}`}
                      >
                        <td className="px-2 py-1 text-xs tabular-nums text-muted-foreground">{fmtDate(entry.TransactionDate) ?? '—'}</td>
                        <td className="px-2 py-1 text-xs font-medium text-foreground">
                          <button
                            type="button"
                            aria-label={`View entry ${typeLabel}`}
                            onClick={() => setSelectedEntryId(entry.ID)}
                            className="rounded-sm text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {typeLabel}
                          </button>
                        </td>
                        <td className="px-2 py-1 text-xs text-muted-foreground">{entry.VendorDescription ?? entry.VendorListItemName ?? '—'}</td>
                        <td className="hidden px-2 py-1 text-xs text-muted-foreground md:table-cell">{entry.PaymentTypeName ?? '—'}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-xs text-foreground">{fmtAmount(entry.TransactionAmount, entry.TransactionCurrencyCode)}</td>
                        <td className="px-2 py-1">
                          <span className="flex flex-wrap gap-1">
                            {entry.IsPersonal && <Badge tone="warning">Personal</Badge>}
                            {entry.HasExceptions && <Badge tone="destructive">Exception</Badge>}
                            {entry.HasImage && <Badge tone="muted">Image</Badge>}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {result.hasMore && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              The report has more entries than could be fetched — showing the first {entries.length} records.
            </p>
          )}
        </div>

        <EntryDetails entry={selected} references={references} />
      </div>
    </Modal>
  );
}

function EntryDetails({ entry, references }: { entry: ExpenseEntry | null; references: ReportReferences }) {
  if (!entry) {
    return (
      <div role="group" aria-label="Entry details" className="flex min-h-40 items-center justify-center rounded-md border border-dashed px-4 py-8 text-center">
        <p className="max-w-xs text-sm text-muted-foreground">Select an entry to see all of its populated fields.</p>
      </div>
    );
  }

  const paymentTypeName = entry.PaymentTypeID ? references.paymentTypeNameById.get(entry.PaymentTypeID) : undefined;
  const locationName = entry.LocationID ? references.locationNameById.get(entry.LocationID) : undefined;
  const formName = entry.FormID ? references.formNameById.get(entry.FormID) : undefined;
  const fields = entryDetailFields(entry);
  return (
    <div role="group" aria-label="Entry details" className="max-h-[60vh] min-w-0 overflow-auto rounded-md border p-3">
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        {entry.ExpenseTypeName ?? entry.ExpenseTypeCode ?? 'Expense entry'}
      </h3>
      <dl className="grid gap-1.5">
        {fields.map(({ label, value, mono, type }) => (
          <div key={label} className="grid grid-cols-[136px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
            <dt className="flex flex-wrap items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {label}
              {type && <Badge tone="muted">{type}</Badge>}
            </dt>
            <dd className={`min-w-0 break-all text-xs text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
          </div>
        ))}
        {paymentTypeName && <Field label="Payment type name" value={paymentTypeName} />}
        {locationName && <Field label="Location name" value={locationName} />}
        {formName && <Field label="Form name" value={formName} />}
      </dl>
    </div>
  );
}

/* ── Entry field flattening ─────────────────────────────────────────── */

interface DetailField {
  label: string;
  value: string;
  mono?: boolean;
  /** Custom/OrgUnit field type, rendered as a badge next to the label. */
  type?: string;
}

/** Friendly labels for keys whose humanized form would read poorly. */
const ENTRY_LABELS: Record<string, string> = {
  ID: 'Entry ID',
  ExpenseID: 'Expense UUID',
  ReportID: 'Report ID',
  ReportOwnerID: 'Report owner',
  FormID: 'Form ID',
  LocationID: 'Location ID',
  LocationName: 'Location',
  LocationCountry: 'Location country',
  LocationSubdivision: 'Location subdivision',
  SpendCategoryName: 'Spend category',
  SpendCategoryCode: 'Spend category code',
  PaymentTypeName: 'Payment type',
  PaymentTypeID: 'Payment type ID',
  TransactionAmount: 'Transaction amount',
  TransactionCurrencyCode: 'Transaction currency',
  VendorDescription: 'Vendor',
  HasVAT: 'Has VAT',
  IsBillable: 'Billable',
  IsPersonal: 'Personal',
  TripID: 'Trip ID',
  ElectronicReceiptID: 'eReceipt ID',
  EmployeeBankAccountID: 'Employee bank account',
  CompanyCardTransactionID: 'Company card transaction',
};

/** Keys rendered in monospace (IDs, codes, URIs). */
const MONO_KEYS = /(^ID$|ID$|Code$|URI$|Guid$)/;

/** Keys formatted as amounts with two decimals. */
const AMOUNT_KEYS = new Set([
  'TransactionAmount',
  'PostedAmount',
  'ApprovedAmount',
  'ExchangeRate',
]);

const DATE_ONLY_KEYS = new Set(['TransactionDate']);

/** Custom/OrgUnit fields are appended at the end via customFields(); URIs/links are noise. */
const SKIP_KEYS = /^(Custom|OrgUnit)\d+$/;
const SKIP_EXACT_KEYS = new Set(['URI', 'Links', 'links']);

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b(Is|Has)\s/, (m) => m)
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase().replace(/\b(id|uri|vat)\b/g, (m) => m.toUpperCase());
}

function labelFor(key: string): string {
  return ENTRY_LABELS[key] ?? humanizeKey(key);
}

/**
 * Flattens an entry into label/value pairs, dropping anything without a
 * value (null, undefined, empty string, or an empty custom field) so the
 * detail view only shows data the entry actually carries. URIs and links are
 * omitted — they add noise without helping identify the entry.
 */
export function entryDetailFields(entry: ExpenseEntry): DetailField[] {
  const out: DetailField[] = [];
  for (const [key, raw] of Object.entries(entry)) {
    if (SKIP_KEYS.test(key) || SKIP_EXACT_KEYS.has(key)) continue;
    if (raw === null || raw === undefined || raw === '') continue;

    if (typeof raw === 'object') {
      // Nested objects (e.g. Journey) are flattened one level deep.
      for (const [nestedKey, nestedRaw] of Object.entries(raw as Record<string, unknown>)) {
        if (nestedRaw === null || nestedRaw === undefined || nestedRaw === '') continue;
        out.push({
          label: `${labelFor(key)} · ${labelFor(nestedKey)}`,
          value: formatScalar(nestedKey, nestedRaw, entry),
          mono: MONO_KEYS.test(nestedKey),
        });
      }
      continue;
    }

    out.push({ label: labelFor(key), value: formatScalar(key, raw, entry), mono: MONO_KEYS.test(key) });
  }

  for (const { label, value, type } of customFields(entry)) out.push({ label, value, type });
  return out;
}

function formatScalar(key: string, value: unknown, entry: ExpenseEntry): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (key === 'ExchangeRate') return String(value);
    if (AMOUNT_KEYS.has(key)) {
      const currency = key === 'TransactionAmount' ? entry.TransactionCurrencyCode : undefined;
      return fmtAmount(value, currency);
    }
    return String(value);
  }
  const text = String(value);
  if (DATE_ONLY_KEYS.has(key)) return fmtDate(text) ?? text;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return fmtDateTime(text) ?? text;
  return text;
}
