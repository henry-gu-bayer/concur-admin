import { Fragment, useEffect, useMemo, useState } from 'react';
import { getLists, listName, refreshLists, timeAgo } from '../api/listsApi';
import { getItemsIndex, refreshListItems } from '../api/listItemsApi';
import { ConcurList, ItemsIndex, ListsSnapshot } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import { Modal } from './ui/Modal';
import { ItemTree } from './ItemTree';

const PAGE_SIZE = 50;
const CATEGORIES = ['All', 'Normal', 'Configuration', 'Vendor', 'Commodity'] as const;

type SortId = 'name' | 'category' | 'levelCount' | 'displayFormat';

interface SortState {
  id: SortId;
  dir: 1 | -1;
}

/**
 * Lists workbench — browses the local snapshot of all Concur lists.
 * Friendly for hundreds of entries: search-as-you-type, category filter,
 * level filter, sortable columns, alphabetical quick-jump, and pagination.
 * A Refresh action re-retrieves everything from Concur (paged server-side).
 */
export function ListsView() {
  const [snapshot, setSnapshot] = useState<ListsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const [level, setLevel] = useState<string>('all');
  const [sort, setSort] = useState<SortState>({ id: 'name', dir: 1 });
  const [letter, setLetter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [itemsIndex, setItemsIndex] = useState<ItemsIndex | null>(null);
  const [detailList, setDetailList] = useState<ConcurList | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLists()
      .then((d) => !cancelled && setSnapshot(d))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    getItemsIndex()
      .then((d) => !cancelled && setItemsIndex(d))
      .catch(() => undefined); // index is best-effort; the table works without it
    return () => {
      cancelled = true;
    };
  }, []);

  const doRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      setSnapshot(await refreshLists());
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const lists = useMemo(() => snapshot?.lists ?? [], [snapshot]);

  /* Available first letters for the quick-jump strip (post search/category). */
  const base = useMemo(() => {
    let out = lists;
    if (category !== 'All') out = out.filter((l) => l.category?.type === category);
    if (level !== 'all') out = out.filter((l) => String(l.levelCount ?? 0) === level);
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter(
        (l) =>
          listName(l).toLowerCase().includes(q) ||
          l.id.toLowerCase().includes(q) ||
          (l.displayFormat ?? '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [lists, category, level, query]);

  const letters = useMemo(() => {
    const set = new Set<string>();
    for (const l of base) {
      const c = listName(l).charAt(0).toUpperCase();
      set.add(/[A-Z]/.test(c) ? c : '#');
    }
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').filter((c) => set.has(c));
  }, [base]);

  const filtered = useMemo(() => {
    let out = base;
    if (letter) {
      out = out.filter((l) => {
        const c = listName(l).charAt(0).toUpperCase();
        return (letter === '#' ? !/[A-Z]/.test(c) : c === letter);
      });
    }
    const dir = sort.dir;
    return [...out].sort((a, b) => {
      let r = 0;
      if (sort.id === 'name') r = listName(a).localeCompare(listName(b));
      else if (sort.id === 'category') r = (a.category?.type ?? '').localeCompare(b.category?.type ?? '');
      else if (sort.id === 'levelCount') r = (a.levelCount ?? 0) - (b.levelCount ?? 0);
      else if (sort.id === 'displayFormat') r = (a.displayFormat ?? '').localeCompare(b.displayFormat ?? '');
      return r * dir;
    });
  }, [base, letter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset to page 1 whenever the result set changes shape.
  useEffect(() => {
    setPage(1);
  }, [query, category, level, letter]);

  const toggleSort = (id: SortId) =>
    setSort((s) => (s.id === id ? { id, dir: s.dir === 1 ? -1 : 1 } : { id, dir: 1 }));

  const sortArrow = (id: SortId) => (sort.id === id ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');

  if (loading) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card" aria-busy="true" aria-label="Loading lists">
        <div className="border-b bg-muted/50 px-4 py-3 sm:px-6">
          <div className="h-3 w-48 rounded bg-muted-foreground/20 animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]" />
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0 sm:px-6">
            <div className="h-4 flex-1 rounded bg-muted animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]" />
            <div className="hidden h-5 w-24 rounded-full bg-muted md:block" />
            <div className="h-4 w-10 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-16 text-center" role="alert">
        <h2 className="text-base font-semibold text-destructive">Couldn't load lists</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" className="mt-5" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* ── Toolbar: search + filters + refresh ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, ID, or format…"
            aria-label="Search lists"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border bg-card p-1" role="group" aria-label="Filter by category">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                category === c ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by level count" className="w-auto">
          <option value="all">All levels</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={String(n)}>{n} level{n > 1 ? 's' : ''}</option>
          ))}
        </Select>

        <div className="ml-auto flex items-center gap-3">
          {snapshot && (
            <span className="hidden text-xs text-muted-foreground sm:block" title={new Date(snapshot.retrievedAt).toLocaleString()}>
              {filtered.length} of {snapshot.count} lists · retrieved {timeAgo(snapshot.retrievedAt)}
            </span>
          )}
          <Button variant="outline" size="sm" loading={refreshing} onClick={doRefresh}>
            {!refreshing && (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {refreshing ? 'Retrieving…' : 'Retrieve again'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          Refresh failed: {error}
        </div>
      )}

      {/* ── Alphabetical quick-jump ── */}
      {letters.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-0.5" aria-label="Jump to first letter">
          <button
            onClick={() => setLetter(null)}
            aria-pressed={letter === null}
            className={`rounded px-2 py-1 text-xs font-medium ${letter === null ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
          >
            All
          </button>
          {'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map((c) => {
            const has = letters.includes(c);
            const active = letter === c;
            return (
              <button
                key={c}
                disabled={!has}
                onClick={() => setLetter(active ? null : c)}
                aria-pressed={active}
                className={`rounded px-1.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? 'bg-primary text-primary-foreground' : has ? 'text-foreground hover:bg-accent' : 'cursor-not-allowed text-muted-foreground/30'
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Main stage: the lists table ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
          <h2 className="text-base font-semibold">No lists match</h2>
          <p className="mt-1 text-sm text-muted-foreground">Try a different search or clear the filters.</p>
          <Button variant="outline" size="sm" className="mt-5" onClick={() => { setQuery(''); setCategory('All'); setLevel('all'); setLetter(null); }}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <table className="w-full text-sm" aria-label="Concur lists">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="cursor-pointer select-none px-4 py-3 hover:text-foreground sm:px-6" onClick={() => toggleSort('name')}>
                    Name{sortArrow('name')}
                  </th>
                  <th scope="col" className="hidden cursor-pointer select-none px-4 py-3 hover:text-foreground md:table-cell" onClick={() => toggleSort('category')}>
                    Category{sortArrow('category')}
                  </th>
                  <th scope="col" className="cursor-pointer select-none px-4 py-3 text-right hover:text-foreground" onClick={() => toggleSort('levelCount')}>
                    Levels{sortArrow('levelCount')}
                  </th>
                  <th scope="col" className="hidden cursor-pointer select-none px-4 py-3 hover:text-foreground lg:table-cell" onClick={() => toggleSort('displayFormat')}>
                    Display format{sortArrow('displayFormat')}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 xl:table-cell">Search</th>
                  <th scope="col" className="px-4 py-3 text-right sm:px-6"><span className="sr-only">Expand</span></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((l) => (
                  <ListRow
                    key={l.id}
                    list={l}
                    expanded={expandedId === l.id}
                    onToggle={() => setExpandedId((c) => (c === l.id ? null : l.id))}
                    onShowDetails={() => setDetailList(l)}
                    itemEntry={itemsIndex?.lists[l.id]}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <span className="px-2 text-xs text-muted-foreground">
                Page {currentPage} of {pageCount}
              </span>
              <Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ── List details popup ── */}
      <ListDetailsModal list={detailList} onClose={() => setDetailList(null)} />
    </div>
  );
}

function ListRow({
  list,
  expanded,
  onToggle,
  onShowDetails,
  itemEntry,
}: {
  list: ConcurList;
  expanded: boolean;
  onToggle: () => void;
  onShowDetails: () => void;
  itemEntry?: ItemsIndex['lists'][string];
}) {
  return (
    <Fragment>
      {/* Clicking the row expands the list items inline; details open in a popup. */}
      <tr onClick={onToggle} aria-expanded={expanded} className={`cursor-pointer border-b transition-colors last:border-0 hover:bg-accent/50 ${expanded ? 'bg-accent/40' : ''}`}>
        <td className="px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <div className="font-medium leading-tight">{listName(list)}</div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">{list.id}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onShowDetails(); }}
              aria-label={`View details for ${listName(list)}`}
              title="List details"
              className="ml-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 [tr:hover_&]:opacity-100"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </td>
        <td className="hidden px-4 py-3 md:table-cell">
          {list.category?.type ? <Badge tone={list.category.type === 'Normal' ? 'muted' : 'primary'}>{list.category.type}</Badge> : '—'}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{list.levelCount ?? '—'}</td>
        <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
          {list.displayFormat ?? '—'}
          {itemEntry && (
            <div className="mt-0.5 text-xs text-muted-foreground/80">
              {itemEntry.count.toLocaleString()} items{itemEntry.truncated ? ' · truncated' : ''}
            </div>
          )}
        </td>
        <td className="hidden px-4 py-3 text-muted-foreground xl:table-cell">{list.searchCriteria ?? '—'}</td>
        <td className="px-4 py-3 text-right sm:px-6">
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            aria-label={expanded ? 'Collapse items' : 'Expand items'}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="border-t bg-muted/40 p-0">
            <div className="px-4 py-4 sm:px-6 animate-fade-in">
              <ListItemsPanel listId={list.id} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** Popup showing a list's metadata. Opened from the per-row info button. */
function ListDetailsModal({ list, onClose }: { list: ConcurList | null; onClose: () => void }) {
  if (!list) return null;
  return (
    <Modal
      open={list !== null}
      onClose={onClose}
      title={listName(list)}
      description={list.category?.type ? `${list.category.type} list` : 'Concur list'}
      width="max-w-2xl"
    >
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        {[
          ['List ID', list.id],
          ['Name', listName(list)],
          ['Category', list.category?.type ?? '—'],
          ['Category ID', list.category?.id ?? '—'],
          ['Levels', String(list.levelCount ?? '—')],
          ['Display format', list.displayFormat ?? '—'],
          ['Search criteria', list.searchCriteria ?? '—'],
          ['Read-only', list.isReadOnly ? 'Yes' : 'No'],
          ['Deleted', list.isDeleted ? 'Yes' : 'No'],
          ['Managed by', list.managedBy ?? 'Concur admin'],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className={`mt-1 break-words text-sm font-medium ${k.includes('ID') ? 'font-mono text-xs' : ''}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

/** Renders one list's lazy-loading item tree, with a full-refresh action. */
function ListItemsPanel({ listId }: { listId: string }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bump to force the tree to remount (and re-read the fresh cache) after refresh.
  const [generation, setGeneration] = useState(0);

  const doRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshListItems(listId); // full BFS — re-fetches every level
      setGeneration((g) => g + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          List items
          <span className="ml-2 font-normal normal-case text-muted-foreground/70">(loads as you expand)</span>
        </h3>
        <Button variant="outline" size="sm" loading={refreshing} onClick={doRefresh} title="Re-fetch every level from Concur">
          {refreshing ? 'Refreshing…' : 'Refresh all'}
        </Button>
      </div>

      {error && (
        <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      <ItemTree key={`${listId}-${generation}`} listId={listId} />
    </div>
  );
}
