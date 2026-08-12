import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { fetchAllReports, fetchReportById, fetchReportCommentsV4, fetchReportEntries, fetchReportExceptionsV4, fetchReportV4, searchReports } from '../api/reportsApi';
import { getActiveEntityId } from '../entities/entityStore';
import { loadReportsViewSession, saveReportsViewSession } from './reportsSessionCache';
import { EMPTY_REFERENCES, ensureLocationsLoaded, getReportReferences, loadReportReferences } from './reportsReferences';
import type { ReportReferences } from './reportsReferences';
import type { EntriesResult, ExpenseEntry, ExpenseReport, ExpenseReportV4, ReportCommentV4, ReportExceptionV4, ReportQuery, ReportSearchResult } from '../types';
import { reportV4OnlySections } from './reportV4Fields';
import countriesData from '../data/countries.json';
import subdivisionsData from '../data/subdivisions.json';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import { Modal } from './ui/Modal';

type ReportSortKey = 'name' | 'owner' | 'approval' | 'payment' | 'total' | 'submitted' | 'created';
type SortDirection = 'asc' | 'desc';

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

const CUSTOM_FIELD_TYPE_CODES: Record<string, string> = {
  boolean: 'B',
  connectedlist: 'C',
  date: 'D',
  integer: 'I',
  list: 'L',
  number: 'N',
  text: 'T',
};

