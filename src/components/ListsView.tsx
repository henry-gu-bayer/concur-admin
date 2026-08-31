import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLists, listName, refreshLists, timeAgo } from '../api/listsApi';
import {
  BulkSummary,
  fetchAllListItems,
  getItemsIndex,
  SavedListItemSearchMatch,
  SavedListItemSearchResult,
  searchSavedListItems,
} from '../api/listItemsApi';
import { ConcurList, ItemsIndex, ItemsProgress, ListsSnapshot } from '../types';
import { getActiveEntityId } from '../entities/entityStore';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import { Modal } from './ui/Modal';
import { ItemTree } from './ItemTree';
import { ErrorPanel, LoadingRows } from './ui/AsyncState';
import { listsViewSessions } from './listsSessionCache';

const PAGE_SIZE = 50;
const CATEGORIES = ['All', 'Normal', 'Configuration', 'Vendor', 'Commodity'] as const;

type SortId = 'name' | 'category' | 'levelCount' | 'displayFormat';
type SearchField = 'name' | 'value' | 'code';

interface SortState {
  id: SortId;
  dir: 1 | -1;
}

/**
 * Lists workbench — browses the local snapshot of all Concur lists.
 * Friendly for hundreds of entries: search-as-you-type, category filter,
 * level filter, sortable columns, alphabetical quick-jump, and pagination.
 * List definitions and their item trees are retrieved separately, so a quick
 * list refresh does not unexpectedly trigger a long-running item retrieval.
 */
