import { ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  downloadSpendProfilesCsv,
  getSpendProfileLocalDetail,
  getSpendProfilesProgress,
  getSpendProfilesSummary,
  querySpendProfilesLocal,
  refreshSpendProfilesSnapshot,
} from '../api/spendProfilesApi';
import type {
  ActiveUsersSummary,
  IdentityUserSummary,
  SpendCustomData,
  SpendFilterCondition,
  SpendFilterGroup,
  SpendFilterOperator,
  SpendProfileLocalDetail,
  SpendProfileRow,
  SpendProfilesProgress,
  SpendProfilesSummary,
  SpendUserProfile,
} from '../types';
import { createEntitySessionCache } from '../state/entitySessionCache';
import { Button } from './ui/Button';
import { ColumnResizeHandle, ResizableDetailLayout, useKeyedColumnWidths } from './ui/Resizable';
import { SectionTone, sectionTones } from './sectionTones';
import { useVirtualTableRows, VIRTUAL_TABLE_ROW_HEIGHT } from './useVirtualTableRows';

const SPEND_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const PAGE_SIZE = 200;
const REQUIRED_COLUMNS = ['loginId', 'employeeNumber'] as const;
const IDENTITY_COLUMNS = ['id', 'loginId', 'employeeNumber', 'preferredName', 'email'] as const;

type Sort = { key: string; direction: 1 | -1 };
export type ColumnGroup = 'identity' | 'enterprise' | 'spend' | 'custom';
type SpendColumnGroup = Exclude<ColumnGroup, 'enterprise'>;
export interface DisplayColumn { key: string; label: string; group: ColumnGroup; required?: boolean }

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
  return ({ eq: '=', ne: '≠', contains: 'contains', startsWith: 'starts with', endsWith: 'ends with', empty: 'is empty', notEmpty: 'is not empty' })[operator];
}

