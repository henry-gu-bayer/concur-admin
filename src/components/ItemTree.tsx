import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getChildrenLevel } from '../api/listItemsApi';
import { ConcurListItem } from '../types';
import { useVirtualTableRows } from './useVirtualTableRows';

/**
 * Lazy-loading tree for one list's items.
 *
 * Instead of receiving the whole tree up front, it fetches ONE LEVEL at a time
 * from the backend (`getChildrenLevel`): level-1 roots on mount, then a node's
 * direct children the first time that node is expanded. The backend serves
 * from an incremental cache when the level was already fetched (fast repeat
 * access), otherwise calls Concur and caches the level.
 *
 * Items accumulate in a flat id→item map; the visible tree is flattened into a
 * row list and virtualized, because a single node can legitimately hold
 * thousands of children (one real list has a parent with 5,451) and mounting
 * those all at once locks up the browser.
 *
 * The inline filter searches only the nodes loaded so far (lazy loading means
 * the full tree isn't necessarily present client-side).
 */

const LEVEL_COLORS = [
  'bg-primary/10 text-primary border-primary/20',
  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
];

/** Rows must be a known fixed height for windowed scrolling to place them. */
const ROW_HEIGHT = 30;
const VIEWPORT_HEIGHT = 480;
const FILTER_DEBOUNCE_MS = 250;
const INDENT_REM = 1.25;

interface TreeState {
  /** Every item fetched so far, by id. */
  items: Map<string, ConcurListItem>;
  /** parentId ('' = root) → ordered child ids, once that level was fetched. */
  childrenOf: Map<string, string[]>;
  /** Node ids whose children have been loaded (or are loadable-from-cache). */
  loadedParents: Set<string>;
  /** Pre-lowercased searchable text per item, so filtering never rebuilds strings. */
  haystacks: Map<string, string>;
  rootsLoaded: boolean;
}

const EMPTY_STATE: TreeState = {
  items: new Map(),
  childrenOf: new Map(),
  loadedParents: new Set(),
  haystacks: new Map(),
  rootsLoaded: false,
};

type TreeRow =
  | { kind: 'node'; key: string; item: ConcurListItem; depth: number }
  | { kind: 'error'; key: string; itemId: string; depth: number; message: string };