/** Compact display code for Concur custom field types. Unknown values remain visible. */
export function customFieldTypeCode(type?: string): string | undefined {
  const value = type?.trim();
  if (!value) return undefined;
  if (value.length === 1) return value.toUpperCase();
  return CUSTOM_FIELD_TYPE_CODES[value.toLowerCase().replace(/[\s_-]/g, '')] ?? value;
}

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
  const [reportSort, setReportSort] = useState<{ key: ReportSortKey; direction: SortDirection } | null>(null);

  const [entries, setEntries] = useState<{ reportId: string; result: EntriesResult } | null>(cached?.entries ?? null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [entriesOpen, setEntriesOpen] = useState(cached?.entriesOpen ?? false);
  const [reportV4, setReportV4] = useState<{ reportId: string; userId: string; report: ExpenseReportV4 } | null>(null);
  const [reportV4Loading, setReportV4Loading] = useState(false);
  const [reportV4Error, setReportV4Error] = useState<string | null>(null);
  const [reportExceptions, setReportExceptions] = useState<{ reportId: string; items: ReportExceptionV4[] } | null>(null);
  const [reportExceptionsLoading, setReportExceptionsLoading] = useState(false);
  const [reportExceptionsError, setReportExceptionsError] = useState<string | null>(null);
  const [reportExceptionsOpen, setReportExceptionsOpen] = useState(false);
  const [reportComments, setReportComments] = useState<{ reportId: string; items: ReportCommentV4[] } | null>(null);
  const [reportCommentsLoading, setReportCommentsLoading] = useState(false);
  const [reportCommentsError, setReportCommentsError] = useState<string | null>(null);
  const [reportCommentsOpen, setReportCommentsOpen] = useState(false);

  const [references, setReferences] = useState<ReportReferences>(EMPTY_REFERENCES);

  const searchSeq = useRef(0);
  const entriesSeq = useRef(0);
  const reportV4Seq = useRef(0);
  const reportExceptionsSeq = useRef(0);
  const reportCommentsSeq = useRef(0);

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
  const advancedFilters = [
    approvalStatus ? {
      key: 'approval-status',
      label: 'Approval',
      value: APPROVAL_STATUSES.find(([code]) => code === approvalStatus)?.[1] ?? approvalStatus,
      remove: () => setApprovalStatus(''),
    } : null,
    paymentStatus ? {
      key: 'payment-status',
      label: 'Payment',
      value: PAYMENT_STATUSES.find(([code]) => code === paymentStatus)?.[1] ?? paymentStatus,
      remove: () => setPaymentStatus(''),
    } : null,
    country ? {
      key: 'country',
      label: 'Country',
      value: countryLabel(country) ?? country,
      remove: () => setCountry(''),
    } : null,
    createdFrom ? { key: 'created-from', label: 'Created from', value: createdFrom, remove: () => setCreatedFrom('') } : null,
    createdTo ? { key: 'created-to', label: 'Created to', value: createdTo, remove: () => setCreatedTo('') } : null,
    submittedFrom ? { key: 'submitted-from', label: 'Submitted from', value: submittedFrom, remove: () => setSubmittedFrom('') } : null,
    submittedTo ? { key: 'submitted-to', label: 'Submitted to', value: submittedTo, remove: () => setSubmittedTo('') } : null,
    paidFrom ? { key: 'paid-from', label: 'Paid from', value: paidFrom, remove: () => setPaidFrom('') } : null,
    paidTo ? { key: 'paid-to', label: 'Paid to', value: paidTo, remove: () => setPaidTo('') } : null,
  ].filter((filter): filter is { key: string; label: string; value: string; remove: () => void } => filter !== null);
  // A report ID lookup needs the owner's login ID as the `user` context.
  const canSearch = Object.values(query).some((v) => v !== undefined)
    || (byReportId && query.loginId !== undefined);
  const hasSearchState = Boolean(
    loginId || reportId || hasAdvanced || result !== null || error || reportIdError
    || selectedId || entries || entriesError,
  );

  const reports = result?.reports ?? [];
  const sortedReports = reportSort ? [...reports].sort((left, right) => {
    const leftValue = reportSortValue(left, reportSort.key);
    const rightValue = reportSortValue(right, reportSort.key);
    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base', numeric: true });
    return reportSort.direction === 'asc' ? comparison : -comparison;
  }) : reports;
  const selected = reports.find((r) => r.ID === selectedId) ?? null;
  const selectedEntries = entries && entries.reportId === selected?.ID ? entries.result : null;
  const showingEntries = Boolean(entriesOpen && selected && selectedEntries);

  useEffect(() => {
    const seq = ++reportV4Seq.current;
    setReportV4(null);
    setReportV4Error(null);
    if (!selected) {
      setReportV4Loading(false);
      return;
    }
    const loginId = selected.OwnerLoginID?.trim();
    if (!loginId) {
      setReportV4Loading(false);
      setReportV4Error('Reports v4 requires the report owner login ID, but Reports v3 did not return one.');
      return;
    }
    setReportV4Loading(true);
    void fetchReportV4(selected.ID, loginId)
      .then(({ userId, report }) => {
        if (seq !== reportV4Seq.current) return;
        setReportV4({ reportId: selected.ID, userId, report });
      })
      .catch((err) => {
        if (seq !== reportV4Seq.current) return;
        setReportV4Error(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (seq === reportV4Seq.current) setReportV4Loading(false);
      });
  }, [selected?.ID, selected?.OwnerLoginID]);

  useEffect(() => {
    const seq = ++reportExceptionsSeq.current;
    setReportExceptions(null);
    setReportExceptionsError(null);
    setReportExceptionsOpen(false);
    if (!selected?.HasException) {
      setReportExceptionsLoading(false);
      return;
    }
    const userId = reportV4?.reportId === selected.ID ? reportV4.userId : null;
    if (!userId) {
      setReportExceptionsLoading(!reportV4Error);
      if (reportV4Error) setReportExceptionsError('Unable to resolve the report owner for Exceptions v4.');
      return;
    }
    setReportExceptionsLoading(true);
    void fetchReportExceptionsV4(selected.ID, userId)
      .then((items) => {
        if (seq !== reportExceptionsSeq.current) return;
        setReportExceptions({ reportId: selected.ID, items });
      })
      .catch((err) => {
        if (seq !== reportExceptionsSeq.current) return;
        setReportExceptionsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (seq === reportExceptionsSeq.current) setReportExceptionsLoading(false);
      });
  }, [selected?.ID, selected?.HasException, reportV4?.reportId, reportV4?.userId, reportV4Error]);

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
    reportCommentsSeq.current += 1;
    setReportComments(null);
    setReportCommentsLoading(false);
    setReportCommentsError(null);
    setReportCommentsOpen(false);
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
    setReportExceptionsOpen(false);
    reportCommentsSeq.current += 1;
    setReportComments(null);
    setReportCommentsLoading(false);
    setReportCommentsError(null);
    setReportCommentsOpen(false);
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

  const retrieveReportComments = async (report: ExpenseReport) => {
    const seq = ++reportCommentsSeq.current;
    setReportCommentsOpen(true);
    setReportCommentsLoading(true);
    setReportCommentsError(null);
    setReportComments(null);
    try {
      const items = await fetchReportCommentsV4(report.ID);
      if (seq !== reportCommentsSeq.current) return;
      setReportComments({ reportId: report.ID, items });
    } catch (err) {
      if (seq !== reportCommentsSeq.current) return;
      setReportCommentsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === reportCommentsSeq.current) setReportCommentsLoading(false);
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

  const sortReportsBy = (key: ReportSortKey) => {
    setReportSort((current) => current?.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
  };

  const clearSearch = () => {
    // Invalidate requests that may still resolve after the UI has been reset.
    searchSeq.current += 1;
    entriesSeq.current += 1;
    reportV4Seq.current += 1;
    reportExceptionsSeq.current += 1;
    reportCommentsSeq.current += 1;
    setSearching(false);
    setLoadingAll(false);
    setEntriesLoading(false);
    setLoginId('');
    setReportId('');
    clearAdvanced();
    setAdvancedOpen(false);
    setReportIdError(null);
    setError(null);
    setResult(null);
    setLastQuery(null);
    setSelectedId(null);
    setReportSort(null);
    setEntries(null);
    setEntriesError(null);
    setEntriesOpen(false);
    setReportV4(null);
    setReportV4Loading(false);
    setReportV4Error(null);
    setReportExceptions(null);
    setReportExceptionsLoading(false);
    setReportExceptionsError(null);
    setReportExceptionsOpen(false);
    setReportComments(null);
    setReportCommentsLoading(false);
    setReportCommentsError(null);
    setReportCommentsOpen(false);
  };

  return (
    <div>
      {!showingEntries && <form onSubmit={search} className="mb-3">
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
            onClick={clearSearch}
            disabled={!hasSearchState}
            className="h-9 shrink-0"
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAdvancedOpen(true)}
            aria-haspopup="dialog"
            className="h-9 shrink-0"
          >
            Advanced search{advancedFilters.length > 0 ? ` (${advancedFilters.length})` : ''}
          </Button>
        </div>
        {advancedFilters.length > 0 && (
          <div
            aria-label="Active advanced search filters"
            className="mt-2 flex min-w-0 items-center gap-2 overflow-x-auto pb-1"
          >
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Filters</span>
            {advancedFilters.map((filter) => (
              <span
                key={filter.key}
                className="inline-flex h-7 shrink-0 items-center overflow-hidden rounded-full border border-primary/20 bg-primary/5 text-xs text-foreground"
              >
                <span className="border-r border-primary/15 px-2.5">
                  <span className="font-medium text-muted-foreground">{filter.label}:</span> {filter.value}
                </span>
                <button
                  type="button"
                  onClick={filter.remove}
                  aria-label={`Remove ${filter.label} filter`}
                  title={`Remove ${filter.label} filter`}
                  className="flex h-full w-7 items-center justify-center text-sm text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  ×
                </button>
              </span>
            ))}
            {advancedFilters.length > 1 && (
              <button
                type="button"
                onClick={clearAdvanced}
                className="shrink-0 rounded-sm px-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear all
              </button>
            )}
          </div>
        )}
        {reportIdError && (
          <p className="mt-1.5 text-xs text-destructive" role="alert">{reportIdError}</p>
        )}
      </form>}

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {!showingEntries && <div className={`grid min-h-[520px] gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)] ${hasAdvanced ? 'h-[calc(100vh-16rem)]' : 'h-[calc(100vh-13.5rem)]'}`}>
        <section aria-label="Report search results" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
          {result === null ? (
            <EmptyPanel
              title="Search expense reports"
              message="Enter a login ID, or an exact report ID together with the owner’s login ID. Approval/payment status, country, and date ranges are under Advanced search."
            />
          ) : reports.length === 0 ? (
            <EmptyPanel title="No reports found" message="Try different filters or broaden the query." />
          ) : (
            <>
              <div className="flex min-h-10 items-center justify-between border-b bg-muted/40 px-4 py-2">
                <h2 className="text-sm font-semibold text-foreground">Reports</h2>
                <span className="text-xs text-muted-foreground">
                {reports.length} result{reports.length === 1 ? '' : 's'}
                {result.hasMore ? ' (first page)' : ''}
                </span>
              </div>
              {result.hasMore && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <span>More reports match the current filters. Refine the filters or load all records.</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => void loadAll()} loading={loadingAll}>
                    {loadingAll ? 'Loading all…' : 'Load all'}
                  </Button>
                </div>
              )}
              <div aria-label="Scrollable report list" className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[900px] text-sm" aria-label="Report search results">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <SortableReportHeader label="Name" sortKey="name" sort={reportSort} onSort={sortReportsBy} />
                    <SortableReportHeader label="Owner" sortKey="owner" sort={reportSort} onSort={sortReportsBy} />
                    <SortableReportHeader label="Approval" sortKey="approval" sort={reportSort} onSort={sortReportsBy} />
                    <SortableReportHeader label="Payment" sortKey="payment" sort={reportSort} onSort={sortReportsBy} />
                    <SortableReportHeader label="Total" sortKey="total" sort={reportSort} onSort={sortReportsBy} align="right" />
                    <SortableReportHeader label="Submitted" sortKey="submitted" sort={reportSort} onSort={sortReportsBy} />
                    <SortableReportHeader label="Created" sortKey="created" sort={reportSort} onSort={sortReportsBy} />
                  </tr>
                </thead>
                <tbody>
                  {sortedReports.map((report) => {
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
                        <td className="px-3 py-2">
                          {report.PaymentStatusName
                            ? <Badge tone={report.PaymentStatusCode === 'P_PAID' ? 'success' : 'muted'}>{report.PaymentStatusName}</Badge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-foreground">{fmtAmount(report.Total, report.CurrencyCode)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{fmtDate(report.SubmitDate) ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{fmtDate(report.CreateDate) ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
        </section>

        <ReportDetailsPanel
          report={selected}
          entriesResult={selectedEntries}
          entriesLoading={entriesLoading}
          entriesError={entriesError}
          reportV4={reportV4 && reportV4.reportId === selected?.ID ? reportV4.report : null}
          reportV4Loading={reportV4Loading}
          reportV4Error={reportV4Error}
          reportExceptions={reportExceptions && reportExceptions.reportId === selected?.ID ? reportExceptions.items : null}
          reportExceptionsLoading={reportExceptionsLoading}
          reportExceptionsError={reportExceptionsError}
          reportCommentsLoading={reportCommentsLoading}
          references={references}
          onRetrieveEntries={retrieveEntries}
          onViewEntries={() => setEntriesOpen(true)}
          onViewExceptions={() => setReportExceptionsOpen(true)}
          onRetrieveComments={retrieveReportComments}
        />
      </div>}

      {showingEntries && selected && selectedEntries && (
        <EntriesWorkspace
          report={selected}
          result={selectedEntries}
          references={references}
          onBack={() => setEntriesOpen(false)}
        />
      )}

      <Modal
        open={reportCommentsOpen && Boolean(selected)}
        onClose={() => setReportCommentsOpen(false)}
        title="Report header comments"
        description={selected ? `${selected.Name ?? 'Unnamed report'} · ${selected.ID}` : undefined}
        width="max-w-3xl"
        footer={<Button type="button" size="sm" onClick={() => setReportCommentsOpen(false)}>Close</Button>}
      >
        <ReportCommentsList
          items={reportComments && reportComments.reportId === selected?.ID ? reportComments.items : null}
          loading={reportCommentsLoading}
          error={reportCommentsError}
        />
      </Modal>

      <Modal
        open={reportExceptionsOpen && Boolean(selected?.HasException)}
        onClose={() => setReportExceptionsOpen(false)}
        title="Report exceptions"
        description={selected ? `${selected.Name ?? 'Unnamed report'} · ${selected.ID}` : undefined}
        width="max-w-3xl"
        footer={<Button type="button" size="sm" onClick={() => setReportExceptionsOpen(false)}>Close</Button>}
      >
        <ReportExceptionsList
          items={reportExceptions && reportExceptions.reportId === selected?.ID ? reportExceptions.items : null}
          loading={reportExceptionsLoading}
          error={reportExceptionsError}
        />
      </Modal>

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

function reportSortValue(report: ExpenseReport, key: ReportSortKey): string | number | null {
  switch (key) {
    case 'name': return report.Name ?? null;
    case 'owner': return report.OwnerName ?? report.OwnerLoginID ?? null;
    case 'approval': return report.ApprovalStatusName ?? report.ApprovalStatusCode ?? null;
    case 'payment': return report.PaymentStatusName ?? report.PaymentStatusCode ?? null;
    case 'total': return report.Total ?? null;
    case 'submitted': return report.SubmitDate ?? null;
    case 'created': return report.CreateDate ?? null;
  }
}

function SortableReportHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: ReportSortKey;
  sort: { key: ReportSortKey; direction: SortDirection } | null;
  onSort: (key: ReportSortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort?.key === sortKey;
  const direction = active ? sort.direction : null;
  const nextDirection = direction === 'asc' ? 'descending' : 'ascending';
  return (
    <th
      scope="col"
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label} ${nextDirection}`}
        className={`inline-flex w-full items-center gap-1 whitespace-nowrap rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${align === 'right' ? 'justify-end' : 'justify-start'}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={active ? 'text-primary' : 'text-muted-foreground/60'}>
          {direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}
        </span>
      </button>
    </th>
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
    <div className="flex min-h-56 flex-1 flex-col items-center justify-center px-6 py-12 text-center">
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

function SummaryMetric({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t pt-3 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
      <dl className="grid gap-1.5">{children}</dl>
    </section>
  );
}

function CollapsibleDetailSection({
  title,
  children,
  defaultOpen = false,
  tone = 'neutral',
  badge,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  tone?: 'neutral' | 'blue';
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const blue = tone === 'blue';
  return (
    <section className={`overflow-hidden rounded-md border ${blue ? 'border-blue-200 bg-blue-50/55 dark:border-blue-900 dark:bg-blue-950/25' : 'bg-card'}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
        className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${blue ? 'hover:bg-blue-100/60 dark:hover:bg-blue-900/30' : 'hover:bg-accent/50'}`}
      >
        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${blue ? 'text-blue-700 dark:text-blue-300' : 'text-muted-foreground'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={`flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${blue ? 'text-blue-700 dark:text-blue-300' : 'text-muted-foreground'}`}>{title}</span>
        {badge && (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${blue ? 'border-blue-200 bg-white/70 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300' : 'border-border bg-muted text-muted-foreground'}`}>
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className={`border-t px-3 py-3 animate-fade-in ${blue ? 'border-blue-200/80 dark:border-blue-900/80' : 'border-border'}`}>
          {children}
        </div>
      )}
    </section>
  );
}

function ReportCommentsList({
  items,
  loading,
  error,
}: {
  items: ReportCommentV4[] | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground" role="status">Loading report header comments…</p>;
  }
  if (error) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
        Comments v4 is unavailable: {error}
      </p>
    );
  }
  if (!items?.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No report-header comments were returned.</p>;
  }
  return (
    <ol className="max-h-[60vh] space-y-3 overflow-auto pr-1" aria-label="Report header comment list">
      {items.map((comment, index) => {
        const details = [
          ['Created', fmtDateTime(comment.creationDate)],
          ['Author employee ID', comment.author?.employeeId],
          ['Author UUID', comment.author?.employeeUuid],
          ['Created for employee ID', comment.createdForEmployee?.employeeId ?? comment.createdForEmployeeId],
          ['Created for employee UUID', comment.createdForEmployee?.employeeUuid],
          ['Expense ID', comment.expenseId],
          ['Workflow step ID', comment.stepInstanceId],
        ].filter((detail): detail is [string, string] => typeof detail[1] === 'string' && detail[1].trim() !== '');
        return (
          <li key={`${comment.stepInstanceId ?? comment.creationDate ?? 'comment'}-${index}`} className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Comment {index + 1}</span>
              {comment.isAuditorComment && <Badge tone="primary">Auditor</Badge>}
              {comment.isLatest && <Badge tone="success">Latest</Badge>}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
              {comment.comment?.trim() || 'Empty comment'}
            </p>
            {details.length > 0 && (
              <dl className="mt-3 grid gap-x-5 gap-y-2 border-t pt-3 text-xs sm:grid-cols-2">
                {details.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 break-all text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ReportExceptionsList({
  items,
  loading,
  error,
}: {
  items: ReportExceptionV4[] | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground" role="status">Loading report exceptions…</p>;
  }
  if (error) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
        Exceptions v4 is unavailable: {error}
      </p>
    );
  }
  if (!items?.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No report-header exceptions were returned.</p>;
  }
  return (
    <ul className="max-h-[60vh] space-y-3 overflow-auto pr-1" aria-label="Report exception list">
      {items.map((exception, index) => {
        const details = [
          ['Visibility', exception.exceptionVisibility],
          ['Expense ID', exception.expenseId],
          ['Parent expense ID', exception.parentExpenseId],
          ['Allocation ID', exception.allocationId],
        ].filter((detail): detail is [string, string] => typeof detail[1] === 'string' && detail[1].trim() !== '');
        return (
          <li key={`${exception.exceptionCode ?? 'exception'}-${index}`} className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-foreground">{exception.exceptionCode?.trim() || 'Unknown code'}</span>
              <Badge tone={exception.isBlocking ? 'destructive' : 'warning'}>
                {exception.isBlocking ? 'Blocking' : 'Warning'}
              </Badge>
            </div>
            {exception.message?.trim() && <p className="mt-2 text-sm leading-6 text-foreground">{exception.message}</p>}
            {details.length > 0 && (
              <dl className="mt-3 grid gap-x-5 gap-y-2 border-t pt-3 text-xs sm:grid-cols-2">
                {details.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 break-all font-mono text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReportDetailsPanel({
  report,
  entriesResult,
  entriesLoading,
  entriesError,
  reportV4,
  reportV4Loading,
  reportV4Error,
  reportExceptions,
  reportExceptionsLoading,
  reportExceptionsError,
  reportCommentsLoading,
  references,
  onRetrieveEntries,
  onViewEntries,
  onViewExceptions,
  onRetrieveComments,
}: {
  report: ExpenseReport | null;
  entriesResult: EntriesResult | null;
  entriesLoading: boolean;
  entriesError: string | null;
  reportV4: ExpenseReportV4 | null;
  reportV4Loading: boolean;
  reportV4Error: string | null;
  reportExceptions: ReportExceptionV4[] | null;
  reportExceptionsLoading: boolean;
  reportExceptionsError: string | null;
  reportCommentsLoading: boolean;
  references: ReportReferences;
  onRetrieveEntries: (report: ExpenseReport) => void;
  onViewEntries: () => void;
  onViewExceptions: () => void;
  onRetrieveComments: (report: ExpenseReport) => void;
}) {
  const policyName = report?.PolicyID ? references.policyNameById.get(report.PolicyID) : undefined;
  const v4Sections = report && reportV4 ? reportV4OnlySections(report, reportV4) : [];
  return (
    <aside aria-label="Report details" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
      {!report ? (
        <div className="flex min-h-56 flex-1 flex-col items-center justify-center p-6 text-center">
          <h2 className="text-base font-semibold">No report selected</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Choose a report from the search results to inspect its header details.
          </p>
        </div>
      ) : (
        <>
          <header className="flex min-h-[58px] items-center gap-3 border-b bg-card px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <h2 className="truncate text-sm font-semibold text-foreground">{report.Name ?? 'Unnamed report'}</h2>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{report.ID}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {report.ApprovalStatusName && <Badge tone={report.ApprovalStatusCode === 'A_APPR' ? 'success' : 'primary'}>{report.ApprovalStatusName}</Badge>}
                {report.PaymentStatusName && <Badge tone={report.PaymentStatusCode === 'P_PAID' ? 'success' : 'muted'}>{report.PaymentStatusName}</Badge>}
                {report.HasException && (
                  <button
                    type="button"
                    onClick={onViewExceptions}
                    aria-label="View report exceptions"
                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
                  >
                    <Badge tone="destructive">
                      {reportExceptionsLoading
                        ? 'Exceptions…'
                        : reportExceptions
                          ? `Exceptions (${reportExceptions.length})`
                          : reportExceptionsError ? 'Exceptions unavailable' : 'Exceptions'}
                    </Badge>
                  </button>
                )}
                {report.EverSentBack && <Badge tone="warning">Sent back</Badge>}
                {reportV4 && <Badge tone="primary">Reports v4</Badge>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onRetrieveComments(report)}
                loading={reportCommentsLoading}
              >
                {reportCommentsLoading ? 'Loading…' : 'Comments'}
              </Button>
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
                  size="sm"
                  variant="outline"
                  onClick={() => onRetrieveEntries(report)}
                  loading={entriesLoading}
                  aria-label="Refresh entries"
                  title="Refresh entries"
                >
                  {!entriesLoading && 'Refresh'}
                </Button>
              )}
            </div>
          </header>
          <div aria-label="Scrollable report details" className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
            {reportV4Loading && (
              <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200" role="status">
                Loading additional fields from Reports v4…
              </p>
            )}
            {reportV4Error && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
                Reports v4 enrichment unavailable: {reportV4Error}
              </p>
            )}
            {entriesError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
                {entriesError}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3 rounded-md bg-muted/35 p-3 sm:grid-cols-4">
              <SummaryMetric label="Total" value={fmtAmount(report.Total, report.CurrencyCode)} />
              <SummaryMetric label="Claimed" value={fmtAmount(report.TotalClaimedAmount, report.CurrencyCode)} />
              <SummaryMetric label="Owner" value={report.OwnerName ?? report.OwnerLoginID} />
              <SummaryMetric label="Submitted" value={fmtDate(report.SubmitDate)} />
            </dl>

          <CollapsibleDetailSection key={`${report.ID}-people`} title="People & scope" defaultOpen>
            <dl className="grid gap-1.5">
              <Field label="Owner" value={report.OwnerName} />
              <Field label="Owner login ID" value={report.OwnerLoginID} mono />
              <Field label="Approver" value={report.ApproverName} />
              <Field label="Approver login" value={report.ApproverLoginID} mono />
              <Field label="Country" value={countryLabel(report.Country)} />
              <Field label="Subdivision" value={subdivisionLabel(report.CountrySubdivision)} />
            </dl>
          </CollapsibleDetailSection>
          <CollapsibleDetailSection key={`${report.ID}-amounts`} title="Amounts">
            <dl className="grid gap-1.5">
              <Field label="Total" value={fmtAmount(report.Total, report.CurrencyCode)} />
              <Field label="Claimed" value={fmtAmount(report.TotalClaimedAmount, report.CurrencyCode)} />
              <Field label="Approved amount" value={fmtAmount(report.TotalApprovedAmount, report.CurrencyCode)} />
              <Field label="Due employee" value={fmtAmount(report.AmountDueEmployee, report.CurrencyCode)} />
              <Field label="Due company card" value={fmtAmount(report.AmountDueCompanyCard, report.CurrencyCode)} />
              <Field label="Personal amount" value={fmtAmount(report.PersonalAmount, report.CurrencyCode)} />
            </dl>
          </CollapsibleDetailSection>
          <CollapsibleDetailSection key={`${report.ID}-policy`} title="Policy & workflow">
            <dl className="grid gap-1.5">
              <Field label="Ledger" value={report.LedgerName} />
              <Field label="Policy ID" value={report.PolicyID} mono />
              {policyName && <Field label="Policy name" value={policyName} />}
              <Field label="Receipts received" value={booleanLabel(report.ReceiptsReceived)} />
              <Field label="Last comment" value={report.LastComment} />
            </dl>
          </CollapsibleDetailSection>
          <CollapsibleDetailSection key={`${report.ID}-dates`} title="Dates">
            <dl className="grid gap-1.5">
              <Field label="Created" value={fmtDateTime(report.CreateDate)} />
              <Field label="Submitted" value={fmtDateTime(report.SubmitDate)} />
              <Field label="Processing payment" value={fmtDateTime(report.ProcessingPaymentDate)} />
              <Field label="Paid date" value={fmtDateTime(report.PaidDate)} />
              <Field label="Last modified" value={fmtDateTime(report.LastModifiedDate)} />
              <Field label="User-defined date" value={fmtDate(report.UserDefinedDate)} />
            </dl>
          </CollapsibleDetailSection>
          {customFields(report).length > 0 && <CollapsibleDetailSection key={`${report.ID}-custom`} title="Custom fields">
            <dl className="grid gap-1.5">
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
          </CollapsibleDetailSection>}
          {v4Sections.length > 0 && (
            <CollapsibleDetailSection key={`${report.ID}-v4`} title="Additional fields" tone="blue" badge="Reports v4 only">
              <div aria-label="Reports v4 additional fields" className="space-y-4">
              {v4Sections.map((section) => (
                <div key={section.title} className="border-t border-blue-200/80 pt-3 first:border-t-0 first:pt-0 dark:border-blue-900/80">
                  <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-blue-700/80 dark:text-blue-300/80">{section.title}</h4>
                  <dl className="grid gap-1.5">
                    {section.fields.map((field) => (
                      <div key={`${section.title}-${field.label}`} className="grid grid-cols-[136px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300">{field.label}</dt>
                        <dd className={`min-w-0 break-all text-xs text-blue-950 dark:text-blue-100 ${field.mono ? 'font-mono' : ''}`}>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              </div>
            </CollapsibleDetailSection>
          )}
          </div>
        </>
      )}
    </aside>
  );
}

/** Non-empty OrgUnit1-6 / Custom1-40 fields, in stable order, with the field type when set. */
function customFields(record: ExpenseReport | ExpenseEntry): { label: string; value: string; type?: string }[] {
  const out: { label: string; value: string; type?: string }[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const f = record[`OrgUnit${i}`];
    if (f?.Value) out.push({ label: `Org unit ${i}`, value: f.Code ? `${f.Value} (${f.Code})` : f.Value, type: customFieldTypeCode(f.Type) });
  }
  for (let i = 1; i <= 40; i += 1) {
    const f = record[`Custom${i}`];
    if (f?.Value) out.push({ label: `Custom ${i}`, value: f.Code ? `${f.Value} (${f.Code})` : f.Value, type: customFieldTypeCode(f.Type) });
  }
  return out;
}

/* ── Entries focused workspace ─────────────────────────────────────── */

function EntriesWorkspace({
  report,
  result,
  references,
  onBack,
}: {
  report: ExpenseReport;
  result: EntriesResult;
  references: ReportReferences;
  onBack: () => void;
}) {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(() => result.entries[0]?.ID ?? null);
  const reportName = report.Name ?? 'report';
  const entries = result.entries;
  const selected = entries.find((e) => e.ID === selectedEntryId) ?? null;

  return (
    <section aria-label={`Expense entries for ${reportName}`} className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>← Back to reports</Button>
        <div className="min-w-0 flex-1 border-l pl-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-foreground">{reportName}</h2>
            <span className="font-mono text-[10px] text-muted-foreground">{report.ID}</span>
            {report.ApprovalStatusName && <Badge tone={report.ApprovalStatusCode === 'A_APPR' ? 'success' : 'primary'}>{report.ApprovalStatusName}</Badge>}
            {report.PaymentStatusName && <Badge tone={report.PaymentStatusCode === 'P_PAID' ? 'success' : 'muted'}>{report.PaymentStatusName}</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.OwnerName ?? report.OwnerLoginID ?? 'Unknown owner'} · {fmtAmount(report.Total, report.CurrencyCode)} · {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </p>
        </div>
      </div>

      <div className="grid h-[calc(100vh-17.5rem)] min-h-[500px] gap-3 lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,1.08fr)]">
        <section aria-label="Entry list" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
          <header className="flex min-h-11 items-center justify-between border-b bg-muted/40 px-4 py-2">
            <h2 className="text-sm font-semibold text-foreground">Entries</h2>
            <span className="text-xs text-muted-foreground">{entries.length}{result.hasMore ? '+' : ''}</span>
          </header>
          {entries.length === 0 ? (
            <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
              No entries recorded for this report.
            </p>
          ) : (
            <div aria-label="Scrollable entry list" className="min-h-0 flex-1 overflow-auto">
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
            <p className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              The report has more entries than could be fetched — showing the first {entries.length} records.
            </p>
          )}
        </section>

        <EntryDetails entry={selected} references={references} />
      </div>
    </section>
  );
}

function EntryDetails({ entry, references }: { entry: ExpenseEntry | null; references: ReportReferences }) {
  if (!entry) {
    return (
      <div role="group" aria-label="Entry details" className="flex min-h-0 items-center justify-center rounded-lg border border-dashed bg-card px-4 py-8 text-center shadow-sm">
        <p className="max-w-xs text-sm text-muted-foreground">Select an entry to see all of its populated fields.</p>
      </div>
    );
  }

  const paymentTypeName = entry.PaymentTypeID ? references.paymentTypeNameById.get(entry.PaymentTypeID) : undefined;
  const locationName = entry.LocationID ? references.locationNameById.get(entry.LocationID) : undefined;
  const formName = entry.FormID ? references.formNameById.get(entry.FormID) : undefined;
  const fields = entryDetailFields(entry);
  const referenceFields: DetailField[] = [
    paymentTypeName ? { label: 'Payment type name', value: paymentTypeName } : null,
    locationName ? { label: 'Location name', value: locationName } : null,
    formName ? { label: 'Form name', value: formName } : null,
  ].filter((field): field is DetailField => field !== null);
  const sections = entryFieldSections([...fields, ...referenceFields]);
  return (
    <div role="group" aria-label="Entry details" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
      <header className="border-b bg-card px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Entry detail</p>
            <h3 className="mt-1 truncate text-sm font-semibold text-foreground">
              {entry.ExpenseTypeName ?? entry.ExpenseTypeCode ?? 'Expense entry'}
            </h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{entry.VendorDescription ?? entry.VendorListItemName ?? entry.ID}</p>
          </div>
          <div className="text-right">
            <p className="text-base font-semibold tabular-nums text-foreground">{fmtAmount(entry.TransactionAmount, entry.TransactionCurrencyCode)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{fmtDate(entry.TransactionDate) ?? 'No date'}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {entry.IsPersonal && <Badge tone="warning">Personal</Badge>}
          {entry.HasExceptions && <Badge tone="destructive">Exception</Badge>}
          {entry.HasImage && <Badge tone="muted">Image</Badge>}
        </div>
      </header>
      <div aria-label="Scrollable entry details" className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {sections.map(({ title, fields: sectionFields }) => (
          <DetailSection key={title} title={title}>
            {sectionFields.map(({ label, value, mono, type }) => (
              <div key={label} className="grid grid-cols-[148px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
                <dt className="flex flex-wrap items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                  {type && <Badge tone="muted">{type}</Badge>}
                </dt>
                <dd className={`min-w-0 break-all text-xs text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
              </div>
            ))}
          </DetailSection>
        ))}
      </div>
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

function entryFieldSections(fields: DetailField[]): { title: string; fields: DetailField[] }[] {
  const buckets = {
    Transaction: [] as DetailField[],
    'Vendor & payment': [] as DetailField[],
    'Accounting & controls': [] as DetailField[],
    'Custom fields': [] as DetailField[],
  };

  for (const field of fields) {
    if (field.type) buckets['Custom fields'].push(field);
    else if (/vendor|payment|receipt|image/i.test(field.label)) buckets['Vendor & payment'].push(field);
    else if (/expense type|spend category|transaction|location|exchange rate|posted amount|approved amount/i.test(field.label)) buckets.Transaction.push(field);
    else buckets['Accounting & controls'].push(field);
  }

  return Object.entries(buckets)
    .filter(([, sectionFields]) => sectionFields.length > 0)
    .map(([title, sectionFields]) => ({ title, fields: sectionFields }));
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