export function filterExpression(group: SpendFilterGroup, nested = false): string {
  const expression = group.items.map((item) => {
    if (item.kind === 'group') return filterExpression(item, true);
    const value = item.operator === 'empty' || item.operator === 'notEmpty' ? '' : ` "${item.value}"`;
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
  const querySequence = useRef(0);
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
      setProgress(currentProgress);
      setRetrieving(currentProgress.state === 'running');
    }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [entityId]);

  const allColumns = useMemo<DisplayColumn[]>(() => [
    ...IDENTITY_COLUMNS.map((key) => ({ key, label: humanizeField(key), group: 'identity' as const, required: REQUIRED_COLUMNS.includes(key as typeof REQUIRED_COLUMNS[number]) })),
    ...(summary?.spendFields ?? []).map((key) => ({ key, label: humanizeField(key), group: 'spend' as const })),
    ...(summary?.customFields ?? []).map((key) => ({ key, label: key, group: 'custom' as const })),
  ], [summary]);

  useEffect(() => {
    if (!summary) return;
    setVisibleKeys((current) => current.length ? [...new Set([...REQUIRED_COLUMNS, ...current])] : allColumns.filter((column) => column.key !== 'id').map((column) => column.key));
  }, [allColumns, summary]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFilters(cleanFilters(filters)), 1000);
    return () => window.clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    if (!summary) { setRows([]); setTotal(0); return; }
    let current = true;
    const sequence = ++querySequence.current;
    if (reuseCachedRows.current) {
      reuseCachedRows.current = false;
      setLoading(false);
      return () => { current = false; };
    }
    setLoading(true);
    setError(null);
    void querySpendProfilesLocal({ offset: 0, limit: PAGE_SIZE, filters: debouncedFilters, sortBy: sort.key, sortDir: sort.direction === 1 ? 'asc' : 'desc', includeOrphans })
      .then((result) => {
        if (!current || sequence !== querySequence.current) return;
        setRows(result?.rows ?? []);
        setTotal(result?.total ?? 0);
        setHasMore(result?.hasMore ?? false);
        virtualRows.resetScroll();
        const first = result?.rows[0];
        if (first) void selectRow(first);
      })
      .catch((reason: unknown) => { if (current && sequence === querySequence.current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (current && sequence === querySequence.current) setLoading(false); });
    return () => { current = false; };
  }, [debouncedFilters, includeOrphans, reloadVersion, sort, summary]);

  useEffect(() => {
    spendProfilesWorkspaceSessions.set(entityId, {
      summary, identitySummary, rows, total, hasMore, filters, debouncedFilters, sort,
      visibleKeys, includeOrphans, selectedId, detail, scrollTop: virtualRows.scrollTop,
    });
  }, [debouncedFilters, detail, entityId, filters, hasMore, identitySummary, includeOrphans, rows, selectedId, sort, summary, total, virtualRows.scrollTop, visibleKeys]);

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
        if (next.state === 'complete') {
          const metadata = await getSpendProfilesSummary();
          if (!current) return;
          setSummary(metadata.summary);
          setIdentitySummary(metadata.identitySummary);
          setReloadVersion((value) => value + 1);
          setRetrieving(false);
        } else if (next.state === 'error') {
          setError(next.error ?? 'Spend Profile retrieval failed.');
          setRetrieving(false);
        }
      } catch { /* A transient status failure does not cancel the retrieval. */ }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 500);
    return () => { current = false; window.clearInterval(timer); };
  }, [retrieving]);

  const selectRow = async (row: SpendProfileRow) => {
    setSelectedId(row.id);
    setDetailLoading(true);
    try { setDetail(await getSpendProfileLocalDetail(row.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDetailLoading(false); }
  };

  const retrieve = async () => {
    if (!identitySummary || retrieving) return;
    setRetrieving(true);
    setError(null);
    try {
      setSummary(await refreshSpendProfilesSnapshot());
      setProgress(await getSpendProfilesProgress());
      setReloadVersion((value) => value + 1);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRetrieving(false); }
  };

  const loadMore = async () => {
    if (!hasMore || loading || loadMorePending.current) return;
    const sequence = querySequence.current;
    loadMorePending.current = true;
    setLoadingMore(true);
    try {
      const result = await querySpendProfilesLocal({ offset: rows.length, limit: PAGE_SIZE, filters: debouncedFilters, sortBy: sort.key, sortDir: sort.direction === 1 ? 'asc' : 'desc', includeOrphans });
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

  const exportCsv = async () => {
    if (!summary || exporting) return;
    setExporting(true);
    setError(null);
    try { await downloadSpendProfilesCsv({ filters: debouncedFilters, sortBy: sort.key, sortDir: sort.direction === 1 ? 'asc' : 'desc', columns: visibleKeys, includeOrphans }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setExporting(false); }
  };

  const list = (
    <section aria-label="Spend Profile results" className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm xl:min-h-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-3">
        <Button size="sm" loading={retrieving} disabled={!identitySummary} onClick={() => void retrieve()}>{retrieving ? 'Retrieving…' : 'Retrieve All'}</Button>
        <Button size="sm" variant="outline" loading={exporting} disabled={!summary || !total} onClick={() => void exportCsv()}>{exporting ? 'Exporting…' : 'Export CSV'}</Button>
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
          <FilterGroupEditor root={filters} group={filters} fields={allColumns} depth={0} onChange={setFilters} />
        ) : (
          <div className="flex min-h-7 items-center gap-2 text-xs">
            <span className="font-medium text-muted-foreground">Filter</span>
            <span className="rounded-md border bg-background px-2 py-1 font-mono text-[11px]">{filterExpression(debouncedFilters) || 'No conditions'}</span>
          </div>
        )}
        <div className="mt-2 flex items-center gap-3 border-t pt-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate font-mono">{filterExpression(cleanFilters(filters)) || 'Add conditions to filter any visible or available field.'}</span>
          <span>{conditionCount} condition{conditionCount === 1 ? '' : 's'} · {groupCount} group{groupCount === 1 ? '' : 's'} · {total.toLocaleString()} matches</span>
          {filters.items.length ? <button type="button" className="font-medium text-primary hover:underline" onClick={() => setFilters(emptyFilters())}>Clear all</button> : null}
        </div>
      </div>

      {progress && progress.state !== 'idle' && progress.state !== 'complete' ? <ProgressStrip progress={progress} /> : null}
      {error ? <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{error}</div> : null}
      {!identitySummary ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <h2 className="text-sm font-semibold">User Profiles snapshot required</h2>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">Retrieve and save the complete User Profiles snapshot for this entity before retrieving Spend Profiles.</p>
        </div>
      ) : !summary && !loading ? (
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
            <label className="ml-auto inline-flex items-center gap-1.5"><input type="checkbox" checked={includeOrphans} onChange={(event) => setIncludeOrphans(event.target.checked)} />Show profiles without User Profile</label>
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
                      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((current) => ({ key: column.key, direction: current.key === column.key ? (current.direction === 1 ? -1 : 1) : 1 }))}>
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
  const noValue = condition.operator === 'empty' || condition.operator === 'notEmpty';
  return <div className="grid grid-cols-[minmax(130px,1fr)_120px_minmax(130px,1.4fr)_auto] gap-1.5">
    <select aria-label={`Field for condition ${condition.id}`} value={condition.field} onChange={(event) => onChange((current) => ({ ...current, field: event.target.value }))} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs">{fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select>
    <select aria-label={`Operator for condition ${condition.id}`} value={condition.operator} onChange={(event) => onChange((current) => ({ ...current, operator: event.target.value as SpendFilterOperator }))} className="h-8 rounded-md border bg-background px-2 text-xs">
      <option value="eq">equals</option><option value="ne">not equal</option><option value="contains">contains</option><option value="startsWith">starts with</option><option value="endsWith">ends with</option><option value="empty">is empty</option><option value="notEmpty">is not empty</option>
    </select>
    <input aria-label={`Value for condition ${condition.id}`} value={condition.value} disabled={noValue} onChange={(event) => onChange((current) => ({ ...current, value: event.target.value }))} placeholder={noValue ? 'No value required' : 'Value'} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs disabled:bg-muted" />
    <button type="button" aria-label="Remove filter condition" className="h-8 rounded-md px-2 text-xs text-destructive hover:bg-destructive/5" onClick={onRemove}>Remove</button>
  </div>;
}

function ProgressStrip({ progress }: { progress: SpendProfilesProgress }) {
  const label = progress.state === 'running' ? 'Retrieving spend profiles' : progress.state === 'error' ? 'Retrieval failed' : 'Snapshot complete';
  return <div className={`border-b px-3 py-2 ${progress.state === 'error' ? 'bg-destructive/5' : 'bg-emerald-50/70'}`} role="status">
    <div className="mb-1 flex items-center gap-2 text-[11px]"><span className="font-semibold text-emerald-700">{label}</span><span className="text-muted-foreground">{progress.retrievedCount.toLocaleString()}{progress.totalResults !== null ? ` of ${progress.totalResults.toLocaleString()}` : ''} profiles · Page {progress.pageCount.toLocaleString()} · {progress.itemsPerPage} per request · elapsed {formatElapsed(progress.elapsedMs)}</span><span className="ml-auto font-semibold text-emerald-700">{progress.percent}%</span></div>
    <div role="progressbar" aria-label="Spend Profile retrieval progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
  </div>;
}

export function LocalSpendDetail({ detail, loading }: { detail: SpendProfileLocalDetail | null; loading: boolean }) {
  if (loading) return <aside aria-label="Local Spend Profile details" className="flex min-h-[420px] items-center justify-center rounded-lg border bg-card text-xs text-muted-foreground">Loading local snapshots…</aside>;
  if (!detail) return <aside aria-label="Local Spend Profile details" className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border bg-card px-6 text-center"><h2 className="text-sm font-semibold">No profile selected</h2><p className="mt-1 text-xs text-muted-foreground">Select a row to inspect its local Identity and Spend Profile snapshots.</p></aside>;
  const identity = detail.identity;
  const spend = detail.spend?.[SPEND_USER_SCHEMA];
  const customData = spend?.customData ?? [];
  const enterprise = identity?.[ENTERPRISE_USER_SCHEMA];
  const name = identity?.preferredName ?? identity?.displayName ?? identity?.name?.formatted ?? identity?.userName ?? detail.spend?.id ?? 'Unknown user';
  return <aside aria-label="Local Spend Profile details" className="min-h-[420px] min-w-0 overflow-auto rounded-lg border bg-card p-4 shadow-sm xl:min-h-0">
    <div className="mb-4 border-b pb-3"><h2 className="text-base font-semibold">{name}</h2><p className="mt-0.5 break-all text-xs text-muted-foreground">{identity?.userName ?? 'No local Login ID'}</p><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{identity?.id ?? detail.spend?.id}</p><p className="mt-2 text-[11px] text-emerald-700">Local snapshots · no Concur API call on selection</p></div>
    <div className="space-y-3">
      <DetailSection title="Identity profile" tone="blue"><DetailField label="Login ID" value={identity?.userName} /><DetailField label="Preferred name" value={identity?.preferredName ?? identity?.displayName} /><DetailField label="First name" value={identity?.name?.givenName} /><DetailField label="Last name" value={identity?.name?.familyName} /><DetailField label="Email" value={primaryEmail(identity)} /></DetailSection>
      <DetailSection title="Enterprise profile" tone="violet"><DetailField label="Employee ID" value={enterprise?.employeeNumber} /><DetailField label="Cost center" value={enterprise?.costCenter} /><DetailField label="Start date" value={enterprise?.startDate} /></DetailSection>
      {detail.spend ? <DetailSection title="Spend user fields" tone="emerald">{spend ? Object.entries(spend).filter(([key]) => key !== 'customData').map(([key, value]) => <DetailField key={key} label={humanizeField(key)} value={displayValue(value)} />) : null}</DetailSection> : null}
      {detail.spend ? <DetailSection title={`Custom data (${customData.length})`} tone="amber" defaultOpen><div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5">{customData.map((item: SpendCustomData, index: number) => <div key={`${item.id ?? 'custom'}-${index}`} className="contents"><span className="font-mono text-[10px] text-muted-foreground">{item.id ?? '—'}</span><span className="break-all text-xs">{item.value || '—'}</span></div>)}</div></DetailSection> : null}
      {detail.spend ? <DetailSection title="Roles and preferences" tone="indigo"><pre className="whitespace-pre-wrap break-all text-[10px] text-muted-foreground">{JSON.stringify(otherSpendSections(detail.spend), null, 2)}</pre></DetailSection> : null}
    </div>
  </aside>;
}

function DetailSection({ title, tone, defaultOpen = false, children }: { title: string; tone: SectionTone; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const colors = sectionTones[tone];
  return <section className={`overflow-hidden rounded-md border ${colors.section}`}><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)} className={`flex w-full items-center justify-between px-3 py-2 text-left ${colors.header}`}><span className={`text-xs font-semibold uppercase tracking-wide ${colors.title}`}>{title}</span><span aria-hidden="true">{open ? '−' : '+'}</span></button>{open ? <div id={id} className={`border-t p-3 ${colors.body}`}><dl className="grid gap-1.5">{children}</dl></div> : null}</section>;
}
function DetailField({ label, value }: { label: string; value?: string | number | null }) { if (value === undefined || value === null || value === '') return null; return <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-x-3"><dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="min-w-0 break-all text-xs">{value}</dd></div>; }
function displayValue(value: unknown): string { if (value === null || value === undefined) return ''; if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value); return JSON.stringify(value); }
function primaryEmail(identity: IdentityUserSummary | null) { return identity?.emails?.find((email) => email.type === 'work')?.value ?? identity?.emails?.[0]?.value; }
function otherSpendSections(profile: SpendUserProfile) { return Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'id' && key !== 'schemas' && key !== 'meta' && key !== SPEND_USER_SCHEMA)); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function formatElapsed(milliseconds: number) { const seconds = Math.floor(milliseconds / 1000); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${remainder}s`].filter(Boolean).join(' '); }