export function ItemTree({ listId }: { listId: string }) {
  const [tree, setTree] = useState<TreeState>(EMPTY_STATE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [rootError, setRootError] = useState<string | null>(null);
  const [nodeErrors, setNodeErrors] = useState<Map<string, string>>(new Map());
  const mounted = useRef(true);

  // Read in stable callbacks without making those callbacks change identity,
  // which would defeat the memoized rows.
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Fetch one level (roots when parentId is null) and merge into state. */
  const loadLevel = useCallback(
    async (parentId: string | null) => {
      const key = parentId ?? '';
      setLoadingNodes((prev) => new Set(prev).add(key));
      try {
        const { items } = await getChildrenLevel(listId, parentId);
        if (!mounted.current) return;
        setTree((prev) => {
          const nextItems = new Map(prev.items);
          const childrenOf = new Map(prev.childrenOf);
          const loadedParents = new Set(prev.loadedParents);
          const haystacks = new Map(prev.haystacks);
          for (const it of items) {
            nextItems.set(it.id, it);
            haystacks.set(it.id, `${it.value ?? ''} ${it.code ?? ''} ${it.shortCode ?? ''}`.toLowerCase());
          }
          childrenOf.set(key, items.map((i) => i.id));
          if (parentId) loadedParents.add(parentId);
          return {
            items: nextItems,
            childrenOf,
            loadedParents,
            haystacks,
            rootsLoaded: parentId === null ? true : prev.rootsLoaded,
          };
        });
        setNodeErrors((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      } catch (e) {
        if (!mounted.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (parentId === null) setRootError(msg);
        else setNodeErrors((prev) => new Map(prev).set(key, msg));
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
    [listId]
  );

  // Load level-1 roots when the panel mounts / listId changes.
  useEffect(() => {
    setTree(EMPTY_STATE);
    setExpanded(new Set());
    setQuery('');
    setAppliedQuery('');
    setRootError(null);
    setNodeErrors(new Map());
    void loadLevel(null);
  }, [listId, loadLevel]);

  // Filtering walks every loaded node, so wait for a pause in typing.
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(query), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const toggle = useCallback(
    (item: ConcurListItem) => {
      const id = item.id;
      const willOpen = !expandedRef.current.has(id);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (willOpen) next.add(id);
        else next.delete(id);
        return next;
      });
      // Fetch children the first time a node with children is opened.
      if (willOpen && item.hasChildren && !treeRef.current.loadedParents.has(id)) {
        void loadLevel(id);
      }
    },
    [loadLevel]
  );

  const retryNode = useCallback((itemId: string) => void loadLevel(itemId), [loadLevel]);

  const expandAllLoaded = () => {
    setExpanded(new Set([...tree.items.values()].filter((i) => i.hasChildren).map((i) => i.id)));
  };
  const collapseAll = () => setExpanded(new Set());

  /* Filter over the nodes loaded so far; matches reveal their ancestors. */
  const filtering = appliedQuery.trim().length > 0;
  const filterVisible = useMemo(() => {
    if (!filtering) return new Set<string>();
    const q = appliedQuery.trim().toLowerCase();
    const visible = new Set<string>();
    for (const it of tree.items.values()) {
      if (!(tree.haystacks.get(it.id) ?? '').includes(q)) continue;
      let cur: ConcurListItem | undefined = it;
      while (cur && !visible.has(cur.id)) {
        visible.add(cur.id);
        cur = cur.parentId ? tree.items.get(cur.parentId) : undefined;
      }
    }
    return visible;
  }, [filtering, appliedQuery, tree.items, tree.haystacks]);

  /**
   * Flatten the visible tree into fixed-height rows. Errors become their own
   * row so every entry keeps the uniform height windowing depends on.
   */
  const rows = useMemo(() => {
    const out: TreeRow[] = [];
    const walk = (parentKey: string, depth: number) => {
      for (const id of tree.childrenOf.get(parentKey) ?? []) {
        const item = tree.items.get(id);
        if (!item) continue;
        if (filtering && !filterVisible.has(id)) continue;
        out.push({ kind: 'node', key: id, item, depth });
        const message = nodeErrors.get(id);
        if (message) out.push({ kind: 'error', key: `${id}:error`, itemId: id, depth, message });
        if (item.hasChildren && (filtering || expanded.has(id))) walk(id, depth + 1);
      }
    };
    walk('', 1);
    return out;
  }, [tree.childrenOf, tree.items, expanded, filtering, filterVisible, nodeErrors]);

  const { scrollRef, range, onScroll } = useVirtualTableRows({
    rowCount: rows.length,
    headerHeight: 0,
    rowHeight: ROW_HEIGHT,
  });

  const loadedCount = tree.items.size;
  const rootIds = tree.childrenOf.get('') ?? [];
  const visibleRows = rows.slice(range.start, range.end);

  return (
    <div>
      {/* Tree toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${loadedCount} loaded item${loadedCount === 1 ? '' : 's'}…`}
          aria-label="Filter loaded items"
          className="h-8 min-w-[180px] flex-1 rounded-md border bg-background px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-xs"
        />
        <div className="flex items-center gap-1">
          <button onClick={expandAllLoaded} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            Expand loaded
          </button>
          <button onClick={collapseAll} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            Collapse all
          </button>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {loadedCount} loaded
          {filtering && ` · ${filterVisible.size} match`}
        </span>
      </div>

      {rootError && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          Failed to load items: {rootError}
          <button onClick={() => void loadLevel(null)} className="underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      {loadingNodes.has('') && rootIds.length === 0 ? (
        <div className="space-y-2 rounded-md border bg-background/50 p-3" aria-busy="true" aria-label="Loading items">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-4 rounded bg-muted animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]"
              style={{ width: `${80 - i * 14}%` }}
            />
          ))}
        </div>
      ) : rootIds.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {rootError ? "Couldn't load items." : 'This list has no items.'}
        </p>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          role="tree"
          aria-label="List items"
          className="overflow-auto rounded-md border bg-background/50 p-1.5"
          style={{ maxHeight: VIEWPORT_HEIGHT }}
        >
          <div aria-hidden="true" style={{ height: range.topSpacerHeight }} />
          {visibleRows.map((row) =>
            row.kind === 'error' ? (
              <NodeErrorRow key={row.key} itemId={row.itemId} depth={row.depth} message={row.message} onRetry={retryNode} />
            ) : (
              <TreeNodeRow
                key={row.key}
                item={row.item}
                depth={row.depth}
                open={filtering || expanded.has(row.item.id)}
                loading={loadingNodes.has(row.item.id)}
                childCount={tree.loadedParents.has(row.item.id) ? (tree.childrenOf.get(row.item.id) ?? []).length : null}
                onToggle={toggle}
              />
            )
          )}
          <div aria-hidden="true" style={{ height: range.bottomSpacerHeight }} />
        </div>
      )}

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {loadedCount.toLocaleString()} item{loadedCount === 1 ? '' : 's'} loaded · expand a node to show its children
      </p>
    </div>
  );
}

/**
 * One tree row. Memoized so expanding a node re-renders that row rather than
 * every other row currently on screen.
 */
const TreeNodeRow = memo(function TreeNodeRow({
  item,
  depth,
  open,
  loading,
  childCount,
  onToggle,
}: {
  item: ConcurListItem;
  depth: number;
  open: boolean;
  loading: boolean;
  childCount: number | null;
  onToggle: (item: ConcurListItem) => void;
}) {
  const hasKids = !!item.hasChildren;
  return (
    <div
      role="treeitem"
      aria-expanded={hasKids ? open : undefined}
      aria-level={item.level}
      className="group flex items-center gap-1.5 rounded-md px-1.5 hover:bg-accent/60"
      style={{ height: ROW_HEIGHT, marginLeft: `${(depth - 1) * INDENT_REM}rem` }}
    >
      <button
        onClick={() => hasKids && onToggle(item)}
        aria-label={open ? 'Collapse' : 'Expand'}
        aria-expanded={open}
        disabled={!hasKids}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors ${
          hasKids ? 'hover:bg-accent hover:text-foreground' : 'opacity-0'
        }`}
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

      <span
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${LEVEL_COLORS[(item.level - 1) % LEVEL_COLORS.length]}`}
        title={`Level ${item.level}`}
      >
        {item.level}
      </span>

      {/* Truncated rather than wrapped: uniform row height is what lets the
          list stay windowed. The full value stays available as a tooltip. */}
      <div className="flex min-w-0 flex-1 items-baseline gap-2 leading-tight">
        <span className="truncate text-sm font-medium" title={item.value ?? item.id}>
          {item.value ?? item.id}
        </span>
        {(item.code || item.shortCode) && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {item.code ?? ''}
            {item.shortCode && item.shortCode !== item.code ? ` · ${item.shortCode}` : ''}
          </span>
        )}
      </div>

      {hasKids && childCount !== null && (
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
          {childCount}
        </span>
      )}
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
