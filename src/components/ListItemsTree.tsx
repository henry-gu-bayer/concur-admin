import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getChildrenLevel } from '../api/listItemsApi';
import type { ConcurListItem, ConcurListItemV3 } from '../types';
import { useVirtualTableRows } from './useVirtualTableRows';
import { ListItemColumnHeader, listItemColumnsClass } from './ListItemColumns';

/**
 * One item browser for a name-matched list.
 *
 * v4 and v3 store the same list differently, but presenting them as two trees
 * forced the administrator to compare two panes by eye. Here one row is one
 * item: v4 and v3 records are paired per parent by code (falling back to name)
 * and rendered as a single name + code line. Pairing is presentation only —
 * each side keeps its own ID and fields, which the detail pane shows
 * separately.
 *
 * v4 is lazy (one level per expansion) while v3 arrives as a complete flat
 * snapshot. When both exist the v3 tree supplies the skeleton and the order,
 * so rows do not jump while v4 levels stream in. Items that only one version
 * contains stay visible and carry a small version marker.
 */

/** Sentinel parents keep unmatched rows from borrowing another row's children. */
const MISSING_V3 = '\u0000v3';
const MISSING_V4 = '\u0000v4';

const LEVEL_COLORS = [
  'bg-primary/10 text-primary border-primary/20',
  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
];

/** Rows must be a known fixed height for windowed scrolling to place them. */
const ROW_HEIGHT = 30;
const VIEWPORT_HEIGHT = 320;
const FILTER_DEBOUNCE_MS = 250;
const INDENT_REM = 1.25;

export interface PairedListItem {
  /** Stable across re-pairing: the v3 ID when it exists, else the v4 ID. */
  key: string;
  name: string;
  code?: string;
  v4?: ConcurListItem;
  v3?: ConcurListItemV3;
  level: number;
  hasChildren: boolean;
}

type FlatRow =
  | { kind: 'item'; key: string; row: PairedListItem; depth: number }
  | { kind: 'error'; key: string; itemId: string; depth: number; message: string };

const normalize = (value?: string | null) => (value ?? '').trim().toLowerCase();

/** A v3 item's own code sits at its depth; Level1Code covers single-level lists. */
function v3Code(item: ConcurListItemV3 | undefined, depth: number): string | undefined {
  if (!item) return undefined;
  const key = `Level${Math.min(depth, 10)}Code` as keyof ConcurListItemV3;
  return ((item[key] as string | null | undefined) ?? item.Level1Code ?? undefined)?.trim() || undefined;
}

function v3Name(item: ConcurListItemV3, depth: number): string {
  return (item.Name ?? '').trim() || v3Code(item, depth) || item.ID;
}

function v4Name(item: ConcurListItem): string {
  return (item.value ?? '').trim() || (item.code ?? item.shortCode ?? '').trim() || item.id;
}

/**
 * Pair one level's children. Matching by code first (a name can be reworded
 * between versions) and by name second; unmatched items keep their source
 * version. v3 order wins because it is the complete snapshot and stable across
 * lazy v4 loads; v4-only items are appended in v4 order.
 */