export function ListsView() {
  const [entityId] = useState(() => getActiveEntityId());
  const [cached] = useState(() => listsViewSessions.get(entityId));
  const [snapshot, setSnapshot] = useState<ListsSnapshot | null>(cached?.snapshot ?? null);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState(cached?.query ?? '');
  const [searchField, setSearchField] = useState<SearchField>(cached?.searchField ?? 'name');
  const [itemSearch, setItemSearch] = useState<SavedListItemSearchResult | null>(null);
  const [searchingItems, setSearchingItems] = useState(false);
  const [itemSearchError, setItemSearchError] = useState<string | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>((cached?.category as (typeof CATEGORIES)[number] | undefined) ?? 'All');
  const [level, setLevel] = useState<string>(cached?.level ?? 'all');
  const [sort, setSort] = useState<SortState>(cached?.sort ?? { id: 'name', dir: 1 });
  const [letter, setLetter] = useState<string | null>(cached?.letter ?? null);
  const [page, setPage] = useState(cached?.page ?? 1);
  const [expandedId, setExpandedId] = useState<string | null>(cached?.expandedId ?? null);
  const [itemsIndex, setItemsIndex] = useState<ItemsIndex | null>(cached?.itemsIndex ?? null);
  const [detailList, setDetailList] = useState<ConcurList | null>(cached?.detailList ?? null);
  const [retrievingAllItems, setRetrievingAllItems] = useState(false);
  const [allItemsProgress, setAllItemsProgress] = useState<ItemsProgress | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsSummary, setItemsSummary] = useState<string | null>(null);

  const loadSnapshot = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
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

  useEffect(() => cached ? undefined : loadSnapshot(), [cached, loadSnapshot]);

  useEffect(() => {
    listsViewSessions.set(entityId, {
      snapshot, itemsIndex, query, searchField, category, level, sort, letter, page, expandedId, detailList,
    });
  }, [category, detailList, entityId, expandedId, itemsIndex, letter, level, page, query, searchField, snapshot, sort]);

  const refreshItemsIndex = useCallback(async () => {
    const next = await getItemsIndex();
    setItemsIndex(next);
    return next;
  }, []);

  const retrieveLists = async () => {
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

  const retrieveAllListItems = async () => {
    if (!snapshot || retrievingAllItems) return;
    const listIds = snapshot.lists.map((list) => list.id);
    if (listIds.length === 0) return;

    setRetrievingAllItems(true);
    setAllItemsProgress(null);
    setItemsError(null);
    setItemsSummary(null);
    const retrieval = { streamError: null as string | null, summary: null as BulkSummary | null };

    try {
      await fetchAllListItems(
        listIds,
        Object.fromEntries(snapshot.lists.map((list) => [list.id, listName(list)])),
        {
          onProgress: setAllItemsProgress,
          onDone: (result) => { retrieval.summary = result; },
          onError: (message) => { retrieval.streamError = message; },
        }
      );
      if (retrieval.streamError) throw new Error(retrieval.streamError);
      if (!retrieval.summary) throw new Error('The item retrieval ended before returning a completion status.');

      await refreshItemsIndex();
      setItemsSummary(
        retrieval.summary.failed > 0
          ? `${retrieval.summary.succeeded} of ${retrieval.summary.total} list item snapshots retrieved; ${retrieval.summary.failed} failed.`
          : `${retrieval.summary.succeeded} list item snapshots are ready locally.`
      );
      if (retrieval.summary.failed > 0) setItemsError('Some list item snapshots could not be retrieved. Retry the incomplete lists from their rows.');
    } catch (e) {
      setItemsError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrievingAllItems(false);
    }
  };

  const lists = useMemo(() => snapshot?.lists ?? [], [snapshot]);
  const itemSearchActive = searchField !== 'name' && query.trim().length >= 2;
  const itemSearchNeedsMoreChars = searchField !== 'name' && query.trim().length > 0 && query.trim().length < 2;

  useEffect(() => {
    if (searchField === 'name' || query.trim().length < 2) {
      setItemSearch(null);
      setItemSearchError(null);
      setSearchingItems(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setSearchingItems(true);
    setItemSearch(null);
    setItemSearchError(null);
    const timer = window.setTimeout(() => {
      void searchSavedListItems(searchField, query.trim(), controller.signal)
        .then((result) => {
          if (!cancelled) setItemSearch(result);
        })
        .catch((e: unknown) => {
          if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
          if (!cancelled) setItemSearchError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setSearchingItems(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchField]);

  /* Available first letters for the quick-jump strip (post search/category). */
  const base = useMemo(() => {
    let out = lists;
    if (category !== 'All') out = out.filter((l) => l.category?.type === category);
    if (level !== 'all') out = out.filter((l) => String(l.levelCount ?? 0) === level);
    if (query.trim() && searchField === 'name') {
      const q = query.toLowerCase();
      out = out.filter((l) => listName(l).toLowerCase().includes(q));
    }
    if (itemSearchActive) {
      const matchingListIds = new Set(itemSearch?.matches.map((match) => match.listId) ?? []);
      out = out.filter((l) => matchingListIds.has(l.id));
    }
    return out;
  }, [lists, category, itemSearch, itemSearchActive, level, query, searchField]);

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
  }, [query, searchField, category, level, letter]);

  const toggleSort = (id: SortId) =>
    setSort((s) => (s.id === id ? { id, dir: s.dir === 1 ? -1 : 1 } : { id, dir: 1 }));

  const sortArrow = (id: SortId) => (sort.id === id ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');

  if (loading) {
    return <LoadingRows label="Loading lists" rows={10} />;
  }

  if (error && !snapshot) {
    return <ErrorPanel title="Couldn't load lists" message={error} onRetry={() => { loadSnapshot(); }} />;
  }

  return (
    <div>
      {/* ── Toolbar: search + filters + retrieval actions ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={searchField} onChange={(e) => setSearchField(e.target.value as SearchField)} aria-label="Search lists by" className="w-auto">
          <option value="name">List name</option>
          <option value="value">Item value</option>
          <option value="code">Item code</option>
        </Select>

        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchField === 'name' ? 'Search list names…' : `Search saved item ${searchField}s…`}
            aria-label="Search lists"
            className="pl-9"
          />
        </div>

        {searchField !== 'name' && (
          <span className="hidden text-xs text-muted-foreground lg:block">Item searches use saved local snapshots only</span>
        )}

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

        <div className="ml-auto flex items-center gap-2">
          {snapshot && (
            <span className="hidden text-xs text-muted-foreground sm:block" title={new Date(snapshot.retrievedAt).toLocaleString()}>
              {filtered.length} of {snapshot.count} lists · retrieved {timeAgo(snapshot.retrievedAt)}
            </span>
          )}
          <Button variant="outline" size="sm" loading={refreshing} disabled={retrievingAllItems} onClick={retrieveLists}>
            {!refreshing && (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {refreshing ? 'Retrieving lists…' : 'Retrieve Lists'}
          </Button>
          <Button variant="outline" size="sm" loading={retrievingAllItems} disabled={refreshing || !snapshot} onClick={retrieveAllListItems}>
            {retrievingAllItems ? 'Retrieving items…' : 'Retrieve All List Items'}
          </Button>
        </div>
      </div>

      {refreshing && (
        <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" role="status" aria-live="polite">
          <div className="flex items-center gap-2">
            <Spinner />
            Retrieving list definitions and saving the local snapshot…
          </div>
          <RetrievalProgressBar label="List retrieval progress" />
        </div>
      )}

      {retrievingAllItems && (
        <ItemRetrievalProgress progress={allItemsProgress} totalLists={lists.length} label="Retrieving all list items and child lists" />
      )}

      {itemsSummary && !retrievingAllItems && (
        <div className="mb-3 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success" role="status">
          {itemsSummary}
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          Refresh failed: {error}
        </div>
      )}

      {itemsError && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          List item retrieval failed: {itemsError}
        </div>
      )}

      {itemSearchError && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          Local item search failed: {itemSearchError}
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
      {itemSearchNeedsMoreChars ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
          <h2 className="text-base font-semibold">Enter at least 2 characters</h2>
          <p className="mt-1 text-sm text-muted-foreground">Value and code searches use only the item snapshots saved locally.</p>
        </div>
      ) : itemSearchActive && searchingItems ? (
        <LocalItemSearchProgress searchField={searchField} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
          <h2 className="text-base font-semibold">No lists match</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {itemSearchActive ? 'No saved item snapshots match this search.' : 'Try a different search or clear the filters.'}
          </p>
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
                  <th scope="col" className="w-11 px-2 py-1.5"><span className="sr-only">Inspect</span></th>
                  <th scope="col" aria-sort={sort.id === 'name' ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className="p-0 sm:pl-2">
                    <button type="button" onClick={() => toggleSort('name')} className="w-full px-4 py-1.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4">
                      Name{sortArrow('name')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={sort.id === 'category' ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className="hidden p-0 md:table-cell">
                    <button type="button" onClick={() => toggleSort('category')} className="w-full px-4 py-1.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Category{sortArrow('category')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={sort.id === 'levelCount' ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className="p-0">
                    <button type="button" onClick={() => toggleSort('levelCount')} className="w-full px-4 py-1.5 text-right hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Levels{sortArrow('levelCount')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={sort.id === 'displayFormat' ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className="hidden p-0 lg:table-cell">
                    <button type="button" onClick={() => toggleSort('displayFormat')} className="w-full px-4 py-1.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Display format{sortArrow('displayFormat')}
                    </button>
                  </th>
                  <th scope="col" className="hidden px-4 py-1.5 xl:table-cell">Search</th>
                  <th scope="col" className="px-4 py-1.5 text-right sm:px-6">Actions</th>
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
                    onItemsSnapshotUpdated={refreshItemsIndex}
                    searchMatch={itemSearch?.matches.find((match) => match.listId === l.id)}
                    searchField={searchField}
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
  onItemsSnapshotUpdated,
  searchMatch,
  searchField,
}: {
  list: ConcurList;
  expanded: boolean;
  onToggle: () => void;
  onShowDetails: () => void;
  itemEntry?: ItemsIndex['lists'][string];
  onItemsSnapshotUpdated: () => Promise<ItemsIndex>;
  searchMatch?: SavedListItemSearchMatch;
  searchField: SearchField;
}) {
  const isConnected = Boolean(list.category?.type && list.category.type !== 'Normal');
  return (
    <Fragment>
      <tr className={`border-b transition-colors last:border-0 hover:bg-accent/50 ${expanded ? 'bg-accent/40' : ''}`}>
        <td className="w-11 px-2 py-1.5 text-center">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggle}
            aria-label={expanded ? 'Collapse list items' : 'Inspect list items'}
            aria-expanded={expanded}
          >
            <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        </td>
        <td className="px-4 py-1.5 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium leading-tight">{listName(list)}</div>
              {searchMatch && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground" title={searchField === 'code' ? (searchMatch.code ?? searchMatch.shortCode) : searchMatch.value}>
                  {searchField === 'code' ? `Code: ${searchMatch.code ?? searchMatch.shortCode ?? '—'}` : `Value: ${searchMatch.value ?? '—'}`}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="hidden px-4 py-1.5 md:table-cell">
          {list.category?.type ? <Badge tone={list.category.type === 'Normal' ? 'muted' : 'primary'}>{list.category.type}</Badge> : '—'}
        </td>
        <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{list.levelCount ?? '—'}</td>
        <td className="hidden px-4 py-1.5 text-muted-foreground lg:table-cell">
          {list.displayFormat ?? '—'}
          {itemEntry && (
            <div className="mt-0.5 text-xs text-muted-foreground/80">
              {itemEntry.count.toLocaleString()} items{itemEntry.truncated ? ' · truncated' : ''}{itemEntry.complete === false && itemEntry.failedChildren ? ` · ${itemEntry.failedChildren} failed branches` : ''}
            </div>
          )}
        </td>
        <td className="hidden px-4 py-1.5 text-muted-foreground xl:table-cell">{list.searchCriteria ?? '—'}</td>
        <td className="px-4 py-1.5 text-right sm:px-6">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onShowDetails}>Details</Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          {/* Semantic category color: connected (external) lists get a sky tint, normal lists stay neutral. */}
          <td colSpan={7} className={`border-t p-0 ${isConnected ? 'bg-sky-50/70 dark:bg-sky-950/20' : 'bg-muted/40'}`}>
            <div className={`border-l-2 px-4 py-4 sm:px-6 animate-fade-in ${isConnected ? 'border-sky-300 dark:border-sky-800' : 'border-border/60'}`}>
              <ListItemsPanel
                list={list}
                complete={itemEntry?.complete === true}
                onSnapshotUpdated={onItemsSnapshotUpdated}
              />
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

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.6-6.3" strokeLinecap="round" />
    </svg>
  );
}

function LocalItemSearchProgress({ searchField }: { searchField: SearchField }) {
  return (
    <div className="rounded-lg border bg-card px-6 py-10" role="status" aria-live="polite">
      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Searching locally saved item {searchField}s…
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Local list item search progress">
        <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
      </div>
    </div>
  );
}

function RetrievalProgressBar({ label, percent }: { label: string; percent?: number }) {
  const determinate = percent !== undefined;
  return (
    <div
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? percent : undefined}
    >
      <div
        className={`h-full rounded-full bg-primary transition-[width] duration-300 ${determinate ? '' : 'animate-pulse'}`}
        style={{ width: determinate ? `${percent}%` : '34%' }}
      />
    </div>
  );
}

function ItemRetrievalProgress({ progress, totalLists, label }: { progress: ItemsProgress | null; totalLists: number; label: string }) {
  const currentList = progress?.listIndex ? `List ${progress.listIndex} of ${progress.listTotal ?? totalLists}` : 'Preparing retrieval';
  const itemCount = progress?.items ? ` · ${progress.items.toLocaleString()} items found` : '';
  const total = progress?.listTotal ?? totalLists;
  const current = progress?.listIndex;
  const completedPortion = progress?.phase === 'list-done' ? current : current ? current - 0.5 : undefined;
  const percent = completedPortion === undefined || total === 0
    ? undefined
    : Math.min(99, Math.max(5, Math.round((completedPortion / total) * 100)));
  return (
    <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <Spinner />
        <span>
          <span className="font-medium text-foreground">{label}</span>
          <span className="ml-1">{currentList}{progress?.listName ? `: ${progress.listName}` : ''}{itemCount}</span>
        </span>
        {percent !== undefined && <span className="ml-auto shrink-0 font-semibold tabular-nums text-primary">{percent}%</span>}
      </div>
      <RetrievalProgressBar label="List item retrieval progress" percent={percent} />
    </div>
  );
}

/** Retrieves one complete item tree before mounting the cached tree browser. */
function ListItemsPanel({
  list,
  complete,
  onSnapshotUpdated,
}: {
  list: ConcurList;
  complete: boolean;
  onSnapshotUpdated: () => Promise<ItemsIndex>;
}) {
  const [refreshing, setRefreshing] = useState(!complete);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ItemsProgress | null>(null);
  const [ready, setReady] = useState(complete);
  // Bump to force the tree to remount (and re-read the fresh cache) after refresh.
  const [generation, setGeneration] = useState(0);
  const retrievalStarted = useRef(false);

  const retrieveItems = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    setProgress(null);
    let streamError: string | null = null;
    let finished = false;
    try {
      await fetchAllListItems([list.id], { [list.id]: listName(list) }, {
        onProgress: setProgress,
        onDone: (summary) => {
          finished = true;
          if (summary.failed > 0) streamError = 'The complete item tree could not be retrieved. Please try again.';
        },
        onError: (message) => { streamError = message; },
      });
      if (streamError) throw new Error(streamError);
      if (!finished) throw new Error('The item retrieval ended before returning a completion status.');

      const index = await onSnapshotUpdated();
      const entry = index.lists[list.id];
      if (!entry?.complete) {
        throw new Error(entry?.failedChildren
          ? `${entry.failedChildren} child branch${entry.failedChildren === 1 ? '' : 'es'} could not be retrieved. Please try again.`
          : 'The complete item tree is not available locally yet. Please try again.');
      }
      setReady(true);
      setGeneration((g) => g + 1);
    } catch (e) {
      setReady(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [list, onSnapshotUpdated]);

  useEffect(() => {
    if (complete || retrievalStarted.current) return;
    retrievalStarted.current = true;
    void retrieveItems();
  }, [complete, retrieveItems]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          List items
          <span className="ml-2 font-normal normal-case text-muted-foreground/70">(complete local snapshot)</span>
        </h3>
        <Button variant="outline" size="sm" loading={refreshing} onClick={retrieveItems} title="Retrieve every child list and item from Concur">
          {refreshing ? 'Retrieving…' : 'Retrieve again'}
        </Button>
      </div>

      {refreshing && (
        <ItemRetrievalProgress progress={progress} totalLists={1} label={`Retrieving ${listName(list)} items and child lists`} />
      )}

      {error && (
        <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {ready && <ItemTree key={`${list.id}-${generation}`} listId={list.id} />}
    </div>
  );
}
