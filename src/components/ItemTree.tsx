import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getChildrenLevel } from '../api/listItemsApi';
import { ConcurListItem } from '../types';

/**
 * Lazy-loading tree for one list's items.
 *
 * Instead of receiving the whole tree up front, it fetches ONE LEVEL at a time
 * from the backend (`getChildrenLevel`): level-1 roots on mount, then a node's
 * direct children the first time that node is expanded. The backend serves
 * from an incremental cache when the level was already fetched (fast repeat
 * access), otherwise calls Concur and caches the level.
 *
 * Items accumulate in a flat id→item map; children are derived per node. The
 * inline filter searches only the nodes loaded so far (lazy loading means the
 * full tree isn't necessarily present client-side).
 */

const LEVEL_COLORS = [
  'bg-primary/10 text-primary border-primary/20',
  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
];

interface TreeState {
  /** Every item fetched so far, by id. */
  items: Map<string, ConcurListItem>;
  /** parentId ('' = root) → ordered child ids, once that level was fetched. */
  childrenOf: Map<string, string[]>;
  /** Node ids whose children have been loaded (or are loadable-from-cache). */
  loadedParents: Set<string>;
  rootsLoaded: boolean;
}

const EMPTY_STATE: TreeState = {
  items: new Map(),
  childrenOf: new Map(),
  loadedParents: new Set(),
  rootsLoaded: false,
};

export function ItemTree({ listId }: { listId: string }) {
  const [tree, setTree] = useState<TreeState>(EMPTY_STATE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [rootError, setRootError] = useState<string | null>(null);
  const [nodeErrors, setNodeErrors] = useState<Map<string, string>>(new Map());
  const mounted = useRef(true);

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
          const items2 = new Map(prev.items);
          const childrenOf = new Map(prev.childrenOf);
          const loadedParents = new Set(prev.loadedParents);
          for (const it of items) items2.set(it.id, it);
          childrenOf.set(key, items.map((i) => i.id));
          if (parentId) loadedParents.add(parentId);
          return { items: items2, childrenOf, loadedParents, rootsLoaded: parentId === null ? true : prev.rootsLoaded };
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
    setRootError(null);
    setNodeErrors(new Map());
    void loadLevel(null);
  }, [listId, loadLevel]);

  const toggle = useCallback(
    (item: ConcurListItem) => {
      const id = item.id;
      const willOpen = !expanded.has(id);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      // Fetch children the first time a node with children is opened.
      if (willOpen && item.hasChildren && !tree.loadedParents.has(id)) {
        void loadLevel(id);
      }
    },
    [expanded, tree.loadedParents, loadLevel]
  );

  const expandAllLoaded = () => {
    setExpanded(new Set([...tree.items.values()].filter((i) => i.hasChildren).map((i) => i.id)));
  };
  const collapseAll = () => setExpanded(new Set());

  /* Filter over the nodes loaded so far; matches reveal their ancestors. */
  const filtering = query.trim().length > 0;
  const filterVisible = useMemo(() => {
    if (!filtering) return new Set<string>();
    const q = query.trim().toLowerCase();
    const visible = new Set<string>();
    for (const it of tree.items.values()) {
      const hay = `${it.value ?? ''} ${it.code ?? ''} ${it.shortCode ?? ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
      let cur: ConcurListItem | undefined = it;
      while (cur && !visible.has(cur.id)) {
        visible.add(cur.id);
        cur = cur.parentId ? tree.items.get(cur.parentId) : undefined;
      }
    }
    return visible;
  }, [filtering, query, tree.items]);

  const rootIds = tree.childrenOf.get('') ?? [];
  const loadedCount = tree.items.size;

  const renderChildren = (parentKey: string, level: number): React.ReactNode => {
    const ids = tree.childrenOf.get(parentKey) ?? [];
    if (!ids.length) return null;
    return (
      <ul>
        {ids.map((id) => {
          const item = tree.items.get(id);
          if (!item) return null;
          return renderNode(item, level);
        })}
      </ul>
    );
  };

  const renderNode = (item: ConcurListItem, level: number): React.ReactNode => {
    if (filtering && !filterVisible.has(item.id)) return null;
    const open = filtering ? true : expanded.has(item.id);
    const hasKids = !!item.hasChildren;
    const kidsLoaded = tree.loadedParents.has(item.id);
    const isLoading = loadingNodes.has(item.id);
    const nodeErr = nodeErrors.get(item.id);

    return (
      <li key={item.id}>
        <div
          className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent/60"
          style={{ marginLeft: `${(level - 1) * 1.25}rem` }}
        >
          <button
            onClick={() => hasKids && toggle(item)}
            aria-label={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            disabled={!hasKids}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors ${
              hasKids ? 'hover:bg-accent hover:text-foreground' : 'opacity-0'
            }`}
          >
            {isLoading ? (
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

          <div className="min-w-0 flex-1 leading-tight">
            <span className="break-words text-sm font-medium">{item.value ?? item.id}</span>
            {(item.code || item.shortCode) && (
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {item.code ?? ''}
                {item.shortCode && item.shortCode !== item.code ? ` · ${item.shortCode}` : ''}
              </span>
            )}
          </div>

          {hasKids && kidsLoaded && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
              {(tree.childrenOf.get(item.id) ?? []).length}
            </span>
          )}
        </div>

        {nodeErr && (
          <div className="mb-1 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive" style={{ marginLeft: `${(level - 1) * 1.25 + 1.75}rem` }}>
            Failed to load children: {nodeErr}
            <button onClick={() => void loadLevel(item.id)} className="underline hover:no-underline">
              Retry
            </button>
          </div>
        )}

        {hasKids && open && renderChildren(item.id, level + 1)}
      </li>
    );
  };

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
        <ul className="max-h-[480px] overflow-auto rounded-md border bg-background/50 p-1.5">
          {rootIds.map((id) => {
            const item = tree.items.get(id);
            return item ? renderNode(item, 1) : null;
          })}
        </ul>
      )}

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {loadedCount.toLocaleString()} item{loadedCount === 1 ? '' : 's'} loaded · expand a node to load its children
      </p>
    </div>
  );
}
