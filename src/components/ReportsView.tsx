import { CSSProperties, FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { fetchAllReports, fetchExpenseAttendeesV4, fetchExpenseCommentsV4, fetchExpenseExceptionsV4, fetchReportById, fetchReportCommentsV4, fetchReportEntries, fetchReportExceptionsV4, fetchReportExpensesV4, fetchReportV4, resolveIdentityUserIdV4, searchReports } from '../api/reportsApi';
import { getUserProfile } from '../api/identityApi';
import { getActiveEntityId } from '../entities/entityStore';
import { loadReportsViewSession, saveReportsViewSession } from './reportsSessionCache';
import { EMPTY_REFERENCES, ensureLocationsLoaded, getReportReferences, loadReportReferences } from './reportsReferences';
import type { ReportReferences } from './reportsReferences';
import type { EntriesResult, ExpenseAttendeeV4, ExpenseEntry, ExpenseReport, ExpenseReportV4, ExpenseV4, ReportCommentV4, ReportExceptionV4, ReportQuery, ReportSearchResult } from '../types';
import { reportV4OnlySections } from './reportV4Fields';
import { expenseV4OnlySections } from './expenseV4Fields';
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
  amount: 'A',
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
  const [expenseTypeCode, setExpenseTypeCode] = useState(cached?.advanced.expenseTypeCode ?? '');
  const [hasImages, setHasImages] = useState<boolean | undefined>(cached?.advanced.hasImages);
  const [hasAttendees, setHasAttendees] = useState<boolean | undefined>(cached?.advanced.hasAttendees);
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
  const [reportComments, setReportComments] = useState<{
    reportId: string;
    items: ReportCommentV4[];
    loginByUserId: Record<string, string>;
  } | null>(null);
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
        expenseTypeCode: expenseTypeCode.trim() || undefined,
        hasImages,
        hasAttendees,
      },
      result,
      lastQuery,
      selectedId,
      entries,
      entriesOpen,
    });
  }, [approvalStatus, country, createdFrom, createdTo, entityId, entries, entriesOpen, expenseTypeCode,
    hasAttendees, hasImages, lastQuery, loginId,
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
    expenseTypeCode: expenseTypeCode.trim() || undefined,
    hasImages,
    hasAttendees,
  };
  const trimmedReportId = reportId.trim();
  const byReportId = trimmedReportId !== '';
  const hasAdvanced = approvalStatus !== '' || paymentStatus !== '' || country !== ''
    || createdFrom !== '' || createdTo !== '' || submittedFrom !== '' || submittedTo !== ''
    || paidFrom !== '' || paidTo !== ''
    || expenseTypeCode.trim() !== '' || hasImages !== undefined || hasAttendees !== undefined;
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
    expenseTypeCode.trim() ? {
      key: 'expense-type',
      label: 'Expense type',
      value: expenseTypeCode.trim(),
      remove: () => setExpenseTypeCode(''),
    } : null,
    hasImages !== undefined ? {
      key: 'has-images',
      label: 'Has images',
      value: hasImages ? 'Yes' : 'No',
      remove: () => setHasImages(undefined),
    } : null,
    hasAttendees !== undefined ? {
      key: 'has-attendees',
      label: 'Has attendees',
      value: hasAttendees ? 'Yes' : 'No',
      remove: () => setHasAttendees(undefined),
    } : null,
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

  useEffect(() => {
    const seq = ++reportCommentsSeq.current;
    setReportComments(null);
    setReportCommentsError(null);
    setReportCommentsOpen(false);
    if (!selected) {
      setReportCommentsLoading(false);
      return;
    }
    setReportCommentsLoading(true);
    void fetchReportCommentsV4(selected.ID)
      .then(async (items) => {
        const userIds = [...new Set(items.flatMap((comment) => [
          comment.author?.employeeUuid?.trim(),
          comment.createdForEmployee?.employeeUuid?.trim(),
        ]).filter((id): id is string => Boolean(id)))];
        const profiles = await Promise.allSettled(userIds.map((id) => getUserProfile(id)));
        if (seq !== reportCommentsSeq.current) return;
        const loginByUserId: Record<string, string> = {};
        profiles.forEach((profile, index) => {
          if (profile.status === 'fulfilled' && profile.value.userName) {
            loginByUserId[userIds[index]] = profile.value.userName;
          }
        });
        setReportComments({ reportId: selected.ID, items, loginByUserId });
      })
      .catch((err) => {
        if (seq !== reportCommentsSeq.current) return;
        setReportCommentsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (seq === reportCommentsSeq.current) setReportCommentsLoading(false);
      });
  }, [selected?.ID]);

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

  // Tri-state select: '' (Any) maps to undefined so the filter is not sent.
  const triState = (
    label: string,
    value: boolean | undefined,
    setValue: (v: boolean | undefined) => void,
  ) => (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select
        aria-label={label}
        value={value === undefined ? '' : String(value)}
        onChange={(e) => setValue(e.target.value === '' ? undefined : e.target.value === 'true')}
        className="h-9"
      >
        <option value="">Any</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    </label>
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
    setExpenseTypeCode('');
    setHasImages(undefined);
    setHasAttendees(undefined);
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
              message="Enter a login ID, or an exact report ID together with the owner’s login ID. Approval/payment status, country, date ranges, images/attendees, and expense type are under Advanced search."
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
          reportComments={reportComments && reportComments.reportId === selected?.ID ? reportComments.items : null}
          reportCommentsLoading={reportCommentsLoading}
          reportCommentsError={reportCommentsError}
          references={references}
          onRetrieveEntries={retrieveEntries}
          onViewEntries={() => setEntriesOpen(true)}
          onViewExceptions={() => setReportExceptionsOpen(true)}
          onViewComments={() => setReportCommentsOpen(true)}
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
          loginByUserId={reportComments?.loginByUserId ?? {}}
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
          <div className="grid gap-2 sm:grid-cols-2">
            {triState('Has images', hasImages, setHasImages)}
            {triState('Has attendees', hasAttendees, setHasAttendees)}
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Expense type code</span>
            <Input
              aria-label="Expense type code"
              value={expenseTypeCode}
              onChange={(e) => setExpenseTypeCode(e.target.value)}
              placeholder="e.g. AIRFR — reports containing at least one entry of this type"
              className="h-9 w-full px-2 text-xs"
            />
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

function Field({
  label,
  value,
  mono = false,
  type,
  source,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
  type?: string;
  source?: 'v3' | 'v4';
}) {
  if (value === undefined || value === null || value === '') return null;
  const fromV4 = source === 'v4';
  const fromV3 = source === 'v3';
  return (
    <div className="grid items-baseline gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'var(--detail-label-width, 168px) minmax(0, 1fr)' }}>
      <dt aria-label={source ? `${label} source ${source}` : undefined} className={`flex flex-wrap items-center gap-1 text-[11px] font-medium uppercase tracking-wide ${fromV4 ? 'text-blue-700 dark:text-blue-300' : fromV3 ? 'text-orange-700 dark:text-orange-300' : 'text-muted-foreground'}`}>
        {label}
        {type && <Badge tone="muted">{type}</Badge>}
        {fromV4 && <span className="rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[9px] font-bold leading-none text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">v4</span>}
        {fromV3 && <span className="rounded border border-orange-200 bg-orange-50 px-1 py-0.5 text-[9px] font-bold leading-none text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300">v3</span>}
      </dt>
      <dd className={`min-w-0 break-all text-xs ${fromV4 ? 'text-blue-950 dark:text-blue-100' : fromV3 ? 'text-orange-950 dark:text-orange-100' : 'text-foreground'} ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function FieldWidthControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center justify-end gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Field width
      <input
        type="range"
        min="144"
        max="260"
        step="4"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
        aria-label="Field label width"
        className="h-1.5 w-28 cursor-ew-resize accent-blue-600"
      />
      <span className="w-9 text-right font-mono normal-case tabular-nums">{value}px</span>
    </label>
  );
}

function detailWidthStyle(width: number): CSSProperties {
  return { '--detail-label-width': `${width}px` } as CSSProperties;
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

function CollapsibleDetailSection({
  title,
  children,
  defaultOpen = false,
  tone = 'neutral',
  badge,
  open: openProp,
  onToggle,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  tone?: 'neutral' | 'blue';
  badge?: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const blue = tone === 'blue';
  const toggle = () => {
    if (onToggle) onToggle();
    if (!controlled) setInternalOpen((value) => !value);
  };
  return (
    <section className={`overflow-hidden rounded-md border ${blue ? 'border-blue-200 bg-blue-50/55 dark:border-blue-900 dark:bg-blue-950/25' : 'bg-card'}`}>
      <button
        type="button"
        onClick={toggle}
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
  loginByUserId,
}: {
  items: ReportCommentV4[] | null;
  loading: boolean;
  error: string | null;
  loginByUserId: Record<string, string>;
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
        const authorUuid = comment.author?.employeeUuid?.trim();
        const createdForUuid = comment.createdForEmployee?.employeeUuid?.trim();
        const details = [
          ['Author login ID', authorUuid ? loginByUserId[authorUuid] : undefined],
          ['Author employee ID', comment.author?.employeeId],
          ['Author UUID', authorUuid],
          ['Created for login ID', createdForUuid ? loginByUserId[createdForUuid] : undefined],
          ['Created for employee ID', comment.createdForEmployee?.employeeId ?? comment.createdForEmployeeId],
          ['Created for employee UUID', createdForUuid],
          ['Expense ID', comment.expenseId],
          ['Workflow step ID', comment.stepInstanceId],
        ].filter((detail): detail is [string, string] => typeof detail[1] === 'string' && detail[1].trim() !== '');
        return (
          <li key={`${comment.stepInstanceId ?? comment.creationDate ?? 'comment'}-${index}`} className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-xs font-semibold text-muted-foreground">Comment {index + 1}</span>
              {fmtDateTime(comment.creationDate) && (
                <time className="text-xs text-muted-foreground" dateTime={comment.creationDate ?? undefined}>
                  {fmtDateTime(comment.creationDate)}
                </time>
              )}
              {comment.isAuditorComment && <Badge tone="primary">Auditor</Badge>}
              {comment.isLatest && <Badge tone="success">Latest</Badge>}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
              {comment.comment?.trim() || 'Empty comment'}
            </p>
            {details.length > 0 && <CommentMetadata commentNumber={index + 1} details={details} />}
          </li>
        );
      })}
    </ol>
  );
}

function CommentMetadata({ commentNumber, details }: { commentNumber: number; details: [string, string][] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} metadata for comment ${commentNumber}`}
        className="flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Details
      </button>
      {open && (
        <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 break-all text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
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
            {details.length > 0 && <ExceptionMetadata exceptionNumber={index + 1} details={details} />}
          </li>
        );
      })}
    </ul>
  );
}