function pairLevel(
  v3Kids: ConcurListItemV3[],
  v4Kids: ConcurListItem[],
  depth: number,
  v3ChildrenOf: Map<string, ConcurListItemV3[]>,
): PairedListItem[] {
  const makeRow = (v3?: ConcurListItemV3, v4?: ConcurListItem): PairedListItem => {
    const code = v4?.code?.trim() || v4?.shortCode?.trim() || v3Code(v3, depth);
    return {
      key: v3 ? `v3:${v3.ID}` : `v4:${v4!.id}`,
      name: v3 ? v3Name(v3, depth) : v4Name(v4!),
      code: code || undefined,
      v4,
      v3,
      level: depth,
      hasChildren: Boolean(v4?.hasChildren) || Boolean(v3 && (v3ChildrenOf.get(v3.ID)?.length ?? 0) > 0),
    };
  };

  const byCode = new Map<string, ConcurListItem>();
  for (const item of v4Kids) {
    const key = normalize(item.code ?? item.shortCode);
    if (key && !byCode.has(key)) byCode.set(key, item);
  }

  const used = new Set<string>();
  const rows: PairedListItem[] = [];
  const unmatchedV3: ConcurListItemV3[] = [];
  for (const item of v3Kids) {
    const match = byCode.get(normalize(v3Code(item, depth)));
    if (match && !used.has(match.id)) {
      used.add(match.id);
      rows.push(makeRow(item, match));
    } else {
      unmatchedV3.push(item);
    }
  }

  // Second pass: names still line up when one side has no code.
  const byName = new Map<string, ConcurListItem>();
  for (const item of v4Kids) {
    const key = normalize(item.value);
    if (!used.has(item.id) && key && !byName.has(key)) byName.set(key, item);
  }
  for (const item of unmatchedV3) {
    const match = byName.get(normalize(item.Name));
    if (match && !used.has(match.id)) {
      used.add(match.id);
      rows.push(makeRow(item, match));
    } else {
      rows.push(makeRow(item));
    }
  }

  for (const item of v4Kids) {
    if (!used.has(item.id)) rows.push(makeRow(undefined, item));
  }
  return rows;
}

