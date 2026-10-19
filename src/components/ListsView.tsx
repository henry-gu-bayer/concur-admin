import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLists, listName, refreshLists, timeAgo } from '../api/listsApi';
import { getListsV3, listV3Name, refreshListsV3 } from '../api/listsV3Api';
import {
  BulkSummary,
  fetchAllListItems,
  getItemsIndex,
  SavedListItemSearchResult,
  searchSavedListItems,
} from '../api/listItemsApi';
import { BulkV3Summary, fetchAllListItemsV3, getItemsV3Index } from '../api/listItemsV3Api';
import { ConcurList, ConcurListItemV3, ConcurListV3, ItemsIndex, ItemsProgress, ItemsV3Index, ItemsV3Progress, ListsSnapshot, ListsV3Snapshot } from '../types';
import { getActiveEntityId } from '../entities/entityStore';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import { ResizableDetailLayout } from './ui/Resizable';
import { ListsWorkspace } from './ListsWorkspace';
import { getListItemsV3 } from '../api/listItemsV3Api';
import { ErrorPanel, LoadingRows } from './ui/AsyncState';
import { listsViewSessions } from './listsSessionCache';

const PAGE_SIZE = 50;
const CATEGORIES = ['All', 'Normal', 'Configuration', 'Vendor', 'Commodity'] as const;

type SortId = 'name' | 'category' | 'levelCount' | 'displayFormat';
type SearchField = 'name' | 'value' | 'code' | 'list-id' | 'item-id';
const isItemSearch = (field: SearchField): field is 'value' | 'code' | 'item-id' => field === 'value' || field === 'code' || field === 'item-id';

interface VersionedList extends ConcurList {
  apiVersion: 'v4' | 'v3';
  legacy?: ConcurListV3;
  otherVersion?: VersionedList;
}