function ExceptionMetadata({ exceptionNumber, details }: { exceptionNumber: number; details: [string, string][] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} details for exception ${exceptionNumber}`}
        className="flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Details
      </button>
      {open && (
        <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 break-all font-mono text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function attendeeName(attendee: ExpenseAttendeeV4): string {
  return [attendee.firstName, attendee.middleInitial, attendee.lastName, attendee.suffix]
    .flatMap((part) => part?.trim() ? [part.trim()] : [])
    .join(' ') || attendee.preferredName?.trim() || attendee.id?.trim() || 'Unknown attendee';
}

function attendeeDetailRows(attendee: ExpenseAttendeeV4): [string, string][] {
  const association = attendee.association;
  const currency = attendee.currencyCode ?? undefined;
  const rows: [string, string | number | boolean | null | undefined][] = [
    ['Title', attendee.title],
    ['Preferred name', attendee.preferredName],
    ['External ID', attendee.externalId],
    ['Attendee ID', attendee.id],
    ['Owner', attendee.ownerName],
    ['Owner user ID', attendee.ownerUserId],
    ['Version', attendee.versionNumber],
    ['Traveling', association.isTraveling],
    ['Amount manually edited', association.isAmountUserEdited],
    ['Associated attendee count', association.associatedAttendeeCount],
    ['Transaction amount', association.transactionAmount?.value === null || association.transactionAmount?.value === undefined
      ? undefined
      : fmtAmount(association.transactionAmount.value, association.transactionAmount.currencyCode ?? currency)],
    ['Approved amount', association.approvedAmount?.value === null || association.approvedAmount?.value === undefined
      ? undefined
      : fmtAmount(association.approvedAmount.value, association.approvedAmount.currencyCode ?? currency)],
    ['Previous-year total', attendee.totalAmountPrevYear === null || attendee.totalAmountPrevYear === undefined
      ? undefined
      : fmtAmount(attendee.totalAmountPrevYear, currency)],
    ['Year-to-date total', attendee.totalAmountYtd === null || attendee.totalAmountYtd === undefined
      ? undefined
      : fmtAmount(attendee.totalAmountYtd, currency)],
    ['Previous-year exceptions', attendee.hasExceptionsPrevYear],
    ['Year-to-date exceptions', attendee.hasExceptionsYtd],
  ];
  for (let index = 1; index <= 25; index += 1) {
    const custom = attendee[`custom${index}`];
    if (custom?.value?.trim()) rows.push([
      `Custom ${index}${custom.type ? ` (${customFieldTypeCode(custom.type)})` : ''}`,
      custom.code ? `${custom.value} (${custom.code})` : custom.value,
    ]);
  }
  for (const custom of association.customData ?? []) {
    if (custom.id?.trim() && custom.value !== null && custom.value !== undefined && String(custom.value).trim()) {
      rows.push([`Association ${custom.id}`, String(custom.value)]);
    }
  }
  return rows.flatMap(([label, value]) => {
    if (value === null || value === undefined || value === '') return [];
    return [[label, typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)]];
  });
}

function AttendeesList({
  attendees,
  noShowAttendeeCount,
  loading,
  error,
}: {
  attendees: ExpenseAttendeeV4[] | null;
  noShowAttendeeCount: number;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground" role="status">Loading attendee details…</p>;
  if (error) {
    return <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">Attendees v4 is unavailable: {error}</p>;
  }
  if (!attendees?.length) return <p className="py-8 text-center text-sm text-muted-foreground">No associated attendees were returned.</p>;
  return (
    <div className="space-y-3">
      {noShowAttendeeCount > 0 && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">No-show attendees: {noShowAttendeeCount}</p>}
      <ol className="max-h-[60vh] space-y-3 overflow-auto pr-1" aria-label="Expense attendee list">
        {attendees.map((attendee, index) => (
          <li key={`${attendee.id ?? 'attendee'}-${index}`} className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-semibold text-foreground">{attendeeName(attendee)}</span>
              <span className="text-xs text-muted-foreground">{attendee.company?.trim() || 'No company'}</span>
              <Badge tone="primary">{attendee.attendeeTypeCode?.trim() || 'Unknown type'}</Badge>
            </div>
            <AttendeeMetadata attendeeNumber={index + 1} details={attendeeDetailRows(attendee)} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function AttendeeMetadata({ attendeeNumber, details }: { attendeeNumber: number; details: [string, string][] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} details for attendee ${attendeeNumber}`}
        className="flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Details
      </button>
      {open && (
        <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
          {details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 break-all text-foreground">{value}</dd></div>)}
        </dl>
      )}
    </div>
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
  reportComments,
  reportCommentsLoading,
  reportCommentsError,
  references,
  onRetrieveEntries,
  onViewEntries,
  onViewExceptions,
  onViewComments,
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
  reportComments: ReportCommentV4[] | null;
  reportCommentsLoading: boolean;
  reportCommentsError: string | null;
  references: ReportReferences;
  onRetrieveEntries: (report: ExpenseReport) => void;
  onViewEntries: () => void;
  onViewExceptions: () => void;
  onViewComments: () => void;
}) {
  const [labelWidth, setLabelWidth] = useState(180);
  const policyName = report?.PolicyID ? references.policyNameById.get(report.PolicyID) : undefined;
  const v4Sections = report && reportV4 ? reportV4OnlySections(report, reportV4) : [];
  const v4FieldsFor = (title: string) => (v4Sections.find((section) => section.title === title)?.fields ?? [])
    .filter((field) => !(title === 'Policy & workflow' && field.label === 'Policy name' && policyName));
  const reportV4CustomIds = new Set((reportV4?.customData ?? []).flatMap((field) => field.id ? [field.id.toLowerCase()] : []));
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
                {report.EverSentBack && <Badge tone="warning">Sent back</Badge>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onViewExceptions}
                disabled={reportExceptionsLoading || !reportExceptions?.length}
                title={reportExceptionsError ?? undefined}
              >
                {reportExceptionsLoading ? 'Exceptions…' : `Exceptions${reportExceptions?.length ? ` (${reportExceptions.length})` : ''}`}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onViewComments}
                disabled={reportCommentsLoading || !reportComments?.length}
                title={reportCommentsError ?? undefined}
              >
                {reportCommentsLoading ? 'Comments…' : `Comments${reportComments?.length ? ` (${reportComments.length})` : ''}`}
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
          <div aria-label="Scrollable report details" className="min-h-0 flex-1 space-y-4 overflow-auto p-4" style={detailWidthStyle(labelWidth)}>
            <FieldWidthControl value={labelWidth} onChange={setLabelWidth} />
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
              <Field label="Owner" value={report.OwnerName} source="v3" />
              <Field label="Owner login ID" value={report.OwnerLoginID} mono source="v3" />
              <Field label="Approver" value={report.ApproverName} source="v3" />
              <Field label="Approver login" value={report.ApproverLoginID} mono source="v3" />
              <Field label="Country" value={countryLabel(report.Country)} />
              <Field label="Subdivision" value={subdivisionLabel(report.CountrySubdivision)} />
              {v4FieldsFor('People & scope').map((field) => <Field key={`v4-${field.label}`} {...field} source="v4" />)}
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
              {v4FieldsFor('Amounts').map((field) => <Field key={`v4-${field.label}`} {...field} source="v4" />)}
            </dl>
          </CollapsibleDetailSection>
          <CollapsibleDetailSection key={`${report.ID}-policy`} title="Policy & workflow">
            <dl className="grid gap-1.5">
              <Field label="Ledger" value={report.LedgerName} />
              <Field label="Policy ID" value={report.PolicyID} mono />
              {policyName && <Field label="Policy name" value={policyName} />}
              <Field label="Receipts received" value={booleanLabel(report.ReceiptsReceived)} />
              <Field label="Last comment" value={report.LastComment} source="v3" />
              {v4FieldsFor('Policy & workflow').map((field) => <Field key={`v4-${field.label}`} {...field} source="v4" />)}
            </dl>
          </CollapsibleDetailSection>
          <CollapsibleDetailSection key={`${report.ID}-dates`} title="Dates">
            <dl className="grid gap-1.5">
              <Field label="Created" value={fmtDateTime(report.CreateDate)} />
              <Field label="Submitted" value={fmtDateTime(report.SubmitDate)} />
              <Field label="Processing payment" value={fmtDateTime(report.ProcessingPaymentDate)} source="v3" />
              <Field label="Paid date" value={fmtDateTime(report.PaidDate)} source="v3" />
              <Field label="Last modified" value={fmtDateTime(report.LastModifiedDate)} source="v3" />
              <Field label="User-defined date" value={fmtDate(report.UserDefinedDate)} />
              {v4FieldsFor('Dates').map((field) => <Field key={`v4-${field.label}`} {...field} source="v4" />)}
            </dl>
          </CollapsibleDetailSection>
          {(customFields(report).length > 0 || v4FieldsFor('Custom fields').length > 0) && <CollapsibleDetailSection key={`${report.ID}-custom`} title="Custom fields">
            <dl className="grid gap-1.5">
              {customFields(report).map((field) => {
                const customId = field.label.replace(/\s+/g, '').toLowerCase();
                return <Field key={field.label} {...field} source={reportV4 && !reportV4CustomIds.has(customId) ? 'v3' : undefined} />;
              })}
              {v4FieldsFor('Custom fields').map((field) => <Field key={`v4-${field.label}`} {...field} source="v4" />)}
            </dl>
          </CollapsibleDetailSection>}
          {v4FieldsFor('Other fields').length > 0 && <CollapsibleDetailSection key={`${report.ID}-other`} title="Other fields">
            <dl className="grid gap-1.5" aria-label="Reports v4 other fields">
              {v4FieldsFor('Other fields').map((field) => <Field key={`v4-${field.label}`} {...field} source="v4" />)}
            </dl>
          </CollapsibleDetailSection>}
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

