import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { getLists, listName, refreshLists, timeAgo } from '../api/listsApi';
import { getListsV3, listV3Name, refreshListsV3 } from '../api/listsV3Api';
import {
  BulkSummary,
  fetchAllListItems,
  getItemsIndex,
  SavedListItemSearchMatch,
  SavedListItemSearchResult,
  searchSavedListItems,
} from '../api/listItemsApi';
import { BulkV3Summary, fetchAllListItemsV3, getItemsV3Index } from '../api/listItemsV3Api';
import { ConcurList, ConcurListItemV3, ConcurListV3, ItemsIndex, ItemsProgress, ItemsV3Index, ItemsV3Progress, ListsSnapshot, ListsV3Snapshot } from '../types';
import { getActiveEntityId } from '../entities/entityStore';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import { Modal } from './ui/Modal';
import { ItemTree } from './ItemTree';
import { ItemTreeV3 } from './ItemTreeV3';
import { getListItemsV3 } from '../api/listItemsV3Api';
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

  // v3 state
  const [apiVersion, setApiVersion] = useState<'v4' | 'v3'>(cached?.apiVersion ?? 'v4');
  const [snapshotV3, setSnapshotV3] = useState<ListsV3Snapshot | null>(cached?.snapshotV3 ?? null);
  const [itemsV3Index, setItemsV3Index] = useState<ItemsV3Index | null>(cached?.itemsV3Index ?? null);
  const [allV3ItemsProgress, setAllV3ItemsProgress] = useState<ItemsV3Progress | null>(null);
  const [v3ItemsError, setV3ItemsError] = useState<string | null>(null);
  const [v3ItemsSummary, setV3ItemsSummary] = useState<string | null>(null);

  const [query, setQuery] = useState(cached?.query ?? '');
  const [searchField, setSearchField] = useState<SearchField>(cached?.searchField ?? 'name');
  const [itemSearch, setItemSearch] = useState<SavedListItemSearchResult | null>(null);
  const [searchingItems, setSearchingItems] = useState(false);
  const [itemSearchError, setItemSearchError] = useState<string | null>(null);
  // Search only applies after an explicit trigger (button click or Enter),
  // so the typed query stays separate from the submitted one.
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(cached?.query ?? null);
  const [submittedField, setSubmittedField] = useState<SearchField>(cached?.searchField ?? 'name');
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
    // Also load v3 data
    getListsV3()
      .then((d) => !cancelled && setSnapshotV3(d))
      .catch(() => undefined); // v3 is optional
    getItemsV3Index()
      .then((d) => !cancelled && setItemsV3Index(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => cached ? undefined : loadSnapshot(), [cached, loadSnapshot]);

  useEffect(() => {
    listsViewSessions.set(entityId, {
      snapshot, itemsIndex, query, searchField, category, level, sort, letter, page, expandedId, detailList,
      apiVersion, snapshotV3, itemsV3Index,
    });
  }, [category, detailList, entityId, expandedId, itemsIndex, letter, level, page, query, searchField, snapshot, sort, apiVersion, snapshotV3, itemsV3Index]);

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

    // First ensure v3 lists are loaded (needed for v3 item retrieval)
    let v3ListsLoaded = false;
    if (!snapshotV3) {
      try {
        const v3Data = await refreshListsV3();
        setSnapshotV3(v3Data);
        v3ListsLoaded = true;
      } catch {
        // v3 lists fetch failed, but we can still proceed with v4
      }
    } else {
      v3ListsLoaded = true;
    }

    setRetrievingAllItems(true);
    setAllItemsProgress(null);
    setItemsError(null);
    setItemsSummary(null);
    setV3ItemsError(null);
    setV3ItemsSummary(null);

    const v4Retrieval = { streamError: null as string | null, summary: null as BulkSummary | null };
    const v3Retrieval = { streamError: null as string | null, summary: null as BulkV3Summary | null };

    // Start both v4 and v3 bulk retrievals in parallel
    const v4Promise = fetchAllListItems(
      listIds,
      Object.fromEntries(snapshot.lists.map((list) => [list.id, listName(list)])),
      {
        onProgress: setAllItemsProgress,
        onDone: (result) => { v4Retrieval.summary = result; },
        onError: (message) => { v4Retrieval.streamError = message; },
      }
    );

    const v3Promise = v3ListsLoaded
      ? fetchAllListItemsV3(
          listIds,
          Object.fromEntries(snapshot.lists.map((list) => [list.id, listName(list)])),
          {
            onProgress: setAllV3ItemsProgress,
            onDone: (result) => { v3Retrieval.summary = result; },
            onError: (message) => { v3Retrieval.streamError = message; },
          }
        )
      : Promise.resolve();

    await Promise.allSettled([v4Promise, v3Promise]);

    // Process v4 results
    try {
      if (v4Retrieval.streamError) throw new Error(v4Retrieval.streamError);
      if (v4Retrieval.summary) {
        await refreshItemsIndex();
        const skipped = v4Retrieval.summary.skipped
          ? ` ${v4Retrieval.summary.skipped} already held a complete tree and were left alone.`
          : '';
        setItemsSummary(
          v4Retrieval.summary.failed > 0
            ? `${v4Retrieval.summary.succeeded} of ${v4Retrieval.summary.total} list item snapshots retrieved; ${v4Retrieval.summary.failed} failed.${skipped}`
            : `${v4Retrieval.summary.succeeded} list item snapshots are ready locally.${skipped}`
        );
        if (v4Retrieval.summary.failed > 0) setItemsError('Some list item snapshots could not be retrieved. Retry the incomplete lists from their rows.');
      }
    } catch (e) {
      setItemsError(e instanceof Error ? e.message : String(e));
    }

    // Process v3 results
    try {
      if (v3Retrieval.streamError) throw new Error(v3Retrieval.streamError);
      if (v3Retrieval.summary) {
        const v3Index = await getItemsV3Index();
        setItemsV3Index(v3Index);
        const skipped = v3Retrieval.summary.skipped
          ? ` ${v3Retrieval.summary.skipped} already held a complete snapshot and were left alone.`
          : '';
        setV3ItemsSummary(
          v3Retrieval.summary.failed > 0
            ? `v3: ${v3Retrieval.summary.succeeded} of ${v3Retrieval.summary.total} list item snapshots retrieved; ${v3Retrieval.summary.failed} failed.${skipped}`
            : `v3: ${v3Retrieval.summary.succeeded} list item snapshots are ready locally.${skipped}`
        );
        if (v3Retrieval.summary.failed > 0) setV3ItemsError('Some v3 list item snapshots could not be retrieved.');
      }
    } catch (e) {
      setV3ItemsError(e instanceof Error ? e.message : String(e));
    }

    setRetrievingAllItems(false);
  };

  const lists = useMemo(() => snapshot?.lists ?? [], [snapshot]);
  const listsV3 = useMemo(() => snapshotV3?.lists ?? [], [snapshotV3]);
  // Item-value/code searches run server-side and need at least 2 chars.
  const itemSearchActive = submittedField !== 'name' && (submittedQuery?.trim().length ?? 0) >= 2;
  const itemSearchNeedsMoreChars = searchField !== 'name' && query.trim().length > 0 && query.trim().length < 2;
  // The name filter is applied on submission, like the server-side searches.
  const nameFilterActive = submittedField === 'name' && (submittedQuery?.trim().length ?? 0) > 0;

  // Active data source based on API version
  const activeItemsIndex = apiVersion === 'v4' ? itemsIndex : itemsV3Index;
  const activeLists: (ConcurList | ConcurListV3)[] = apiVersion === 'v4' ? lists : listsV3;

  // Explicit search trigger — button click or Enter. Applies whatever is typed.
  const triggerItemSearch = useCallback(() => {
    const q = query.trim();
    if (searchField === 'name') {
      // Name search is client-side; just snapshot the query.
      setSubmittedQuery(q);
      setSubmittedField('name');
      setItemSearch(null);
      setItemSearchError(null);
      return;
    }
    if (q.length < 2) return; // needs-more-chars hint covers this case

    setSubmittedQuery(q);
    setSubmittedField(searchField);
    const controller = new AbortController();
    setSearchingItems(true);
    setItemSearch(null);
    setItemSearchError(null);
    void searchSavedListItems(searchField, q, controller.signal)
      .then((result) => {
        setItemSearch(result);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setItemSearchError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setSearchingItems(false);
      });
  }, [searchField, query]);

  // Clear the applied search when the query box is emptied.
  useEffect(() => {
    if (query.trim().length === 0) {
      setSubmittedQuery(null);
      setSubmittedField(searchField);
      setItemSearch(null);
      setItemSearchError(null);
      setSearchingItems(false);
    }
  }, [query, searchField]);

  /* Available first letters for the quick-jump strip (post search/category). */
  const base = useMemo(() => {
    let out = activeLists;
    if (category !== 'All') {
      if (apiVersion === 'v4') {
        out = out.filter((l) => (l as ConcurList).category?.type === category);
      } else {
        // v3 doesn't have category, show all when filtering
      }
    }
    if (level !== 'all') {
      if (apiVersion === 'v4') {
        out = out.filter((l) => String((l as ConcurList).levelCount ?? 0) === level);
      }
      // v3 doesn't have levelCount
    }
    if (nameFilterActive && submittedQuery) {
      const q = submittedQuery.toLowerCase();
      out = out.filter((l) => {
        const name = apiVersion === 'v4' ? listName(l as ConcurList) : listV3Name(l as ConcurListV3);
        return name.toLowerCase().includes(q);
      });
    }
    if (itemSearchActive) {
      const matchingListIds = new Set(itemSearch?.matches.map((match) => match.listId) ?? []);
      out = out.filter((l) => {
        const id = apiVersion === 'v4' ? (l as ConcurList).id : (l as ConcurListV3).ID;
        return matchingListIds.has(id);
      });
    }
    return out;
  }, [activeLists, category, itemSearch, itemSearchActive, nameFilterActive, submittedQuery, level, apiVersion]);

  const letters = useMemo(() => {
    const set = new Set<string>();
    for (const l of base) {
      const name = apiVersion === 'v4' ? listName(l as ConcurList) : listV3Name(l as ConcurListV3);
      const c = name.charAt(0).toUpperCase();
      set.add(/[A-Z]/.test(c) ? c : '#');
    }
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').filter((c) => set.has(c));
  }, [base, apiVersion]);

  const filtered = useMemo(() => {
    let out = base;
    if (letter) {
      out = out.filter((l) => {
        const name = apiVersion === 'v4' ? listName(l as ConcurList) : listV3Name(l as ConcurListV3);
        const c = name.charAt(0).toUpperCase();
        return (letter === '#' ? !/[A-Z]/.test(c) : c === letter);
      });
    }
    const dir = sort.dir;
    return [...out].sort((a, b) => {
      let r = 0;
      if (sort.id === 'name') {
        const nameA = apiVersion === 'v4' ? listName(a as ConcurList) : listV3Name(a as ConcurListV3);
        const nameB = apiVersion === 'v4' ? listName(b as ConcurList) : listV3Name(b as ConcurListV3);
        r = nameA.localeCompare(nameB);
      } else if (sort.id === 'category') {
        if (apiVersion === 'v4') r = ((a as ConcurList).category?.type ?? '').localeCompare((b as ConcurList).category?.type ?? '');
      } else if (sort.id === 'levelCount') {
        if (apiVersion === 'v4') r = ((a as ConcurList).levelCount ?? 0) - ((b as ConcurList).levelCount ?? 0);
      } else if (sort.id === 'displayFormat') {
        if (apiVersion === 'v4') r = ((a as ConcurList).displayFormat ?? '').localeCompare((b as ConcurList).displayFormat ?? '');
      }
      return r * dir;
    });
  }, [base, letter, sort, apiVersion]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset to page 1 whenever the result set changes shape.
  useEffect(() => {
    setPage(1);
  }, [submittedQuery, submittedField, category, level, letter]);

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
      {/* ── Toolbar: search row, then filters + retrieval actions ── */}
      <section className="mb-3 rounded-lg border bg-card" aria-label="List search and retrieval toolbar">
        {/* Row 1: search */}
        <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center" aria-label="List search controls">
          <Select value={searchField} onChange={(e) => setSearchField(e.target.value as SearchField)} aria-label="Search lists by" className="sm:w-40">
            <option value="name">List name</option>
            <option value="value">Item value</option>
            <option value="code">Item code</option>
          </Select>

          <div className="relative min-w-0 flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  triggerItemSearch();
                }
              }}
              placeholder={searchField === 'name' ? 'Search list names…' : `Search saved item ${searchField}s…`}
              aria-label="Search lists"
              className="pr-11"
            />
            {/* Search trigger lives inside the input, so the action and its
                field read as one unit instead of two separate controls. */}
            <button
              type="button"
              onClick={triggerItemSearch}
              disabled={searchingItems || query.trim().length === 0 || (searchField !== 'name' && query.trim().length < 2)}
              aria-label="Search"
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              {searchingItems ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
                </svg>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by level count" className="w-32">
              <option value="all">All levels</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>{n} level{n > 1 ? 's' : ''}</option>
              ))}
            </Select>
            <Select value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])} aria-label="Filter by category" className="w-36">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c === 'All' ? 'All categories' : c}</option>
              ))}
            </Select>
            {/* API version switch — compact segmented control, no label. */}
            <div className="flex items-center rounded-md border bg-muted/30 p-0.5" role="group" aria-label="API version">
              <button
                onClick={() => setApiVersion('v4')}
                aria-pressed={apiVersion === 'v4'}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  apiVersion === 'v4' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                v4
              </button>
              <button
                onClick={() => setApiVersion('v3')}
                aria-pressed={apiVersion === 'v3'}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  apiVersion === 'v3' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                v3
              </button>
            </div>
          </div>
        </div>

        {/* Row 2: retrieval actions + snapshot meta */}
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2" aria-label="List retrieval actions">
          <Button size="sm" loading={refreshing} disabled={retrievingAllItems} onClick={retrieveLists}>
            {!refreshing ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
            {refreshing ? 'Retrieving lists…' : 'Retrieve Lists'}
          </Button>
          <Button size="sm" loading={retrievingAllItems} disabled={refreshing || !snapshot} onClick={retrieveAllListItems}>
            {!retrievingAllItems ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
            {retrievingAllItems ? 'Retrieving items…' : 'Retrieve All List Items'}
          </Button>
          {searchField !== 'name' ? <p className="text-xs text-muted-foreground">Item searches use saved local snapshots only.</p> : null}

          {snapshot ? (
            <span className="ml-auto text-xs text-muted-foreground" title={new Date(snapshot.retrievedAt).toLocaleString()}>
              {filtered.length} of {snapshot.count} lists · retrieved {timeAgo(snapshot.retrievedAt)}
            </span>
          ) : null}
        </div>
      </section>

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
        <>
          <ItemRetrievalProgress progress={allItemsProgress} totalLists={lists.length} label="Retrieving all list items and child lists (v4)" />
          <ItemRetrievalProgress progress={allV3ItemsProgress} totalLists={lists.length} label="Retrieving all list items (v3)" />
        </>
      )}

      {itemsSummary && !retrievingAllItems && (
        <div className="mb-3 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success" role="status">
          {itemsSummary}
        </div>
      )}

      {v3ItemsSummary && !retrievingAllItems && (
        <div className="mb-3 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success" role="status">
          {v3ItemsSummary}
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

      {v3ItemsError && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          v3 list item retrieval failed: {v3ItemsError}
        </div>
      )}

      {itemSearchError && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          Local item search failed: {itemSearchError}
        </div>
      )}

      {apiVersion === 'v3' && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          The v3 Lists API was deprecated on 04/16/2021. Data may become unavailable in the future.
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
        <LocalItemSearchProgress searchField={submittedField as 'value' | 'code'} />
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
                {pageItems.map((l) => {
                  const listId = apiVersion === 'v4' ? (l as ConcurList).id : (l as ConcurListV3).ID;
                  return (
                    <ListRow
                      key={listId}
                      list={l as ConcurList}
                      listV3={apiVersion === 'v3' ? (l as ConcurListV3) : undefined}
                      apiVersion={apiVersion}
                      expanded={expandedId === listId}
                      onToggle={() => setExpandedId((c) => (c === listId ? null : listId))}
                      onExpand={() => setExpandedId(listId)}
                      onShowDetails={() => setDetailList(l as ConcurList)}
                      itemEntry={activeItemsIndex?.lists[listId]}
                      onItemsSnapshotUpdated={apiVersion === 'v4' ? refreshItemsIndex : async () => {
                        const idx = await getItemsV3Index();
                        setItemsV3Index(idx);
                        return idx as unknown as ItemsIndex;
                      }}
                      actionsDisabled={refreshing || retrievingAllItems}
                      searchMatch={itemSearch?.matches.find((match) => match.listId === listId)}
                      searchField={submittedField}
                    />
                  );
                })}
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
  listV3,
  apiVersion,
  expanded,
  onToggle,
  onExpand,
  onShowDetails,
  itemEntry,
  onItemsSnapshotUpdated,
  actionsDisabled,
  searchMatch,
  searchField,
}: {
  list: ConcurList;
  listV3?: ConcurListV3;
  apiVersion: 'v4' | 'v3';
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onShowDetails: () => void;
  itemEntry?: ItemsIndex['lists'][string];
  onItemsSnapshotUpdated: () => Promise<ItemsIndex>;
  actionsDisabled: boolean;
  searchMatch?: SavedListItemSearchMatch;
  searchField: SearchField;
}) {
  const isConnected = Boolean(list.category?.type && list.category.type !== 'Normal');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ItemsProgress | null>(null);
  const [generation, setGeneration] = useState(0);

  const listId = apiVersion === 'v4' ? list.id : (listV3?.ID ?? list.id);
  const displayName = apiVersion === 'v4' ? listName(list) : (listV3 ? listV3Name(listV3) : listName(list));

  const retrieveItems = useCallback(async () => {
    onExpand();
    setRefreshing(true);
    setError(null);
    setProgress(null);
    let streamError: string | null = null;
    let finished = false;
    try {
      if (apiVersion === 'v3' && listV3) {
        // v3 API
        await fetchAllListItemsV3([listV3.ID], { [listV3.ID]: listV3Name(listV3) }, {
          onProgress: setProgress as unknown as (p: ItemsV3Progress) => void,
          onDone: (summary) => {
            finished = true;
            if (summary.failed > 0) streamError = 'The complete item list could not be retrieved. Please try again.';
          },
          onError: (message) => { streamError = message; },
        }, { force: true });
      } else {
        // v4 API
        await fetchAllListItems([list.id], { [list.id]: listName(list) }, {
          onProgress: setProgress,
          onDone: (summary) => {
            finished = true;
            if (summary.failed > 0) streamError = 'The complete item tree could not be retrieved. Please try again.';
          },
          onError: (message) => { streamError = message; },
        }, { force: true });
      }
      if (streamError) throw new Error(streamError);
      if (!finished) throw new Error('The item retrieval ended before returning a completion status.');

      const index = await onItemsSnapshotUpdated();
      const entry = index.lists[listId];
      if (!entry?.complete) {
        throw new Error(entry?.failedChildren
          ? `${entry.failedChildren} child branch${entry.failedChildren === 1 ? '' : 'es'} could not be retrieved. Please try again.`
          : 'The complete item tree is not available locally yet. Please try again.');
      }
      setGeneration((current) => current + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRefreshing(false);
    }
  }, [list, listV3, apiVersion, listId, onExpand, onItemsSnapshotUpdated]);

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
              <div className="text-xs font-medium leading-tight">{displayName}</div>
              {searchMatch && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground" title={searchField === 'code' ? (searchMatch.code ?? searchMatch.shortCode) : searchMatch.value}>
                  {searchField === 'code' ? `Code: ${searchMatch.code ?? searchMatch.shortCode ?? '—'}` : `Value: ${searchMatch.value ?? '—'}`}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="hidden px-4 py-1.5 md:table-cell">
          {apiVersion === 'v4' ? (
            list.category?.type ? <Badge tone={list.category.type === 'Normal' ? 'muted' : 'primary'}>{list.category.type}</Badge> : '—'
          ) : (
            listV3?.ConnectorID ?? '—'
          )}
        </td>
        <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">
          {apiVersion === 'v4' ? (list.levelCount ?? '—') : (listV3?.SearchCriteriaCode ?? '—')}
        </td>
        <td className="hidden px-4 py-1.5 text-muted-foreground lg:table-cell">
          {apiVersion === 'v4' ? (
            <>
              {list.displayFormat ?? '—'}
              {itemEntry && (
                <div className="mt-0.5 text-xs text-muted-foreground/80">
                  {itemEntry.count.toLocaleString()} items{itemEntry.truncated ? ' · truncated' : ''}{itemEntry.complete === false && itemEntry.failedChildren ? ` · ${itemEntry.failedChildren} failed branches` : ''}
                </div>
              )}
            </>
          ) : (
            <>
              {listV3?.IsVendorList ? 'Vendor' : '—'}
              {itemEntry && (
                <div className="mt-0.5 text-xs text-muted-foreground/80">
                  {itemEntry.count.toLocaleString()} items{itemEntry.truncated ? ' · truncated' : ''}
                </div>
              )}
            </>
          )}
        </td>
        <td className="hidden px-4 py-1.5 text-muted-foreground xl:table-cell">
          {apiVersion === 'v4' ? (list.searchCriteria ?? '—') : (listV3?.DisplayCodeFirst ?? '—')}
        </td>
        <td className="px-4 py-1.5 text-right sm:px-6">
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
              loading={refreshing}
              disabled={actionsDisabled}
              onClick={() => void retrieveItems()}
              aria-label={`Refresh ${displayName} data`}
              title={apiVersion === 'v4' ? "Retrieve this list's complete item tree and every child level again from Concur" : "Retrieve this list's complete items again from Concur"}
            >
              {!refreshing ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
              {refreshing ? 'Refreshing…' : 'Refresh data'}
            </Button>
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
                listV3={listV3}
                apiVersion={apiVersion}
                itemEntry={itemEntry}
                refreshing={refreshing}
                progress={progress}
                error={error}
                generation={generation}
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

/**
 * Live retrieval status.
 *
 * The server reports page-based completion per list plus an overall figure
 * weighted by the current list's fraction, which is what makes the bar move
 * during a single long list. The old list-counter estimate stays as a fallback
 * for phases that carry no percentage.
 */
function ItemRetrievalProgress({ progress, totalLists, label }: { progress: ItemsProgress | null; totalLists: number; label: string }) {
  const total = progress?.listTotal ?? totalLists;
  const current = progress?.listIndex;
  const singleList = total <= 1;

  const completedPortion = progress?.phase === 'list-done' ? current : current ? current - 0.5 : undefined;
  const listCounterPercent = completedPortion === undefined || total === 0
    ? undefined
    : Math.min(99, Math.max(5, Math.round((completedPortion / total) * 100)));
  const percent = (singleList ? progress?.percent : progress?.overallPercent) ?? listCounterPercent;

  const detail: string[] = [];
  if (!singleList && current) detail.push(`List ${current} of ${total}`);
  if (progress?.listName) detail.push(progress.listName);
  if (progress?.phase === 'list-skipped') {
    detail.push('already complete, skipped');
  } else {
    if (progress?.level) detail.push(`level ${progress.level}`);
    if (progress?.items) detail.push(`${progress.items.toLocaleString()} items`);
    if (progress?.pagesDone) {
      const estimate = progress.pagesTotal ?? progress.pagesDone;
      detail.push(`page ${progress.pagesDone.toLocaleString()} of ~${estimate.toLocaleString()}`);
    }
  }

  return (
    <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <Spinner />
        <span className="min-w-0">
          <span className="font-medium text-foreground">{label}</span>
          <span className="ml-1">{detail.length ? detail.join(' · ') : 'Preparing retrieval'}</span>
        </span>
        {percent !== undefined && <span className="ml-auto shrink-0 font-semibold tabular-nums text-primary">{percent}%</span>}
      </div>
      <RetrievalProgressBar label={label} percent={percent} />
    </div>
  );
}

/**
 * Browses one list's item tree.
 *
 * For v4: The tree mounts immediately and loads levels on demand, so opening a list is
 * instant instead of waiting on a full traversal (hundreds of Concur requests
 * for a large list). Retrieving the whole tree up front is still available as
 * an explicit action, which is what local item search needs, since that search
 * only covers what has been saved.
 *
 * For v3: Items are loaded as a flat list and rendered in a tree structure.
 */
function ListItemsPanel({
  list,
  listV3,
  apiVersion,
  itemEntry,
  refreshing,
  progress,
  error,
  generation,
}: {
  list: ConcurList;
  listV3?: ConcurListV3;
  apiVersion: 'v4' | 'v3';
  itemEntry?: ItemsIndex['lists'][string];
  refreshing: boolean;
  progress: ItemsProgress | null;
  error: string | null;
  generation: number;
}) {
  const [v3Items, setV3Items] = useState<ConcurListItemV3[] | null>(null);
  const [v3Loading, setV3Loading] = useState(false);
  const [v3Error, setV3Error] = useState<string | null>(null);

  const listId = apiVersion === 'v4' ? list.id : (listV3?.ID ?? list.id);
  const displayName = apiVersion === 'v4' ? listName(list) : (listV3 ? listV3Name(listV3) : listName(list));

  useEffect(() => {
    if (apiVersion !== 'v3' || !listV3) return;
    let cancelled = false;
    setV3Loading(true);
    setV3Error(null);
    getListItemsV3(listV3.ID)
      .then((data) => {
        if (!cancelled) setV3Items(data.items);
      })
      .catch((e: Error) => {
        if (!cancelled) setV3Error(e.message);
      })
      .finally(() => {
        if (!cancelled) setV3Loading(false);
      });
    return () => { cancelled = true; };
  }, [apiVersion, listV3, generation]);

  const snapshotState = !itemEntry
    ? 'loaded on demand'
    : itemEntry.complete
      ? `complete local snapshot · ${itemEntry.count.toLocaleString()} items`
      : `partial snapshot · ${itemEntry.count.toLocaleString()} items saved`;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          List items
          <span className="ml-2 font-normal normal-case text-muted-foreground/70">({snapshotState})</span>
        </h3>
      </div>

      {refreshing && (
        <ItemRetrievalProgress progress={progress} totalLists={1} label={`Retrieving ${displayName} items and child lists`} />
      )}

      {error && (
        <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {apiVersion === 'v4' ? (
        <ItemTree key={`${listId}-${generation}`} listId={listId} />
      ) : v3Loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading v3 items…
        </div>
      ) : v3Error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          Failed to load v3 items: {v3Error}
        </div>
      ) : v3Items ? (
        <ItemTreeV3 items={v3Items} />
      ) : (
        <p className="text-sm text-muted-foreground">No v3 items available. Click "Refresh data" to retrieve them.</p>
      )}
    </div>
  );
}
