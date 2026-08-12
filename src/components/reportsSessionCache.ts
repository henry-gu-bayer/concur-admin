import { EntriesResult, ExpenseReport, ReportQuery, ReportSearchResult } from '../types';

/**
 * Session cache for the Reports view: the search parameters plus the fetched
 * result survive page switches (the view unmounts on navigation), but not a
 * browser refresh — sessionStorage lives for the tab session.
 */
export interface ReportsViewSessionState {
  loginId: string;
  reportId: string;
  advanced: Omit<ReportQuery, 'loginId'>;
  result: ReportSearchResult | null;
  /** Kept for the "Load all" follow-up; null after a report-ID lookup. */
  lastQuery: ReportQuery | null;
  selectedId: string | null;
  entries: { reportId: string; result: EntriesResult } | null;
  entriesOpen: boolean;
}

const STORAGE_PREFIX = 'concur-admin:reports-view:';

function storageKey(entityId: string): string {
  return `${STORAGE_PREFIX}${entityId.trim() || 'default'}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function loadReportsViewSession(entityId: string): ReportsViewSessionState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(entityId));
    if (!raw) return null;
    const parsed = asObject(JSON.parse(raw));
    if (!parsed) return null;

    const advanced = asObject(parsed.advanced) as Omit<ReportQuery, 'loginId'> | null;

    const resultObject = asObject(parsed.result);
    const reports = Array.isArray(resultObject?.reports) ? (resultObject.reports as ExpenseReport[]) : null;
    const result: ReportSearchResult | null = resultObject && reports
      ? { reports, hasMore: resultObject.hasMore === true }
      : null;

    const lastQueryObject = asObject(parsed.lastQuery);
    const lastQuery: ReportQuery | null = lastQueryObject ? (lastQueryObject as ReportQuery) : null;

    const entriesObject = asObject(parsed.entries);
    const entriesResultObject = asObject(entriesObject?.result);
    const entriesList = Array.isArray(entriesResultObject?.entries) ? entriesResultObject.entries : null;
    const entries = entriesObject && entriesResultObject && entriesList && typeof entriesObject.reportId === 'string'
      ? { reportId: entriesObject.reportId, result: { entries: entriesList, hasMore: entriesResultObject.hasMore === true } }
      : null;

    const selectedId = asStringOrNull(parsed.selectedId);

    return {
      loginId: asString(parsed.loginId),
      reportId: asString(parsed.reportId),
      advanced: advanced ?? {},
      result,
      // A stale pagination query is only useful when the result can grow.
      lastQuery: lastQuery && result?.hasMore ? lastQuery : null,
      // Drop a selection/entries cache that does not match the restored result.
      selectedId: selectedId && (reports ?? []).some((report) => report.ID === selectedId) ? selectedId : null,
      entries: entries && (reports ?? []).some((report) => report.ID === entries.reportId) ? entries : null,
      entriesOpen: parsed.entriesOpen === true,
    };
  } catch {
    return null;
  }
}

export function saveReportsViewSession(entityId: string, state: ReportsViewSessionState): void {
  try {
    sessionStorage.setItem(storageKey(entityId), JSON.stringify(state));
  } catch {
    // sessionStorage can be unavailable or full; the page must remain usable.
  }
}