function expenseLookupKey(id: string | null | undefined): string | undefined {
  return id?.trim().toLowerCase() || undefined;
}

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

  // Expenses v4: all expenses for this report, indexed by v4 expenseId for lookup.
  const [expensesById, setExpensesById] = useState<Record<string, ExpenseV4>>({});
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [expensesError, setExpensesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setExpensesById({});
    setExpensesError(null);
    const loginId = report.OwnerLoginID?.trim();
    if (!loginId) {
      setExpensesLoading(false);
      setExpensesError('Expenses v4 requires the report owner login ID.');
      return;
    }
    setExpensesLoading(true);
    void resolveIdentityUserIdV4(loginId)
      .then((userId) => fetchReportExpensesV4(report.ID, userId))
      .then((expenses) => {
        if (cancelled) return;
        const index: Record<string, ExpenseV4> = {};
        for (const expense of expenses) {
          const id = expenseLookupKey(expense.expenseId);
          if (id) index[id] = expense;
        }
        setExpensesById(index);
      })
      .catch((err) => {
        if (!cancelled) setExpensesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setExpensesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [report.ID, report.OwnerLoginID]);

  const selectedExpenseKey = expenseLookupKey(selected?.ExpenseID);
  const selectedExpense = selectedExpenseKey ? expensesById[selectedExpenseKey] : undefined;

  return (
    <section aria-label={`Expense entries for ${reportName}`} className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
        <Button
          type="button"
          size="sm"
          onClick={onBack}
          className="border border-blue-200 bg-blue-50 text-blue-700 shadow-sm hover:bg-blue-100 active:bg-blue-200 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/70"
        >
          ← Back to reports
        </Button>
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

        <EntryDetails
          entry={selected}
          references={references}
          reportId={report.ID}
          expenseV4={selectedExpense ?? null}
          expenseV4Loading={expensesLoading}
          expenseV4Error={expensesError}
        />
      </div>
    </section>
  );
}

function EntryDetails({
  entry,
  references,
  reportId,
  expenseV4,
  expenseV4Loading,
  expenseV4Error,
}: {
  entry: ExpenseEntry | null;
  references: ReportReferences;
  reportId?: string;
  expenseV4: ExpenseV4 | null;
  expenseV4Loading: boolean;
  expenseV4Error: string | null;
}) {
  const [entryExceptions, setEntryExceptions] = useState<ReportExceptionV4[] | null>(null);
  const [entryExceptionsLoading, setEntryExceptionsLoading] = useState(false);
  const [entryExceptionsError, setEntryExceptionsError] = useState<string | null>(null);
  const [entryExceptionsOpen, setEntryExceptionsOpen] = useState(false);

  const [entryComments, setEntryComments] = useState<ReportCommentV4[] | null>(null);
  const [entryCommentsLoading, setEntryCommentsLoading] = useState(false);
  const [entryCommentsError, setEntryCommentsError] = useState<string | null>(null);
  const [entryCommentsOpen, setEntryCommentsOpen] = useState(false);
  const [entryCommentLogins, setEntryCommentLogins] = useState<Record<string, string>>({});
  const [labelWidth, setLabelWidth] = useState(188);

  const [entryAttendees, setEntryAttendees] = useState<ExpenseAttendeeV4[] | null>(null);
  const [entryAttendeesLoading, setEntryAttendeesLoading] = useState(false);
  const [entryAttendeesError, setEntryAttendeesError] = useState<string | null>(null);
  const [entryAttendeesOpen, setEntryAttendeesOpen] = useState(false);
  const [noShowAttendeeCount, setNoShowAttendeeCount] = useState(0);
  const attendeeRequestRef = useRef(0);

  const entryId = entry?.ID;
  const expenseUuid = entry?.ExpenseID;
  const hasExceptions = Boolean(entry?.HasExceptions);
  const hasComments = Boolean(entry?.HasComments);
  const attendeeCount = expenseV4?.attendeeCount ?? 0;

  useEffect(() => {
    attendeeRequestRef.current += 1;
    setEntryAttendees(null);
    setEntryAttendeesError(null);
    setEntryAttendeesLoading(false);
    setEntryAttendeesOpen(false);
    setNoShowAttendeeCount(0);
  }, [entryId]);

  const openAttendees = () => {
    setEntryAttendeesOpen(true);
    if (entryAttendees || entryAttendeesLoading || !reportId || !expenseUuid || attendeeCount <= 0) return;
    setEntryAttendeesLoading(true);
    setEntryAttendeesError(null);
    const requestId = ++attendeeRequestRef.current;
    void fetchExpenseAttendeesV4(reportId, expenseUuid)
      .then((result) => {
        if (attendeeRequestRef.current !== requestId) return;
        setEntryAttendees(result.attendees);
        setNoShowAttendeeCount(result.noShowAttendeeCount);
      })
      .catch((err) => {
        if (attendeeRequestRef.current === requestId) setEntryAttendeesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (attendeeRequestRef.current === requestId) setEntryAttendeesLoading(false);
      });
  };

  // Load expense-level exceptions only when the v3 entry flags exceptions.
  useEffect(() => {
    let cancelled = false;
    setEntryExceptions(null);
    setEntryExceptionsError(null);
    setEntryExceptionsOpen(false);
    if (!hasExceptions || !reportId || !expenseUuid) {
      setEntryExceptionsLoading(false);
      return;
    }
    setEntryExceptionsLoading(true);
    void fetchExpenseExceptionsV4(reportId, expenseUuid)
      .then((items) => {
        if (!cancelled) setEntryExceptions(items);
      })
      .catch((err) => {
        if (!cancelled) setEntryExceptionsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setEntryExceptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasExceptions, reportId, expenseUuid]);

  // Load expense-level comments only when the v3 entry flags comments.
  useEffect(() => {
    let cancelled = false;
    setEntryComments(null);
    setEntryCommentsError(null);
    setEntryCommentsOpen(false);
    setEntryCommentLogins({});
    if (!hasComments || !reportId || !expenseUuid) {
      setEntryCommentsLoading(false);
      return;
    }
    setEntryCommentsLoading(true);
    void fetchExpenseCommentsV4(reportId, expenseUuid)
      .then(async (items) => {
        const userIds = [...new Set(items.flatMap((comment) => [
          comment.author?.employeeUuid?.trim(),
          comment.createdForEmployee?.employeeUuid?.trim(),
        ]).filter((id): id is string => Boolean(id)))];
        const profiles = await Promise.allSettled(userIds.map((id) => getUserProfile(id)));
        if (cancelled) return;
        const loginByUserId: Record<string, string> = {};
        profiles.forEach((profile, index) => {
          if (profile.status === 'fulfilled' && profile.value.userName) {
            loginByUserId[userIds[index]] = profile.value.userName;
          }
        });
        setEntryCommentLogins(loginByUserId);
        setEntryComments(items);
      })
      .catch((err) => {
        if (!cancelled) setEntryCommentsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setEntryCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasComments, reportId, expenseUuid]);

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
    ...(paymentTypeName ? [{ label: 'Payment type name', value: paymentTypeName, apiKey: 'PaymentTypeName' }] : []),
    ...(locationName ? [{ label: 'Location name', value: locationName, apiKey: 'LocationName' }] : []),
    ...(formName ? [{ label: 'Form name', value: formName, apiKey: 'FormName' }] : []),
  ];
  const v3Sections = entryFieldSections([...fields, ...referenceFields]);
  const v4Sections = expenseV4 ? expenseV4OnlySections(entry, expenseV4) : [];
  const sectionOrder = ['Transaction', 'Amounts', 'Vendor & payment', 'Accounting & controls', 'Custom fields', 'Other fields'];
  const sections = sectionOrder.flatMap((title) => {
    const v3Fields = (v3Sections.find((section) => section.title === title)?.fields ?? [])
      .map((field) => ({ ...field, source: entryV3FieldSource(field, expenseV4) }));
    const v4Fields: DetailField[] = (v4Sections.find((section) => section.title === title)?.fields ?? [])
      .map((field) => ({ ...field, source: 'v4' as const }));
    const sectionFields = [...v3Fields, ...v4Fields];
    return sectionFields.length > 0 ? [{ title, fields: sectionFields }] : [];
  });
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
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {entry.IsPersonal && <Badge tone="warning">Personal</Badge>}
          {entry.HasImage && <Badge tone="muted">Image</Badge>}
          {entry.HasExceptions && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEntryExceptionsOpen(true)}
              disabled={entryExceptionsLoading || !entryExceptions?.length}
              title={entryExceptionsError ?? undefined}
              className="h-6 px-2 text-[11px]"
            >
              {entryExceptionsLoading ? 'Exceptions…' : `Exceptions${entryExceptions?.length ? ` (${entryExceptions.length})` : ''}`}
            </Button>
          )}
          {entry.HasComments && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEntryCommentsOpen(true)}
              disabled={entryCommentsLoading || !entryComments?.length}
              title={entryCommentsError ?? undefined}
              className="h-6 px-2 text-[11px]"
            >
              {entryCommentsLoading ? 'Comments…' : `Comments${entryComments?.length ? ` (${entryComments.length})` : ''}`}
            </Button>
          )}
          {attendeeCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openAttendees}
              className="h-6 px-2 text-[11px]"
            >
              Attendees ({attendeeCount})
            </Button>
          )}
        </div>
      </header>
      <div aria-label="Scrollable entry details" className="min-h-0 flex-1 space-y-4 overflow-auto p-4" style={detailWidthStyle(labelWidth)}>
        <FieldWidthControl value={labelWidth} onChange={setLabelWidth} />
        {expenseV4Loading && (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200" role="status">
            Loading additional fields from Expenses v4…
          </p>
        )}
        {expenseV4Error && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
            Expenses v4 enrichment unavailable: {expenseV4Error}
          </p>
        )}
        {sections.map(({ title, fields: sectionFields }, index) => (
          <CollapsibleDetailSection key={`${entryId}-${title}`} title={title} defaultOpen={index === 0}>
            <dl className="grid gap-1.5" aria-label={`${title} entry fields`}>
              {sectionFields.map((field) => <Field key={`${field.source ?? 'v3'}-${field.label}`} {...field} />)}
            </dl>
          </CollapsibleDetailSection>
        ))}
      </div>

      <Modal
        open={entryExceptionsOpen}
        onClose={() => setEntryExceptionsOpen(false)}
        title="Expense exceptions"
        description={`${entry.ExpenseTypeName ?? entry.ExpenseTypeCode ?? 'Expense entry'} · ${entry.ID}`}
        width="max-w-3xl"
        footer={<Button type="button" size="sm" onClick={() => setEntryExceptionsOpen(false)}>Close</Button>}
      >
        <ReportExceptionsList items={entryExceptions} loading={entryExceptionsLoading} error={entryExceptionsError} />
      </Modal>

      <Modal
        open={entryCommentsOpen}
        onClose={() => setEntryCommentsOpen(false)}
        title="Expense comments"
        description={`${entry.ExpenseTypeName ?? entry.ExpenseTypeCode ?? 'Expense entry'} · ${entry.ID}`}
        width="max-w-3xl"
        footer={<Button type="button" size="sm" onClick={() => setEntryCommentsOpen(false)}>Close</Button>}
      >
        <ReportCommentsList items={entryComments} loading={entryCommentsLoading} error={entryCommentsError} loginByUserId={entryCommentLogins} />
      </Modal>

      <Modal
        open={entryAttendeesOpen}
        onClose={() => setEntryAttendeesOpen(false)}
        title="Expense attendees"
        description={`${entry.ExpenseTypeName ?? entry.ExpenseTypeCode ?? 'Expense entry'} · ${entry.ID}`}
        width="max-w-4xl"
        footer={<Button type="button" size="sm" onClick={() => setEntryAttendeesOpen(false)}>Close</Button>}
      >
        <AttendeesList
          attendees={entryAttendees}
          noShowAttendeeCount={noShowAttendeeCount}
          loading={entryAttendeesLoading}
          error={entryAttendeesError}
        />
      </Modal>
    </div>
  );
}