const listKey = (list: VersionedList) => `${list.apiVersion}:${list.id}`;

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
  const itemSearchController = useRef<AbortController | null>(null);
  useEffect(() => () => itemSearchController.current?.abort(), []);
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
  const [retrievingAllItems, setRetrievingAllItems] = useState(false);
  const [itemsGeneration, setItemsGeneration] = useState(0);
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
      snapshot, itemsIndex, query, searchField, category, level, sort, letter, page, expandedId, detailList: null,
      snapshotV3, itemsV3Index,
    });
  }, [category, entityId, expandedId, itemsIndex, letter, level, page, query, searchField, snapshot, sort, snapshotV3, itemsV3Index]);

  const refreshItemsIndex = useCallback(async () => {
    const [next, legacy] = await Promise.all([getItemsIndex(), getItemsV3Index()]);
    setItemsIndex(next);
    setItemsV3Index(legacy);
    return next;
  }, []);

  const retrieveLists = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const results = await Promise.allSettled([refreshLists(), refreshListsV3()]);
      if (results[0].status === 'fulfilled') setSnapshot(results[0].value);
      if (results[1].status === 'fulfilled') setSnapshotV3(results[1].value);
      const failed = results.filter(result => result.status === 'rejected');
      if (failed.length) setError(failed.map(result => String((result as PromiseRejectedResult).reason)).join('; '));
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
    let legacySnapshot = snapshotV3;
    let v3ListsLoaded = false;
    if (!snapshotV3) {
      try {
        const v3Data = await refreshListsV3();
        legacySnapshot = v3Data;
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

    const v3Promise = v3ListsLoaded && legacySnapshot?.lists.length
      ? fetchAllListItemsV3(
          legacySnapshot?.lists.map(list => list.ID) ?? [],
          Object.fromEntries((legacySnapshot?.lists ?? []).map(list => [list.ID, listV3Name(list)])),
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
    setItemsGeneration(value => value + 1);
  };

  const lists = useMemo(() => snapshot?.lists ?? [], [snapshot]);
  const listsV3 = useMemo(() => snapshotV3?.lists ?? [], [snapshotV3]);
  // Item-value/code searches run server-side and need at least 2 chars.
  const itemSearchActive = isItemSearch(submittedField) && (submittedQuery?.trim().length ?? 0) >= 2;
  const itemSearchNeedsMoreChars = isItemSearch(searchField) && query.trim().length > 0 && query.trim().length < 2;
  // The name filter is applied on submission, like the server-side searches.
  const nameFilterActive = submittedField === 'name' && (submittedQuery?.trim().length ?? 0) > 0;

  // Names identify the same list across versions, per the administrator's
  // matching rule. Keep each source object intact for API calls and IDs.
  const activeLists = useMemo<VersionedList[]>(() => {
    const records: VersionedList[] = [
      ...lists.map(list => ({ ...list, apiVersion: 'v4' as const })),
      ...listsV3.map(list => ({ id: list.ID, name: listV3Name(list), apiVersion: 'v3' as const, legacy: list })),
    ];
    const groups = new Map<string, VersionedList[]>();
    for (const record of records) {
      const name = listName(record).trim();
      const group = groups.get(name) ?? [];
      group.push(record);
      groups.set(name, group);
    }
    return Array.from(groups.values(), group => {
      const selected = group.find(record => record.apiVersion === 'v4') ?? group[0];
      return { ...selected, otherVersion: group.find(record => record.apiVersion !== selected.apiVersion) };
    });
  }, [lists, listsV3]);

  // Explicit search trigger — button click or Enter. Applies whatever is typed.
  const triggerItemSearch = useCallback(() => {
    const q = query.trim();
    itemSearchController.current?.abort();
    if (!isItemSearch(searchField)) {
      // Name search is client-side; just snapshot the query.
      setSubmittedQuery(q);
      setSubmittedField(searchField);
      setItemSearch(null);
      setItemSearchError(null);
      setSearchingItems(false);
      return;
    }
    if (q.length < 2) return; // needs-more-chars hint covers this case

    setSubmittedQuery(q);
    setSubmittedField(searchField);
    const controller = new AbortController();
    itemSearchController.current = controller;
    setSearchingItems(true);
    setItemSearch(null);
    setItemSearchError(null);
    const searchBothVersions = async (): Promise<SavedListItemSearchResult> => {
      const result = await searchSavedListItems(searchField === 'item-id' ? 'id' : searchField, q, controller.signal);
      const matches = result.matches.map(match => ({ ...match, listId: `v4:${match.listId}` }));
      const savedV3Ids = Object.keys(itemsV3Index?.lists ?? {});
      let scannedItems = result.scannedItems;
      // Read only saved local snapshots, in bounded batches. Never trigger an
      // upstream retrieval just to search the legacy API's data.
      for (let start = 0; start < savedV3Ids.length; start += 8) {
        controller.signal.throwIfAborted();
        const snapshots = await Promise.all(savedV3Ids.slice(start, start + 8).map(id => getListItemsV3(id)));
        for (const snapshot of snapshots) {
          scannedItems += snapshot.items.length;
          const item = snapshot.items.find(item => (searchField === 'item-id' ? [item.ID] : searchField === 'value'
            ? [item.Name]
            : Array.from({ length: 10 }, (_, index) => item[`Level${index + 1}Code` as keyof ConcurListItemV3]))
            .some(value => value?.toLowerCase().includes(q.toLowerCase())));
          if (item) {
            const matchingCode = Array.from({ length: 10 }, (_, index) => item[`Level${index + 1}Code` as keyof ConcurListItemV3])
              .find(value => value?.toLowerCase().includes(q.toLowerCase()));
            matches.push({ listId: `v3:${snapshot.listId}`, itemId: item.ID, value: item.Name, code: matchingCode ?? item.Level1Code });
          }
        }
      }
      return { ...result, matches, scannedLists: result.scannedLists + savedV3Ids.length, scannedItems };
    };
    void searchBothVersions()
      .then((result) => {
        if (!controller.signal.aborted) setItemSearch(result);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        setItemSearchError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearchingItems(false);
      });
  }, [searchField, query, itemsV3Index]);

  // Clear the applied search when the query box is emptied.
  useEffect(() => {
    if (query.trim().length === 0) {
      itemSearchController.current?.abort();
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
      out = out.filter(l => [l, l.otherVersion].some(record => record?.apiVersion === 'v4' && record.category?.type === category));
    }
    if (level !== 'all') {
      out = out.filter(l => [l, l.otherVersion].some(record => record?.apiVersion === 'v4' && String(record.levelCount ?? 0) === level));
    }
    if (nameFilterActive && submittedQuery) {
      const q = submittedQuery.toLowerCase();
      out = out.filter((l) => {
        const name = listName(l);
        return name.toLowerCase().includes(q);
      });
    }
    if (submittedField === 'list-id' && submittedQuery?.trim()) {
      const q = submittedQuery.trim().toLowerCase();
      out = out.filter(list => [list, list.otherVersion].some(record => record?.id.toLowerCase().includes(q)));
    }
    if (itemSearchActive) {
      const matchingListIds = new Set(itemSearch?.matches.map((match) => match.listId) ?? []);
      out = out.filter((l) => {
        return matchingListIds.has(listKey(l)) || Boolean(l.otherVersion && matchingListIds.has(listKey(l.otherVersion)));
      });
    }
    return out;
  }, [activeLists, category, itemSearch, itemSearchActive, nameFilterActive, submittedQuery, submittedField, level]);

  const letters = useMemo(() => {
    const set = new Set<string>();
    for (const l of base) {
      const name = listName(l);
      const c = name.charAt(0).toUpperCase();
      set.add(/[A-Z]/.test(c) ? c : '#');
    }
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').filter((c) => set.has(c));
  }, [base]);

  const filtered = useMemo(() => {
    let out = base;
    if (letter) {
      out = out.filter((l) => {
        const name = listName(l);
        const c = name.charAt(0).toUpperCase();
        return (letter === '#' ? !/[A-Z]/.test(c) : c === letter);
      });
    }
    const dir = sort.dir;
    return [...out].sort((a, b) => {
      let r = 0;
      if (sort.id === 'name') {
        const nameA = listName(a);
        const nameB = listName(b);
        r = nameA.localeCompare(nameB);
      } else if (sort.id === 'category') {
        r = (a.category?.type ?? '').localeCompare(b.category?.type ?? '');
      } else if (sort.id === 'levelCount') {
        r = (a.levelCount ?? 0) - (b.levelCount ?? 0);
      } else if (sort.id === 'displayFormat') {
        r = (a.displayFormat ?? '').localeCompare(b.displayFormat ?? '');
      }
      return r * dir;
    });
  }, [base, letter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selected = pageItems.find(list => `name:${listName(list).trim()}` === expandedId);
  const selectedSources = selected ? [selected, selected.otherVersion].filter(Boolean) as VersionedList[] : [];
  const selectedV4 = selectedSources.find(source => source.apiVersion === 'v4');
  const v4Record = selectedV4 ? snapshot?.lists.find(list => list.id === selectedV4.id) ?? null : null;

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

  if (error && !snapshot && !snapshotV3) {
    return <ErrorPanel title="Couldn't load lists" message={error} onRetry={() => { loadSnapshot(); }} />;
  }

  return (
    <div>
      {/* ── Toolbar: search row, then filters + retrieval actions ── */}
      <section className="mb-3 rounded-lg border bg-card xl:flex xl:flex-wrap xl:items-center" aria-label="List search and retrieval toolbar">
        {/* Row 1: search */}
        <div className="flex min-w-0 flex-col gap-2 p-3 lg:flex-row lg:items-center xl:flex-1" aria-label="List search controls">
          <Select value={searchField} onChange={(e) => setSearchField(e.target.value as SearchField)} aria-label="Search lists by" className="lg:w-40 lg:shrink-0">
            <option value="name">List name</option>
            <option value="value">Item value</option>
            <option value="code">Item code</option>
            <option value="list-id">List ID (v3 / v4)</option>
            <option value="item-id">Item ID (v3 / v4)</option>
          </Select>

          <div className="flex min-w-0 flex-1 gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  triggerItemSearch();
                }
              }}
              placeholder={searchField === 'name' ? 'Search list names…' : searchField === 'list-id' ? 'Search v3 or v4 list IDs…' : searchField === 'item-id' ? 'Search v3 or v4 item IDs…' : `Search saved item ${searchField}s…`}
              aria-label="Search lists"
            />
          </div>
            <button
              type="button"
              onClick={triggerItemSearch}
              disabled={searchingItems || query.trim().length === 0 || (isItemSearch(searchField) && query.trim().length < 2)}
              aria-label="Search"
              className="flex h-10 shrink-0 items-center gap-2 self-start rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 lg:self-auto"
            >
              {searchingItems ? <Spinner /> : null}Search
            </button>
          <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:shrink-0 sm:flex-wrap">
            <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by level count" className="min-w-0 text-xs sm:w-32 sm:shrink-0 sm:text-sm">
              <option value="all">All levels</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>{n} level{n > 1 ? 's' : ''}</option>
              ))}
            </Select>
            <Select value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])} aria-label="Filter by category" className="min-w-0 text-xs sm:w-40 sm:shrink-0 sm:text-sm">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c === 'All' ? 'All categories' : c}</option>
              ))}
            </Select>
          </div>
        </div>

        {/* Row 2: retrieval actions + snapshot meta */}
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 xl:border-t-0 xl:pl-0" aria-label="List retrieval actions">
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
          {isItemSearch(searchField) ? <p className="text-xs text-muted-foreground">Item searches use saved local snapshots only.</p> : null}


        </div>
        <div className="w-full px-3 pb-2 text-right">          {snapshot ? (
            <span className="text-xs text-muted-foreground" title={new Date(snapshot.retrievedAt).toLocaleString()}>
              {filtered.length} of {activeLists.length} lists · retrieved {timeAgo(snapshot.retrievedAt)}
            </span>
          ) : null}</div>
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
          <ItemRetrievalProgress progress={allV3ItemsProgress} totalLists={listsV3.length} label="Retrieving all list items (v3)" />
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

      {/* ── Main stage: the lists table ── */}
      {itemSearchNeedsMoreChars ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
          <h2 className="text-base font-semibold">Enter at least 2 characters</h2>
          <p className="mt-1 text-sm text-muted-foreground">Value and code searches use only the item snapshots saved locally.</p>
        </div>
      ) : itemSearchActive && searchingItems ? (
        <LocalItemSearchProgress searchField={submittedField} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
          <h2 className="text-base font-semibold">No lists match</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {itemSearchActive ? 'No saved item snapshots match this search.' : 'Try a different search or clear the filters.'}
          </p>
          <Button variant="outline" size="sm" className="mt-5" onClick={() => { itemSearchController.current?.abort(); setQuery(''); setSubmittedQuery(null); setSubmittedField('name'); setItemSearch(null); setSearchingItems(false); setCategory('All'); setLevel('all'); setLetter(null); }}>
            Clear filters
          </Button>
        </div>
      ) : (
        <ResizableDetailLayout
          label="Resize lists and workspace" initialListPercent={30} minListPercent={22} maxListPercent={48} minListWidth={280} minDetailWidth={540}
          list={<div className="min-w-0">
            <div className="overflow-x-auto rounded-lg border bg-card">
              <div className="border-b px-3 py-2.5 text-sm font-semibold">Lists ({filtered.length})</div>
              <table className="w-full table-fixed text-sm" aria-label="Concur lists">
                <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th scope="col" className="w-2/3"><button type="button" className="px-3 py-2" onClick={() => toggleSort('name')}>Name{sortArrow('name')}</button></th>
                  <th scope="col"><button type="button" className="px-2 py-2" onClick={() => toggleSort('category')}>Category{sortArrow('category')}</button></th>
                  <th scope="col"><button type="button" className="px-2 py-2" onClick={() => toggleSort('levelCount')}>Levels{sortArrow('levelCount')}</button></th>
                </tr></thead>
                <tbody>{pageItems.map(list => {
                  const key = `name:${listName(list).trim()}`;
                  const match = itemSearch?.matches.find(match => match.listId === listKey(list) || (list.otherVersion && match.listId === listKey(list.otherVersion)));
                  return <tr key={key} className={`border-b last:border-0 hover:bg-accent/50 ${expandedId === key ? 'bg-primary/5' : ''}`}>
                    <td className={`min-w-0 border-l-2 px-3 py-2.5 ${expandedId === key ? 'border-l-primary' : 'border-l-transparent'}`}><button type="button" className="break-words text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Select ${listName(list)}`} aria-pressed={expandedId === key} onClick={() => setExpandedId(key)}>{listName(list)}</button>
                      <div title={`${list.apiVersion} ID: ${list.id}`} className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{list.apiVersion} ID: {list.id}</div>
                      {match ? <p className="mt-1 break-all text-xs text-muted-foreground">{submittedField === 'item-id' ? `Item ID: ${match.itemId}` : submittedField === 'code' ? `Code: ${match.code ?? match.shortCode ?? '—'}` : `Value: ${match.value ?? '—'}`}</p> : null}
                    </td>
                    <td className="px-2 py-3 text-xs text-muted-foreground">{list.category?.type ?? '—'}</td>
                    <td className="px-2 py-3 text-center text-xs text-muted-foreground">{list.levelCount ?? '—'}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
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


            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
              <div className="flex items-center gap-1"><Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span>{currentPage} / {pageCount}</span><Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage(value => value + 1)}>Next</Button></div>
            </div>
          </div>}
          detail={selected ? <ListsWorkspace
            key={`${entityId}:${listName(selected).trim()}:${itemsGeneration}`}
            v4={v4Record}
            v3={selectedSources.find(source => source.apiVersion === 'v3')?.legacy ?? null}
            entityId={entityId} actionsDisabled={refreshing || retrievingAllItems}
            onRefreshed={refreshItemsIndex}
          /> : <div className="rounded-lg border border-dashed bg-card p-8 text-sm text-muted-foreground">Select a list to compare its v4 and v3 configuration and items.</div>}
        />
      )}

    </div>
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
        Searching locally saved item {searchField === 'item-id' ? 'IDs' : `${searchField}s`}…
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