export function ListItemsTree({
  listId,
  v3Items = [],
  filterQuery,
  selected,
  onSelect,
}: {
  /** v4 list ID; null when the list only exists in v3. */
  listId?: string | null;
  v3Items?: ConcurListItemV3[];
  filterQuery?: string;
  selected?: PairedListItem | null;
  onSelect?: (row: PairedListItem) => void;
}) {
  const [v4Items, setV4Items] = useState<Map<string, ConcurListItem>>(new Map());
  /** parentId ('' = root) → ordered v4 child ids, once that level was loaded. */
  const [v4Children, setV4Children] = useState<Map<string, string[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [rootError, setRootError] = useState<string | null>(null);
  const [nodeErrors, setNodeErrors] = useState<Map<string, string>>(new Map());
  const mounted = useRef(true);

  // Read in stable callbacks without making those callbacks change identity.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const childrenRef = useRef(v4Children);
  childrenRef.current = v4Children;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** v3 parent id → children, rebuilt only when the snapshot changes. */
  const v3Children = useMemo(() => {
    const ids = new Set(v3Items.map((item) => item.ID));
    const map = new Map<string, ConcurListItemV3[]>();
    for (const item of v3Items) {
      // A truncated snapshot can reference a parent that was never persisted;
      // surfacing those items as roots beats hiding them entirely.
      const parent = item.ParentID && ids.has(item.ParentID) ? item.ParentID : '';
      const siblings = map.get(parent);
      if (siblings) siblings.push(item);
      else map.set(parent, [item]);
    }
    return map;
  }, [v3Items]);

  /** Depth badges are noise on single-level lists, which are the vast majority. */
  const nested = useMemo(() => {
    if ((v3Children.get('')?.length ?? 0) < v3Items.length) return true;
    // Iterate rather than spread: a fully loaded list can hold 200k+ items.
    for (const item of v4Items.values()) if (item.hasChildren) return true;
    return false;
  }, [v3Children, v3Items.length, v4Items]);

  /** Fetch one v4 level (roots when parentId is null) and merge it in. */
  const loadLevel = useCallback(
    async (parentId: string | null) => {
      if (!listId) return;
      const key = parentId ?? '';
      setLoadingNodes((prev) => new Set(prev).add(key));
      try {
        const { items } = await getChildrenLevel(listId, parentId);
        if (!mounted.current) return;
        setV4Items((prev) => {
          const next = new Map(prev);
          for (const item of items) next.set(item.id, item);
          return next;
        });
        setV4Children((prev) => new Map(prev).set(key, items.map((item) => item.id)));
        setNodeErrors((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      } catch (error) {
        if (!mounted.current) return;
        const message = error instanceof Error ? error.message : String(error);
        if (parentId === null) setRootError(message);
        else setNodeErrors((prev) => new Map(prev).set(key, message));
      } finally {
        if (mounted.current) {
          setLoadingNodes((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }
      }
    },
    [listId],
  );

  // Roots are the only level fetched without user intent.
  useEffect(() => {
    setV4Items(new Map());
    setV4Children(new Map());
    setExpanded(new Set());
    setRootError(null);
    setNodeErrors(new Map());
    setQuery('');
    setAppliedQuery('');
    if (listId) void loadLevel(null);
  }, [listId, loadLevel]);

  // Filtering walks every loaded node, so wait for a pause in typing.
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(query), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  /**
   * Expansion is keyed by every identity a row can have. Pairing can improve
   * after a row is already open (the v3 snapshot or a v4 level can arrive
   * later), which changes the row key; without this an open branch would
   * silently collapse while its data was still loading.
   */
  const tokensOf = (row: PairedListItem) => [row.key, ...(row.v4 ? [`v4:${row.v4.id}`] : []), ...(row.v3 ? [`v3:${row.v3.ID}`] : [])];
  const isOpen = useCallback((row: PairedListItem) => tokensOf(row).some((token) => expanded.has(token)), [expanded]);

  const toggle = useCallback(
    (row: PairedListItem) => {
      const willOpen = !tokensOf(row).some((token) => expandedRef.current.has(token));
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const token of tokensOf(row)) {
          if (willOpen) next.add(token);
          else next.delete(token);
        }
        return next;
      });
      // Fetch v4 children the first time a paired node is opened.
      if (willOpen && row.v4?.hasChildren && !childrenRef.current.has(row.v4.id)) {
        void loadLevel(row.v4.id);
      }
    },
    [loadLevel],
  );

  const retryNode = useCallback((itemId: string) => void loadLevel(itemId), [loadLevel]);

  const effectiveQuery = filterQuery ?? appliedQuery;
  const filtering = effectiveQuery.trim().length > 0;

  const pairsAt = useCallback(
    (v3Parent: string, v4Parent: string, depth: number) =>
      pairLevel(v3Children.get(v3Parent) ?? [], (v4Children.get(v4Parent) ?? []).flatMap((id) => v4Items.get(id) ?? []), depth, v3Children),
    [v3Children, v4Children, v4Items],
  );

  /** A row matches when either version's identifiers match the query. */
  const rowMatches = useCallback(
    (row: PairedListItem) => {
      const q = effectiveQuery.trim().toLowerCase();
      return [
        row.v4?.value,
        row.v4?.code,
        row.v4?.shortCode,
        row.v4?.id,
        row.v3?.Name,
        v3Code(row.v3, row.level),
        row.v3?.ID,
      ].some((value) => value?.toLowerCase().includes(q));
    },
    [effectiveQuery],
  );

  // Matches reveal their ancestors, so collect the whole matching path before
  // flattening. Only loaded levels are searched (v4 loads lazily), and the
  // result is a flat key set so a large snapshot is walked once.
  const filterVisible = useMemo(() => {
    if (!filtering) return null;
    const visible = new Set<string>();
    const visit = (v3Parent: string, v4Parent: string, depth: number): boolean => {
      let any = false;
      for (const row of pairsAt(v3Parent, v4Parent, depth)) {
        const descendant = row.hasChildren
          ? visit(row.v3?.ID ?? MISSING_V3, row.v4?.id ?? MISSING_V4, depth + 1)
          : false;
        if (rowMatches(row) || descendant) {
          visible.add(row.key);
          any = true;
        }
      }
      return any;
    };
    visit('', '', 1);
    return visible;
  }, [filtering, pairsAt, rowMatches]);

  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    const walk = (v3Parent: string, v4Parent: string, depth: number) => {
      for (const row of pairsAt(v3Parent, v4Parent, depth)) {
        if (filterVisible && !filterVisible.has(row.key)) continue;
        out.push({ kind: 'item', key: row.key, row, depth });
        const message = row.v4 ? nodeErrors.get(row.v4.id) : undefined;
        if (message) out.push({ kind: 'error', key: `${row.key}:error`, itemId: row.v4!.id, depth, message });
        if (row.hasChildren && (filtering || isOpen(row))) {
          walk(row.v3?.ID ?? MISSING_V3, row.v4?.id ?? MISSING_V4, depth + 1);
        }
      }
    };
    walk('', '', 1);
    return out;
  }, [pairsAt, nodeErrors, filterVisible, filtering, expanded, isOpen]);

  /**
   * Emit the merged version of the selected row whenever the tree changes.
   * If the counterpart was not loaded at click time (v4 is lazy, v3 can still
   * be arriving) the workspace would otherwise keep showing one-sided details
   * until the user clicked again.
   */
  const selectedId = selected ? { v4: selected.v4?.id, v3: selected.v3?.ID } : null;
  const selectedToken = selectedId ? `${selectedId.v4 ?? ''}|${selectedId.v3 ?? ''}` : '';
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const lastEmitted = useRef('');
  useEffect(() => {
    if (!selectedId || (!selectedId.v4 && !selectedId.v3)) return;
    const current = rows.find(
      (row) => row.kind === 'item' && ((selectedId.v4 && row.row.v4?.id === selectedId.v4) || (selectedId.v3 && row.row.v3?.ID === selectedId.v3)),
    );
    if (current?.kind !== 'item') return;
    const merged = current.row;
    const token = `${merged.v4?.id ?? ''}|${merged.v3?.ID ?? ''}`;
    if (token === selectedToken || token === lastEmitted.current) return;
    lastEmitted.current = token;
    onSelectRef.current?.(merged);
  }, [rows, selectedToken, selectedId?.v4, selectedId?.v3]);

  const { scrollRef, range, onScroll } = useVirtualTableRows({
    rowCount: rows.length,
    headerHeight: 32,
    rowHeight: ROW_HEIGHT,
  });

  const expandLoaded = () => setExpanded(new Set(rows.flatMap((row) => (row.kind === 'item' && row.row.hasChildren ? tokensOf(row.row) : []))));
  const collapseAll = () => setExpanded(new Set());

  const rootLoading = loadingNodes.has('');
  const visibleRows = rows.slice(range.start, range.end);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Filter ${v3Items.length + v4Items.size} items…`}
          aria-label="Filter loaded items"
          className={`${filterQuery !== undefined ? 'hidden' : ''} h-8 min-w-[180px] flex-1 rounded-md border bg-background px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-xs`}
        />
        <div className="flex items-center gap-1">
          <button onClick={expandLoaded} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            Expand loaded
          </button>
          <button onClick={collapseAll} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            Collapse all
          </button>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {v3Items.length.toLocaleString()} v3 · {v4Items.size.toLocaleString()} v4 loaded
          {filtering && ` · ${rows.length} shown`}
        </span>
      </div>

      {rootError && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          Failed to load v4 items: {rootError}
          <button onClick={() => void loadLevel(null)} className="underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        rootLoading && v3Items.length === 0 ? (
          <div className="space-y-2 rounded-md border bg-background/50 p-3" aria-busy="true" aria-label="Loading items">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-4 rounded bg-muted animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]"
                style={{ width: `${80 - index * 14}%` }}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {rootError ? "Couldn't load items." : filtering ? 'No loaded items match this filter.' : 'This list has no items.'}
          </p>
        )
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          role="tree"
          aria-label="List items"
          className="overflow-auto rounded-md border bg-background/50"
          style={{ maxHeight: VIEWPORT_HEIGHT }}
        >
          <ListItemColumnHeader />
          <div aria-hidden="true" style={{ height: range.topSpacerHeight }} />
          {visibleRows.map((row) =>
            row.kind === 'error' ? (
              <NodeErrorRow key={row.key} itemId={row.itemId} depth={row.depth} message={row.message} onRetry={retryNode} />
            ) : (
              <ListItemRow
                key={row.key}
                row={row.row}
                depth={row.depth}
                open={filtering || isOpen(row.row)}
                loading={row.row.v4 ? loadingNodes.has(row.row.v4.id) : false}
                showLevel={nested}
                onToggle={toggle}
                onSelect={onSelect}
                selected={Boolean(selected && ((selected.v4 && selected.v4.id === row.row.v4?.id) || (selected.v3 && selected.v3.ID === row.row.v3?.ID)))}
              />
            ),
          )}
          <div aria-hidden="true" style={{ height: range.bottomSpacerHeight }} />
        </div>
      )}

      {listId ? <p className="mt-1.5 text-[11px] text-muted-foreground">v4 children load on expansion; v3 items come from the saved snapshot.</p> : null}
    </div>
  );
}

/** One row. Memoized so expanding a node re-renders that row rather than the
 * whole window; the two-column layout keeps uniform height for windowing. */
const ListItemRow = memo(function ListItemRow({
  row,
  depth,
  open,
  loading,
  showLevel,
  onToggle,
  onSelect,
  selected,
}: {
  row: PairedListItem;
  depth: number;
  open: boolean;
  loading: boolean;
  showLevel: boolean;
  onToggle: (row: PairedListItem) => void;
  onSelect?: (row: PairedListItem) => void;
  selected: boolean;
}) {
  const hasKids = row.hasChildren;
  return (
    <div
      role="treeitem"
      aria-expanded={hasKids ? open : undefined}
      aria-level={row.level}
      className={`${listItemColumnsClass} border-b border-border/50 hover:bg-accent/60 ${selected ? 'bg-primary/10' : ''}`}
      style={{ height: ROW_HEIGHT }}
    >
      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${(depth - 1) * INDENT_REM}rem` }}>
        <button
          onClick={() => hasKids && onToggle(row)}
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-expanded={open}
          disabled={!hasKids}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors ${hasKids ? 'hover:bg-accent hover:text-foreground' : 'opacity-0'}`}
        >
          {loading ? (
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-6.2-8.56" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        {showLevel ? (
          <span
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${LEVEL_COLORS[(row.level - 1) % LEVEL_COLORS.length]}`}
            title={`Level ${row.level}`}
          >
            {row.level}
          </span>
        ) : null}
        {/* Truncated rather than wrapped: uniform row height is what lets the
            list stay windowed. The full value stays available as a tooltip and
            in the detail pane. */}
        {onSelect ? (
          <button type="button" aria-label={`View list item ${row.name}`} title={row.name} className="min-w-0 truncate text-left text-xs font-medium hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelect(row)}>
            {row.name}
          </button>
        ) : (
          <span className="truncate text-sm font-medium" title={row.name}>{row.name}</span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground" title={row.code}>{row.code ?? '—'}</span>
        {/* An item that exists in only one version stays visible and says so;
            hiding it would make the lists look identical when they are not. */}
        {!row.v4 ? <span className="shrink-0 text-[10px] text-muted-foreground">v3 only</span> : null}
        {!row.v3 ? <span className="shrink-0 text-[10px] text-muted-foreground">v4 only</span> : null}
      </div>
    </div>
  );
});

const NodeErrorRow = memo(function NodeErrorRow({
  itemId,
  depth,
  message,
  onRetry,
}: {
  itemId: string;
  depth: number;
  message: string;
  onRetry: (itemId: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 text-xs text-destructive"
      style={{ height: ROW_HEIGHT, marginLeft: `${(depth - 1) * INDENT_REM + 1.75}rem` }}
    >
      <span className="truncate">Failed to load children: {message}</span>
      <button onClick={() => onRetry(itemId)} className="shrink-0 underline hover:no-underline">
        Retry
      </button>
    </div>
  );
});