/* ── Entry field flattening ─────────────────────────────────────────── */

interface DetailField {
  label: string;
  value: string;
  mono?: boolean;
  source?: 'v3' | 'v4';
  apiKey?: string;
  /** Custom/OrgUnit field type, rendered as a badge next to the label. */
  type?: string;
}

const ENTRY_V4_SHARED_KEYS = new Set([
  'ExpenseID', 'ExpenseTypeCode', 'ExpenseTypeName', 'SpendCategoryCode', 'TransactionDate',
  'TransactionAmount', 'PostedAmount', 'ApprovedAmount', 'ExchangeRate', 'VendorDescription',
  'VendorListItemID', 'VendorListItemName', 'LocationID', 'LocationName', 'LocationCountry',
  'LocationSubdivision', 'PaymentTypeID', 'PaymentTypeName', 'IsPersonal', 'HasExceptions',
  'IsImageRequired', 'ReceiptImageID', 'ElectronicReceiptID',
]);

function entryV3FieldSource(field: DetailField, expenseV4: ExpenseV4 | null): 'v3' | undefined {
  if (field.type) {
    if (!expenseV4) return undefined;
    const id = field.label.replace(/\s+/g, '').toLowerCase();
    const existsInV4 = (expenseV4.customData ?? []).some((custom) => custom.id?.toLowerCase() === id);
    return existsInV4 ? undefined : 'v3';
  }
  return field.apiKey && ENTRY_V4_SHARED_KEYS.has(field.apiKey) ? undefined : 'v3';
}

function entryFieldSections(fields: DetailField[]): { title: string; fields: DetailField[] }[] {
  const buckets = {
    Transaction: [] as DetailField[],
    Amounts: [] as DetailField[],
    'Vendor & payment': [] as DetailField[],
    'Accounting & controls': [] as DetailField[],
    'Custom fields': [] as DetailField[],
  };

  for (const field of fields) {
    if (field.type) buckets['Custom fields'].push(field);
    else if (/vendor|payment|receipt|image/i.test(field.label)) buckets['Vendor & payment'].push(field);
    else if (/amount|exchange rate/i.test(field.label)) buckets.Amounts.push(field);
    else if (/expense type|spend category|transaction|location/i.test(field.label)) buckets.Transaction.push(field);
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
          apiKey: key,
        });
      }
      continue;
    }

    out.push({ label: labelFor(key), value: formatScalar(key, raw, entry), mono: MONO_KEYS.test(key), apiKey: key });
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
