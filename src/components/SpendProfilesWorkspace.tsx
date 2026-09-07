import { useEffect, useMemo, useRef, useState } from 'react';
import {
  downloadSpendProfilesCsv,
  getSpendProfileLocalDetail,
  getSpendProfilesBrowseProgress,
  getSpendProfilesProgress,
  getSpendProfilesSummary,
  querySpendProfilesLocal,
  refreshSpendProfilesSnapshot,
  restartSpendProfilesSnapshot,
  resumeSpendProfilesBrowseIndex,
  resumeSpendProfilesSnapshot,
} from '../api/spendProfilesApi';
import type {
  ActiveUsersSummary,
  IdentityUserSummary,
  SpendCustomData,
  SpendApproverEntry,
  SpendFilterCondition,
  SpendFilterGroup,
  SpendFilterOperator,
  SpendProfileLocalDetail,
  SpendProfileRow,
  SpendProfilesProgress,
  SpendProfilesBrowseProgress,
  SpendProfilesSummary,
  SpendUserProfile,
} from '../types';
import { createEntitySessionCache } from '../state/entitySessionCache';
import { Button } from './ui/Button';
import { ColumnResizeHandle, ResizableDetailLayout, useKeyedColumnWidths } from './ui/Resizable';
import { ProfileDetailField, ProfileDetailsHeader, ProfileDetailSection, profileDetailsPanelClass, ProfileDetailsState } from './ProfileDetailsUI';
import { UserReferenceDetails, useResolvedUserReferences, type UserReferenceResolution } from './UserReferenceDetails';
import { useVirtualTableRows, VIRTUAL_TABLE_ROW_HEIGHT } from './useVirtualTableRows';

const SPEND_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const SPEND_APPROVER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Approver';
const ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const PAGE_SIZE = 200;
const REQUIRED_COLUMNS = ['loginId', 'employeeNumber'] as const;
const IDENTITY_COLUMNS = ['id', 'loginId', 'employeeNumber', 'preferredName', 'email'] as const;

type Sort = { key: string; direction: 1 | -1 };
export type ColumnGroup = 'identity' | 'enterprise' | 'spend' | 'custom';
type SpendColumnGroup = Exclude<ColumnGroup, 'enterprise'>;
export interface DisplayColumn { key: string; label: string; group: ColumnGroup; required?: boolean; filterType?: 'text' | 'boolean' | 'date' }

interface SpendProfilesWorkspaceSession {
  summary: SpendProfilesSummary | null;
  identitySummary: ActiveUsersSummary | null;
  rows: SpendProfileRow[];
  total: number;
  hasMore: boolean;
  filters: SpendFilterGroup;
  debouncedFilters: SpendFilterGroup;
  sort: Sort;
  visibleKeys: string[];
  includeOrphans: boolean;
  selectedId: string | null;
  detail: SpendProfileLocalDetail | null;
  scrollTop: number;
  source: 'latest' | 'complete';
  provisional: boolean;
}

const spendProfilesWorkspaceSessions = createEntitySessionCache<SpendProfilesWorkspaceSession>();

export function resetSpendProfilesWorkspaceSessions(): void {
  spendProfilesWorkspaceSessions.clear();
}

let filterSequence = 0;
function filterId(prefix: string) { filterSequence += 1; return `${prefix}-${filterSequence}`; }
export function emptyFilters(): SpendFilterGroup { return { id: 'root', kind: 'group', logic: 'and', items: [] }; }
function newCondition(field: string): SpendFilterCondition { return { id: filterId('condition'), kind: 'condition', field, operator: 'eq', value: '' }; }
function newGroup(field: string): SpendFilterGroup { return { id: filterId('group'), kind: 'group', logic: 'or', items: [newCondition(field), newCondition(field)] }; }

function humanizeField(value: string): string {
  const known: Record<string, string> = {
    id: 'ID', loginId: 'Login ID', employeeNumber: 'Employee ID', preferredName: 'Preferred Name', email: 'Email',
  };
  return known[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase());
}

export function cleanFilters(group: SpendFilterGroup): SpendFilterGroup {
  return {
    ...group,
    items: group.items.reduce<Array<SpendFilterCondition | SpendFilterGroup>>((items, item) => {
      if (item.kind === 'group') {
        const nested = cleanFilters(item);
        if (nested.items.length) items.push(nested);
      } else if (item.operator === 'empty' || item.operator === 'notEmpty' || item.value.trim()) {
        items.push(item);
      }
      return items;
    }, []),
  };
}

export function countConditions(group: SpendFilterGroup): number {
  return group.items.reduce((count, item) => count + (item.kind === 'group' ? countConditions(item) : 1), 0);
}

export function countGroups(group: SpendFilterGroup): number {
  return 1 + group.items.reduce((count, item) => count + (item.kind === 'group' ? countGroups(item) : 0), 0);
}

function operatorText(operator: SpendFilterOperator): string {
  return ({ eq: '=', ne: '≠', contains: 'contains', startsWith: 'starts with', endsWith: 'ends with', empty: 'is empty', notEmpty: 'is not empty', before: 'before', after: 'after' })[operator];
}

export function filterExpression(group: SpendFilterGroup, nested = false): string {
  const expression = group.items.map((item) => {
    if (item.kind === 'group') return filterExpression(item, true);
    const displayValue = item.field === 'active' ? item.value === 'true' ? 'Yes' : item.value === 'false' ? 'No' : item.value : item.value;
    const value = item.operator === 'empty' || item.operator === 'notEmpty' ? '' : ` "${displayValue}"`;
    return `${humanizeField(item.field).toUpperCase()} ${operatorText(item.operator)}${value}`;
  }).join(` ${group.logic.toUpperCase()} `);
  return nested && expression ? `(${expression})` : expression;
}

function updateGroup(root: SpendFilterGroup, groupId: string, update: (group: SpendFilterGroup) => SpendFilterGroup): SpendFilterGroup {
  if (root.id === groupId) return update(root);
  return { ...root, items: root.items.map((item) => item.kind === 'group' ? updateGroup(item, groupId, update) : item) };
}

function updateCondition(root: SpendFilterGroup, conditionId: string, update: (condition: SpendFilterCondition) => SpendFilterCondition): SpendFilterGroup {
  return {
    ...root,
    items: root.items.map((item) => item.kind === 'group' ? updateCondition(item, conditionId, update) : item.id === conditionId ? update(item) : item),
  };
}

function removeItem(root: SpendFilterGroup, itemId: string): SpendFilterGroup {
  return { ...root, items: root.items.filter((item) => item.id !== itemId).map((item) => item.kind === 'group' ? removeItem(item, itemId) : item) };
}

export function SpendProfilesWorkspace({ entityId }: { entityId: string }) {
  const [cached] = useState(() => spendProfilesWorkspaceSessions.get(entityId));
  const [summary, setSummary] = useState<SpendProfilesSummary | null>(cached?.summary ?? null);
  const [identitySummary, setIdentitySummary] = useState<ActiveUsersSummary | null>(cached?.identitySummary ?? null);
  const [progress, setProgress] = useState<SpendProfilesProgress | null>(null);
  const [rows, setRows] = useState<SpendProfileRow[]>(cached?.rows ?? []);
  const [total, setTotal] = useState(cached?.total ?? 0);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
  const [filters, setFilters] = useState<SpendFilterGroup>(cached?.filters ?? emptyFilters());
  const [debouncedFilters, setDebouncedFilters] = useState<SpendFilterGroup>(cached?.debouncedFilters ?? emptyFilters());
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [sort, setSort] = useState<Sort>(cached?.sort ?? { key: 'loginId', direction: 1 });
  const [visibleKeys, setVisibleKeys] = useState<string[]>(cached?.visibleKeys ?? []);
  const [includeOrphans, setIncludeOrphans] = useState(cached?.includeOrphans ?? false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const spendWidths = useKeyedColumnWidths();
  const [loading, setLoading] = useState(!cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(cached?.selectedId ?? null);
  const [detail, setDetail] = useState<SpendProfileLocalDetail | null>(cached?.detail ?? null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [source, setSource] = useState<'latest' | 'complete'>(cached?.source ?? 'latest');
  const [browseProgress, setBrowseProgress] = useState<SpendProfilesBrowseProgress | null>(null);
  const [provisional, setProvisional] = useState(cached?.provisional ?? false);
  const querySequence = useRef(0);
  const selectedIdRef = useRef(cached?.selectedId ?? null);
  const viewableCountRef = useRef(0);
  const loadMorePending = useRef(false);
  const loadMoreRef = useRef<() => void>(() => undefined);
  const reuseCachedRows = useRef(Boolean(cached));
  const virtualRows = useVirtualTableRows({
    rowCount: rows.length,
    headerHeight: 58,
    initialScrollTop: cached?.scrollTop ?? 0,
    onNearEnd: () => loadMoreRef.current(),
  });

  useEffect(() => {
    let current = true;
    void Promise.all([getSpendProfilesSummary(), getSpendProfilesProgress()]).then(([metadata, currentProgress]) => {
      if (!current) return;
      setSummary(metadata.summary);
      setIdentitySummary(metadata.identitySummary);
      if (metadata.summary?.generation && metadata.summary.browseIndexState) setBrowseProgress({
        state: metadata.summary.browseIndexState,
        sourceGeneration: metadata.summary.generation,
        browseGeneration: metadata.summary.browseGeneration,
        phase: metadata.summary.browseIndexPhase,
        percent: metadata.summary.browseIndexPercent ?? 0,
        error: metadata.summary.browseIndexError,
      });
      setProgress(currentProgress);
      viewableCountRef.current = currentProgress.viewableCount ?? 0;
      if ((currentProgress.viewableCount ?? 0) > 0 && currentProgress.state !== 'complete') setReloadVersion((value) => value + 1);
      setRetrieving(currentProgress.state === 'running' || currentProgress.state === 'retrying' || currentProgress.state === 'finalizing');
    }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [entityId]);

  useEffect(() => {
    if (!browseProgress || browseProgress.state !== 'running') return;
    let current = true;
    const poll = async () => {
      try {
        const next = await getSpendProfilesBrowseProgress();
        if (!current) return;
        setBrowseProgress(next);
        if (next.state === 'complete') {
          const metadata = await getSpendProfilesSummary();
          if (!current) return;
          setSummary(metadata.summary);
          setIdentitySummary(metadata.identitySummary);
          setProvisional(false);
          setReloadVersion((value) => value + 1);
        }
      } catch { /* Local browse indexing continues when one progress poll fails. */ }
    };
    const timer = window.setInterval(() => { void poll(); }, 1000);
    return () => { current = false; window.clearInterval(timer); };
  }, [browseProgress?.sourceGeneration, browseProgress?.state]);

  useEffect(() => {
    if (!summary?.generation || !browseProgress || browseProgress.state === 'complete') return;
    const cleared = emptyFilters();
    setFilters(cleared);
    setDebouncedFilters(cleared);
    setSort({ key: 'loginId', direction: 1 });
  }, [browseProgress?.sourceGeneration, browseProgress?.state, summary?.generation]);

  const spendFieldSignature = (progress?.spendFields ?? []).join('\0');
  const customFieldSignature = (progress?.customFields ?? []).join('\0');
  const allColumns = useMemo<DisplayColumn[]>(() => [
    ...IDENTITY_COLUMNS.map((key) => ({ key, label: humanizeField(key), group: 'identity' as const, required: REQUIRED_COLUMNS.includes(key as typeof REQUIRED_COLUMNS[number]) })),
    ...[...new Set([...(summary?.spendFields ?? []), ...(progress?.spendFields ?? [])])].map((key) => ({ key, label: humanizeField(key), group: 'spend' as const })),
    ...[...new Set([...(summary?.customFields ?? []), ...(progress?.customFields ?? [])])].map((key) => ({ key, label: key, group: 'custom' as const })),
  ], [customFieldSignature, spendFieldSignature, summary]);

  useEffect(() => {
    if (!summary && !(progress?.viewableCount ?? 0)) return;
    setVisibleKeys((current) => current.length ? [...new Set([...REQUIRED_COLUMNS, ...current])] : allColumns.filter((column) => column.key !== 'id').map((column) => column.key));
  }, [allColumns, progress?.viewableCount, summary]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFilters(cleanFilters(filters)), 1000);
    return () => window.clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    if (!summary && !(progress?.viewableCount ?? 0)) { setRows([]); setTotal(0); return; }
    let current = true;
    const sequence = ++querySequence.current;
    if (reuseCachedRows.current) {
      reuseCachedRows.current = false;
      setLoading(false);
      return () => { current = false; };
    }
    setLoading(true);
    setError(null);
    void querySpendProfilesLocal({ offset: 0, limit: PAGE_SIZE, filters: debouncedFilters, sortBy: sort.key, sortDir: sort.direction === 1 ? 'asc' : 'desc', includeOrphans, source })
      .then((result) => {
        if (!current || sequence !== querySequence.current) return;
        setRows(result?.rows ?? []);
        setTotal(result?.total ?? 0);
        setHasMore(result?.hasMore ?? false);
        setProvisional(result?.provisional === true);
        virtualRows.resetScroll();
        const first = result?.rows[0];
        if (first && !selectedIdRef.current) void selectRow(first, source);
      })
      .catch((reason: unknown) => { if (current && sequence === querySequence.current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (current && sequence === querySequence.current) setLoading(false); });
    return () => { current = false; };
  }, [debouncedFilters, includeOrphans, progress?.viewableCount, reloadVersion, sort, source, summary]);

  useEffect(() => {
    spendProfilesWorkspaceSessions.set(entityId, {
      summary, identitySummary, rows, total, hasMore, filters, debouncedFilters, sort,
      visibleKeys, includeOrphans, selectedId, detail, scrollTop: virtualRows.scrollTop, source, provisional,
    });
  }, [debouncedFilters, detail, entityId, filters, hasMore, identitySummary, includeOrphans, provisional, rows, selectedId, sort, source, summary, total, virtualRows.scrollTop, visibleKeys]);

  useEffect(() => {
    if (!cached?.scrollTop) return;
    const timer = window.setTimeout(() => {
      if (virtualRows.scrollRef.current) virtualRows.scrollRef.current.scrollTop = cached.scrollTop;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cached, virtualRows.scrollRef]);

  useEffect(() => {
    if (!retrieving) return;
    let current = true;
    const poll = async () => {
      try {
        const next = await getSpendProfilesProgress();
        if (!current) return;
        setProgress(next);
        const viewableCount = next.viewableCount ?? 0;
        if (source === 'latest' && viewableCount > 0 && viewableCount !== viewableCountRef.current) setReloadVersion((value) => value + 1);
        viewableCountRef.current = viewableCount;
        if (next.state === 'complete') {
          const metadata = await getSpendProfilesSummary();
          if (!current) return;
          setSummary(metadata.summary);
          setIdentitySummary(metadata.identitySummary);
          if (metadata.summary?.generation && metadata.summary.browseIndexState) setBrowseProgress({ state: metadata.summary.browseIndexState, sourceGeneration: metadata.summary.generation, browseGeneration: metadata.summary.browseGeneration, phase: metadata.summary.browseIndexPhase, percent: metadata.summary.browseIndexPercent ?? 0, error: metadata.summary.browseIndexError });
          setReloadVersion((value) => value + 1);
          setRetrieving(false);
        } else if (next.state === 'paused' || next.state === 'restart-required') {
          setError(next.error ?? 'Spend Profile retrieval failed.');
          setRetrieving(false);
        }
      } catch { /* A transient status failure does not cancel the retrieval. */ }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 500);
    return () => { current = false; window.clearInterval(timer); };
  }, [retrieving, source]);

  const selectRow = async (row: SpendProfileRow, selectedSource = source) => {
    selectedIdRef.current = row.id;
    setSelectedId(row.id);
    setDetailLoading(true);
    try { setDetail(await getSpendProfileLocalDetail(row.id, selectedSource)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDetailLoading(false); }
  };

  const resumeBrowseIndex = async () => {
    setError(null);
    try { setBrowseProgress(await resumeSpendProfilesBrowseIndex()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const retrieve = async () => {
    if (!identitySummary || retrieving) return;
    setRetrieving(true);
    setSource('latest');
    setError(null);
    try {
      const next = await refreshSpendProfilesSnapshot();
      setProgress(next);
      if (next.state === 'complete') { const metadata = await getSpendProfilesSummary(); setSummary(metadata.summary); setIdentitySummary(metadata.identitySummary); setReloadVersion((value) => value + 1); setRetrieving(false); }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setRetrieving(false); }
  };

  const resume = async () => {
    setRetrieving(true); setSource('latest'); setError(null);
    try { const next = await resumeSpendProfilesSnapshot(); setProgress(next); if (next.state === 'complete') { const metadata = await getSpendProfilesSummary(); setSummary(metadata.summary); setIdentitySummary(metadata.identitySummary); setReloadVersion((value) => value + 1); setRetrieving(false); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setRetrieving(false); }
  };

  const restart = async () => {
    setRetrieving(true); setSource('latest'); setError(null);
    try { const next = await restartSpendProfilesSnapshot(); setProgress(next); if (next.state === 'complete') { const metadata = await getSpendProfilesSummary(); setSummary(metadata.summary); setIdentitySummary(metadata.identitySummary); setReloadVersion((value) => value + 1); setRetrieving(false); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setRetrieving(false); }
  };

  const loadMore = async () => {
    if (!hasMore || loading || loadMorePending.current) return;
    const sequence = querySequence.current;
    loadMorePending.current = true;
    setLoadingMore(true);
    try {
      const result = await querySpendProfilesLocal({ offset: rows.length, limit: PAGE_SIZE, filters: debouncedFilters, sortBy: sort.key, sortDir: sort.direction === 1 ? 'asc' : 'desc', includeOrphans, source });
      if (sequence !== querySequence.current || !result) return;
      setRows((current) => [...current, ...result.rows]);
      setTotal(result.total);
      setHasMore(result.hasMore);
    } catch (reason) { if (sequence === querySequence.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { loadMorePending.current = false; if (sequence === querySequence.current) setLoadingMore(false); }
  };

  loadMoreRef.current = () => { void loadMore(); };

  const activeColumns = allColumns.filter((column) => visibleKeys.includes(column.key));
  const widths = activeColumns.map((column) => spendWidths.widths[column.key] ?? defaultWidth(column));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const visibleRows = rows.slice(virtualRows.range.start, virtualRows.range.end);
  const grouped = {
    identity: activeColumns.filter((column) => column.group === 'identity'),
    spend: activeColumns.filter((column) => column.group === 'spend'),
    custom: activeColumns.filter((column) => column.group === 'custom'),
  };
  const requiredLeft = REQUIRED_COLUMNS.reduce<Record<string, number>>((positions, key, index) => {
    positions[key] = REQUIRED_COLUMNS.slice(0, index).reduce((sum, preceding) => sum + (spendWidths.widths[preceding] ?? defaultWidth(allColumns.find((column) => column.key === preceding))), 0);
    return positions;
  }, {});
  const conditionCount = countConditions(debouncedFilters);
  const groupCount = countGroups(debouncedFilters);
  const hasIncompleteJob = Boolean(progress && progress.state !== 'idle' && progress.state !== 'complete');
  const incomplete = source === 'latest' && Boolean(progress && progress.state !== 'idle' && progress.state !== 'complete' && (progress.viewableCount ?? 0) > 0);
  const browseUnavailable = !incomplete && Boolean(summary?.generation && browseProgress?.state !== 'complete');

  const exportCsv = async () => {
    if (!summary || exporting) return;
    setExporting(true);
    setError(null);
    try { await downloadSpendProfilesCsv({ filters: debouncedFilters, sortBy: sort.key, sortDir: sort.direction === 1 ? 'asc' : 'desc', columns: visibleKeys, includeOrphans, source }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setExporting(false); }
  };

  const list = (
    <section aria-label="Spend Profile results" className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm xl:min-h-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-3">
        <Button size="sm" loading={retrieving} disabled={!identitySummary || hasIncompleteJob} onClick={() => void retrieve()}>{retrieving ? 'Retrieving…' : 'Retrieve All'}</Button>
        {progress?.state === 'paused' ? <Button size="sm" onClick={() => void resume()}>Resume</Button> : null}
        {progress?.state === 'paused' || progress?.state === 'restart-required' ? <Button size="sm" variant="outline" onClick={() => void restart()}>Restart retrieval</Button> : null}
        <Button size="sm" variant="outline" loading={exporting} disabled={!summary || !total || incomplete || browseUnavailable || provisional} onClick={() => void exportCsv()}>{exporting ? 'Exporting…' : 'Export CSV'}</Button>
        {progress && progress.state !== 'complete' && (progress.viewableCount ?? 0) > 0 ? <div className="inline-flex rounded-md border bg-background p-0.5 text-[11px]">
          <button type="button" className={`rounded px-2 py-1 ${source === 'latest' ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => setSource('latest')}>Incomplete retrieval</button>
          {summary ? <button type="button" className={`rounded px-2 py-1 ${source === 'complete' ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => setSource('complete')}>Last complete snapshot</button> : null}
        </div> : null}
        {summary ? <>
          <span className="text-[11px] text-muted-foreground">{summary.count.toLocaleString()} local spend profiles · {formatDate(summary.retrievedAt)}</span>
          <span role="status" className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-emerald-700"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Snapshot ready</span>
        </> : <span className="text-[11px] text-muted-foreground">{identitySummary ? `Identity source ${identitySummary.count.toLocaleString()} users` : 'User Profiles snapshot required'}</span>}
        <div className="relative ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setFiltersOpen((open) => !open)}>{filtersOpen ? 'Collapse filters' : 'Edit filters'}</Button>
          <Button size="sm" variant="outline" onClick={() => setColumnsOpen((open) => !open)}>Manage columns</Button>
          {columnsOpen ? <ColumnChooser columns={allColumns} visibleKeys={visibleKeys} onChange={setVisibleKeys} onClose={() => setColumnsOpen(false)} /> : null}
        </div>
      </div>

      <div className="border-b bg-muted/10 px-3 py-2.5">
        {filtersOpen ? (
          <fieldset disabled={browseUnavailable} className="min-w-0 disabled:opacity-60"><FilterGroupEditor root={filters} group={filters} fields={allColumns} depth={0} onChange={setFilters} /></fieldset>
        ) : (
          <div className="flex min-h-7 items-center gap-2 text-xs">
            <span className="font-medium text-muted-foreground">Filter</span>
            <span className="rounded-md border bg-background px-2 py-1 font-mono text-[11px]">{filterExpression(debouncedFilters) || 'No conditions'}</span>
          </div>
        )}
        <div className="mt-2 flex items-center gap-3 border-t pt-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate font-mono">{filterExpression(cleanFilters(filters)) || 'Add conditions to filter any visible or available field.'}</span>
          <span>{conditionCount} condition{conditionCount === 1 ? '' : 's'} · {groupCount} group{groupCount === 1 ? '' : 's'} · {total.toLocaleString()} matches</span>
          {filters.items.length ? <button type="button" disabled={browseUnavailable} className="font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setFilters(emptyFilters())}>Clear all</button> : null}
        </div>
      </div>

      {progress && progress.state !== 'idle' && progress.state !== 'complete' ? <ProgressStrip progress={progress} /> : null}
      {incomplete ? <div className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">Incomplete data — showing {(progress?.viewableCount ?? 0).toLocaleString()} searchable profiles from {(progress?.downloadedCount ?? progress?.retrievedCount ?? 0).toLocaleString()} downloaded so far. Filters and sorting apply only to these rows; export is disabled.</div> : null}
      {browseUnavailable ? <div className="border-b border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-950" role="status">
        <div className="flex items-center gap-2"><span className="font-medium">Optimizing the local browse index — current order may change.</span><span>{browseProgress?.percent ?? 0}%{browseProgress?.phase ? ` · ${browseProgress.phase}` : ''}{browseProgress?.currentField ? ` · ${humanizeField(browseProgress.currentField)}` : ''}</span>{browseProgress?.state === 'paused' || browseProgress?.state === 'failed' ? <Button size="sm" variant="outline" className="ml-auto" onClick={() => void resumeBrowseIndex()}>Resume local indexing</Button> : null}</div>
        <div role="progressbar" aria-label="Spend Profile browse index progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={browseProgress?.percent ?? 0} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sky-100"><div className="h-full rounded-full bg-sky-600 transition-[width]" style={{ width: `${browseProgress?.percent ?? 0}%` }} /></div>
        {browseProgress?.error ? <p className="mt-1 text-[11px] text-destructive">{browseProgress.error}</p> : null}
      </div> : null}
      {error && error !== progress?.error ? <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{error}</div> : null}
      {summary?.identityStale ? <div className="m-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">Identity snapshot updated — retrieve Spend Profiles to align the local Identity details.</div> : null}
      {!identitySummary ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <h2 className="text-sm font-semibold">User Profiles snapshot required</h2>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">Retrieve and save the complete User Profiles snapshot for this entity before retrieving Spend Profiles.</p>
        </div>
      ) : !summary && !incomplete && !loading ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <h2 className="text-sm font-semibold">Build the Spend Profile snapshot</h2>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">The complete result will be stored locally and joined to the Identity snapshot by user ID.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 border-b bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
            {(['identity', 'spend', 'custom'] as SpendColumnGroup[]).map((group) => {
              const groupColumns = allColumns.filter((column) => column.group === group);
              const allVisible = groupColumns.length > 0 && groupColumns.every((column) => visibleKeys.includes(column.key));
              return <button key={group} type="button" className={`rounded px-1.5 py-0.5 font-medium ${allVisible ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`} onClick={() => setVisibleKeys((current) => {
                const required = new Set<string>(REQUIRED_COLUMNS);
                const groupKeys = new Set(groupColumns.map((column) => column.key));
                return allVisible ? current.filter((key) => !groupKeys.has(key) || required.has(key)) : [...new Set([...current, ...groupKeys])];
              })}>{group === 'identity' ? 'Identity' : group === 'spend' ? 'Spend User' : 'Custom Data'} {grouped[group].length}</button>;
            })}
            <span>{activeColumns.length} of {allColumns.length} columns visible</span>
            <label className="ml-auto inline-flex items-center gap-1.5"><input type="checkbox" checked={includeOrphans} disabled={browseUnavailable} onChange={(event) => setIncludeOrphans(event.target.checked)} />Show profiles without User Profile</label>
            <span>Login ID and Employee ID stay visible</span>
          </div>
          <div ref={virtualRows.scrollRef} aria-label="Spend Profile result list" className="min-h-0 flex-1 overflow-auto" onScroll={virtualRows.onScroll}>
            <table className="table-fixed text-[11px]" style={{ width: Math.max(totalWidth, 960) }} aria-label="Spend Profiles">
              <colgroup>{activeColumns.map((column, index) => <col key={column.key} style={{ width: widths[index] }} />)}</colgroup>
              <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                <tr className="h-7 border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                  {(['identity', 'spend', 'custom'] as SpendColumnGroup[]).map((group) => grouped[group].length ? <th key={group} colSpan={grouped[group].length} className="border-r px-3 text-left font-medium">{group === 'identity' ? 'Local Identity' : group === 'spend' ? 'Spend User' : 'Custom Data'}</th> : null)}
                </tr>
                <tr className="h-9 border-b text-left uppercase tracking-wide text-muted-foreground">
                  {activeColumns.map((column, index) => {
                    const sticky = column.required;
                    return <th key={column.key} scope="col" className={`relative border-r px-2 font-medium ${sticky ? 'sticky z-30 bg-muted' : ''}`} style={sticky ? { left: requiredLeft[column.key] } : undefined}>
                      <button type="button" disabled={browseUnavailable} className="inline-flex items-center gap-1 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setSort((current) => ({ key: column.key, direction: current.key === column.key ? (current.direction === 1 ? -1 : 1) : 1 }))}>
                        {column.label}<span aria-hidden="true">{sort.key === column.key ? (sort.direction === 1 ? '↑' : '↓') : '↕'}</span>
                      </button>
                      <ColumnResizeHandle label={column.label} width={widths[index]} onChange={(width) => spendWidths.setWidth(column.key, width)} onReset={() => spendWidths.resetWidth(column.key)} />
                    </th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {virtualRows.range.topSpacerHeight ? <tr aria-hidden="true" style={{ height: virtualRows.range.topSpacerHeight }}><td colSpan={activeColumns.length} /></tr> : null}
                {visibleRows.map((row) => {
                  const selected = selectedId === row.id;
                  return <tr key={row.id} style={{ height: VIRTUAL_TABLE_ROW_HEIGHT }} className={`cursor-pointer border-b ${selected ? 'bg-primary/10' : 'hover:bg-accent/50'}`} onClick={() => void selectRow(row)}>
                    {activeColumns.map((column) => <td key={column.key} className={`truncate border-r px-2 py-2 ${column.required ? `sticky z-10 ${selected ? 'bg-primary/10' : 'bg-card'} font-mono text-[10px]` : 'text-muted-foreground'}`} style={column.required ? { left: requiredLeft[column.key] } : undefined}>{row.values[column.key] || '—'}</td>)}
                  </tr>;
                })}
                {virtualRows.range.bottomSpacerHeight ? <tr aria-hidden="true" style={{ height: virtualRows.range.bottomSpacerHeight }}><td colSpan={activeColumns.length} /></tr> : null}
                {loading || loadingMore ? <tr><td colSpan={activeColumns.length} className="px-3 py-3 text-center text-xs text-muted-foreground">{loadingMore ? 'Loading more profiles…' : 'Loading local profiles…'}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">Showing {Math.min(rows.length, total).toLocaleString()} of {total.toLocaleString()} matching profiles</div>
        </>
      )}
    </section>
  );

  return <ResizableDetailLayout list={list} detail={<LocalSpendDetail detail={detail} loading={detailLoading} />} label="Resize Spend Profile results and details" initialListPercent={72} />;
}

function defaultWidth(column?: DisplayColumn): number {
  if (!column) return 130;
  if (column.key === 'id') return 170;
  if (column.key === 'loginId' || column.key === 'email') return 210;
  if (column.key === 'employeeNumber') return 140;
  if (column.key === 'preferredName') return 170;
  return Math.max(110, Math.min(190, column.label.length * 9 + 32));
}

export function ColumnChooser({ columns, visibleKeys, onChange, onClose, label = 'Manage Spend Profile columns' }: { columns: DisplayColumn[]; visibleKeys: string[]; onChange: (keys: string[]) => void; onClose: () => void; label?: string }) {
  return <div className="absolute right-0 top-9 z-50 max-h-80 w-72 overflow-auto rounded-md border bg-card p-2 shadow-lg" role="dialog" aria-label={label}>
    <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold">Visible columns</span><button type="button" className="text-xs text-primary" onClick={onClose}>Done</button></div>
    <div className="space-y-1">{columns.map((column) => <label key={column.key} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent/50">
      <input type="checkbox" checked={visibleKeys.includes(column.key)} disabled={column.required} onChange={(event) => onChange(event.target.checked ? [...visibleKeys, column.key] : visibleKeys.filter((key) => key !== column.key))} />
      <span className="min-w-0 flex-1 truncate">{column.label}</span>{column.required ? <span className="text-[10px] text-primary">Always visible</span> : <span className="text-[10px] text-muted-foreground">{column.group}</span>}
    </label>)}</div>
  </div>;
}

export function FilterGroupEditor({ root, group, fields, depth, onChange }: { root: SpendFilterGroup; group: SpendFilterGroup; fields: DisplayColumn[]; depth: number; onChange: (group: SpendFilterGroup) => void }) {
  const firstField = fields[0]?.key ?? 'id';
  const updateThis = (update: (current: SpendFilterGroup) => SpendFilterGroup) => onChange(updateGroup(root, group.id, update));
  return <div className={depth ? 'ml-5 border-l border-dashed border-primary/30 pl-3' : ''}>
    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium">{depth ? 'Match' : `Match ${group.logic === 'and' ? 'ALL' : 'ANY'} groups`}</span>
      <select aria-label={`Logic for filter group ${group.id}`} value={group.logic} onChange={(event) => updateThis((current) => ({ ...current, logic: event.target.value as 'and' | 'or' }))} className="h-7 rounded-md border bg-background px-2 text-xs">
        <option value="and">ALL (AND)</option><option value="or">ANY (OR)</option>
      </select>
      <button type="button" className="text-[11px] font-medium text-primary hover:underline" onClick={() => updateThis((current) => ({ ...current, items: [...current.items, newCondition(firstField)] }))}>Add condition</button>
      {depth < 3 ? <button type="button" className="text-[11px] font-medium text-primary hover:underline" onClick={() => updateThis((current) => ({ ...current, items: [...current.items, newGroup(firstField)] }))}>Add group</button> : null}
      {depth ? <button type="button" className="text-[11px] text-destructive hover:underline" onClick={() => onChange(removeItem(root, group.id))}>Remove group</button> : null}
    </div>
    <div className="space-y-1.5">{group.items.map((item) => item.kind === 'group'
      ? <FilterGroupEditor key={item.id} root={root} group={item} fields={fields} depth={depth + 1} onChange={onChange} />
      : <FilterConditionEditor key={item.id} condition={item} fields={fields} onChange={(update) => onChange(updateCondition(root, item.id, update))} onRemove={() => onChange(removeItem(root, item.id))} />)}</div>
  </div>;
}

function FilterConditionEditor({ condition, fields, onChange, onRemove }: { condition: SpendFilterCondition; fields: DisplayColumn[]; onChange: (update: (condition: SpendFilterCondition) => SpendFilterCondition) => void; onRemove: () => void }) {
  const field = fields.find((candidate) => candidate.key === condition.field);
  const filterType = field?.filterType ?? 'text';
  const noValue = condition.operator === 'empty' || condition.operator === 'notEmpty';
  return <div className="grid grid-cols-[minmax(130px,1fr)_120px_minmax(130px,1.4fr)_auto] gap-1.5">
    <select aria-label={`Field for condition ${condition.id}`} value={condition.field} onChange={(event) => {
      const nextField = fields.find((candidate) => candidate.key === event.target.value);
      const nextType = nextField?.filterType ?? 'text';
      onChange((current) => ({ ...current, field: event.target.value, operator: 'eq', value: nextType === 'boolean' ? 'true' : '' }));
    }} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs">{fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select>
    <select aria-label={`Operator for condition ${condition.id}`} value={condition.operator} onChange={(event) => onChange((current) => ({ ...current, operator: event.target.value as SpendFilterOperator }))} className="h-8 rounded-md border bg-background px-2 text-xs">
      {filterType === 'boolean' ? <option value="eq">is</option> : filterType === 'date' ? <><option value="eq">is</option><option value="before">before</option><option value="after">after</option></> : <><option value="eq">equals</option><option value="ne">not equal</option><option value="contains">contains</option><option value="startsWith">starts with</option><option value="endsWith">ends with</option><option value="empty">is empty</option><option value="notEmpty">is not empty</option></>}
    </select>
    {filterType === 'boolean' ? <select aria-label={`Value for condition ${condition.id}`} value={condition.value || 'true'} onChange={(event) => onChange((current) => ({ ...current, value: event.target.value }))} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs"><option value="true">Yes</option><option value="false">No</option></select> : <input type={filterType === 'date' ? 'date' : 'text'} aria-label={`Value for condition ${condition.id}`} value={condition.value} disabled={noValue} onChange={(event) => onChange((current) => ({ ...current, value: event.target.value }))} placeholder={noValue ? 'No value required' : filterType === 'date' ? undefined : 'Value'} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs disabled:bg-muted" />}
    <button type="button" aria-label="Remove filter condition" className="h-8 rounded-md px-2 text-xs text-destructive hover:bg-destructive/5" onClick={onRemove}>Remove</button>
  </div>;
}

function ProgressStrip({ progress }: { progress: SpendProfilesProgress }) {
  const failed = progress.state === 'paused' || progress.state === 'restart-required';
  const phaseLabel = progress.phase === 'validating' ? 'Validating saved pages' : progress.phase === 'indexing' ? 'Preparing local indexes' : progress.phase === 'committing' ? 'Committing snapshot' : 'Downloading spend profiles';
  const label = progress.state === 'retrying' ? 'Retrying spend profile retrieval' : progress.state === 'restart-required' ? 'Restart required' : progress.state === 'paused' ? 'Retrieval paused' : phaseLabel;
  return <div className={`border-b px-3 py-2 ${failed ? 'bg-destructive/5' : 'bg-emerald-50/70'}`} role="status">
    <div className="mb-1 flex items-center gap-2 text-[11px]"><span className="font-semibold text-emerald-700">{label}</span><span className="text-muted-foreground">{progress.retrievedCount.toLocaleString()}{progress.totalResults !== null ? ` of ${progress.totalResults.toLocaleString()}` : ''} profiles · {(progress.viewableCount ?? 0).toLocaleString()} searchable · Page {progress.pageCount.toLocaleString()}{progress.retryAttempt ? ` · Retry ${progress.retryAttempt}` : ''}{progress.lastCheckpointAt ? ` · Last checkpoint ${formatDate(progress.lastCheckpointAt)}` : ''} · elapsed {formatElapsed(progress.elapsedMs)}</span><span className="ml-auto font-semibold text-emerald-700">{progress.state === 'finalizing' ? `${progress.phasePercent ?? 0}% prepared` : `${progress.percent}% downloaded`}</span></div>
    <div role="progressbar" aria-label="Spend Profile retrieval progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
    {progress.state === 'finalizing' ? <div className="mt-1.5"><div className="mb-1 text-[10px] text-muted-foreground">Download 100% · {phaseLabel} {progress.phasePercent ?? 0}%</div><div role="progressbar" aria-label="Spend Profile snapshot preparation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.phasePercent ?? 0} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500 transition-[width]" style={{ width: `${progress.phasePercent ?? 0}%` }} /></div></div> : null}
    {failed && progress.error ? <p className="mt-1.5 text-[11px] text-destructive">{progress.error}</p> : null}
  </div>;
}

export function LocalSpendDetail({ detail, loading }: { detail: SpendProfileLocalDetail | null; loading: boolean }) {
  if (loading) return <ProfileDetailsState ariaLabel="Local Spend Profile details" title="Loading profile…" description="Reading the saved Identity and Spend Profile snapshots." loading />;
  if (!detail) return <ProfileDetailsState ariaLabel="Local Spend Profile details" title="No profile selected" description="Select a row to inspect its local Identity and Spend Profile snapshots." />;
  return <LocalSpendDetailContent detail={detail} />;
}

function LocalSpendDetailContent({ detail }: { detail: SpendProfileLocalDetail }) {
  const identity = detail.identity;
  const spend = detail.spend?.[SPEND_USER_SCHEMA];
  const customData = spend?.customData ?? [];
  const approvers = detail.spend?.[SPEND_APPROVER_SCHEMA];
  const approverEntries = [...(approvers?.report ?? []), ...(approvers?.request ?? []), ...(approvers?.cashAdvance ?? [])];
  const referenceIds = [spend?.biManager?.value, ...approverEntries.map((entry) => entry.approver?.value)];
  const resolvedReferences = useResolvedUserReferences(referenceIds, detail.identityGeneration);
  const enterprise = identity?.[ENTERPRISE_USER_SCHEMA];
  const name = identity?.preferredName ?? identity?.displayName ?? identity?.name?.formatted ?? identity?.userName ?? detail.spend?.id ?? 'Unknown user';
  return <aside aria-label="Local Spend Profile details" className={profileDetailsPanelClass}>
    <ProfileDetailsHeader
      name={name}
      recordId={identity?.id ?? detail.spend?.id}
      identifiers={[{ label: 'Login ID', value: identity?.userName, mono: true }, { label: 'Employee ID', value: enterprise?.employeeNumber, mono: true }]}
      caption="Local Identity and Spend Profile snapshots"
    />
    <div className="space-y-2.5 p-3">
      <ProfileDetailSection title="Identity profile" defaultOpen><ProfileDetailField label="Login ID" value={identity?.userName} mono /><ProfileDetailField label="Preferred name" value={identity?.preferredName ?? identity?.displayName} /><ProfileDetailField label="First name" value={identity?.name?.givenName} /><ProfileDetailField label="Last name" value={identity?.name?.familyName} /><ProfileDetailField label="Email" value={primaryEmail(identity)} /></ProfileDetailSection>
      <ProfileDetailSection title="Enterprise profile"><ProfileDetailField label="Employee ID" value={enterprise?.employeeNumber} mono /><ProfileDetailField label="Cost center" value={enterprise?.costCenter} /><ProfileDetailField label="Start date" value={enterprise?.startDate} /></ProfileDetailSection>
      {detail.spend ? <ProfileDetailSection title="Spend user fields" defaultOpen>{spend ? Object.entries(spend).filter(([key]) => key !== 'customData' && key !== 'biManager').map(([key, value]) => <ProfileDetailField key={key} label={humanizeField(key)} value={displayValue(value)} />) : null}<UserReferenceDetails label="BI manager" userId={spend?.biManager?.value} resolution={spend?.biManager?.value ? resolvedReferences.get(spend.biManager.value) : undefined} /></ProfileDetailSection> : null}
      {detail.spend ? <ProfileDetailSection title={`Custom data (${customData.length})`}><div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 py-2.5">{customData.map((item: SpendCustomData, index: number) => <div key={`${item.id ?? 'custom'}-${index}`} className="contents"><span className="font-mono text-[10px] text-muted-foreground">{item.id ?? '—'}</span><span className="break-all text-xs">{item.value || '—'}</span></div>)}</div></ProfileDetailSection> : null}
      {approverEntries.length ? <ProfileDetailSection title={`Approvers (${approverEntries.length})`}><LocalApproverReferences approvers={approvers} resolvedReferences={resolvedReferences} /></ProfileDetailSection> : null}
      {detail.spend ? <ProfileDetailSection title="Roles and preferences"><pre className="whitespace-pre-wrap break-all py-2.5 text-[10px] text-muted-foreground">{JSON.stringify(otherSpendSections(detail.spend), null, 2)}</pre></ProfileDetailSection> : null}
    </div>
  </aside>;
}
function LocalApproverReferences({ approvers, resolvedReferences }: { approvers?: SpendUserProfile[typeof SPEND_APPROVER_SCHEMA]; resolvedReferences: Map<string, UserReferenceResolution> }) {
  return <div className="py-1">
    <LocalApproverGroup label="Report" entries={approvers?.report} resolvedReferences={resolvedReferences} />
    <LocalApproverGroup label="Request" entries={approvers?.request} resolvedReferences={resolvedReferences} />
    <LocalApproverGroup label="Cash advance" entries={approvers?.cashAdvance} resolvedReferences={resolvedReferences} />
  </div>;
}
function LocalApproverGroup({ label, entries, resolvedReferences }: { label: string; entries?: SpendApproverEntry[]; resolvedReferences: Map<string, UserReferenceResolution> }) {
  if (!entries?.length) return null;
  return <>{entries.map((entry, index) => {
    const userId = entry.approver?.value;
    return <UserReferenceDetails key={`${userId ?? 'approver'}-${index}`} label={entries.length > 1 ? `${label} ${index + 1}` : label} userId={userId} resolution={userId ? resolvedReferences.get(userId) : undefined} primary={entry.primary} />;
  })}</>;
}
function displayValue(value: unknown): string { if (value === null || value === undefined) return ''; if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value); return JSON.stringify(value); }
function primaryEmail(identity: IdentityUserSummary | null) { return identity?.emails?.find((email) => email.type === 'work')?.value ?? identity?.emails?.[0]?.value; }
function otherSpendSections(profile: SpendUserProfile) { return Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'id' && key !== 'schemas' && key !== 'meta' && key !== SPEND_USER_SCHEMA && key !== SPEND_APPROVER_SCHEMA)); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function formatElapsed(milliseconds: number) { const seconds = Math.floor(milliseconds / 1000); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${remainder}s`].filter(Boolean).join(' '); }
