import { memo, useMemo, useState } from 'react';
import { ConcurListItemV3 } from '../types';
import { useVirtualTableRows } from './useVirtualTableRows';
import { ListItemColumnHeader, compactListItemColumnsClass, listItemColumnsClass } from './ListItemColumns';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';

/**
 * Tree view for v3 list items.
 *
 * Unlike v4's lazy-loading ItemTree, v3 items are fetched as a flat list
 * and the tree is reconstructed client-side from ParentID fields.
 * This is simpler since v3 returns all items for a list in one stream.
 */

const LEVEL_COLORS = [
  'bg-primary/10 text-primary border-primary/20',
  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
];

const ROW_HEIGHT = 30;
const VIEWPORT_HEIGHT = 480;
const FILTER_DEBOUNCE_MS = 250;
const INDENT_REM = 1.25;

interface TreeNode {
  item: ConcurListItemV3;
  children: TreeNode[];
  depth: number;
}

function buildTree(items: ConcurListItemV3[]): TreeNode[] {
  const childrenMap = new Map<string | null | undefined, ConcurListItemV3[]>();
  for (const item of items) {
    const parentKey = item.ParentID || null;
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
    childrenMap.get(parentKey)!.push(item);
  }

  const buildNode = (item: ConcurListItemV3, depth: number): TreeNode => ({
    item,
    children: (childrenMap.get(item.ID) ?? []).map((child) => buildNode(child, depth + 1)),
    depth,
  });

  // Root items have no ParentID
  return (childrenMap.get(null) ?? []).map((item) => buildNode(item, 1));
}

function flattenTree(
  nodes: TreeNode[],
  expanded: Set<string>,
  filterFn?: (item: ConcurListItemV3) => boolean
): Array<{ node: TreeNode; depth: number }> {
  const result: Array<{ node: TreeNode; depth: number }> = [];
  const matchesBranch = (node: TreeNode): boolean => !filterFn || filterFn(node.item) || node.children.some(matchesBranch);
  const walk = (node: TreeNode, depth: number) => {
    if (!matchesBranch(node)) return;
    result.push({ node, depth });
    if (expanded.has(node.item.ID) || filterFn) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  };
  for (const node of nodes) {
    walk(node, 1);
  }
  return result;
}

function itemLabel(item: ConcurListItemV3): string {
  const code = (item.Level1Code ?? '').trim();
  const name = (item.Name ?? '').trim();
  return name || code || item.ID;
}

function itemSearchText(item: ConcurListItemV3): string {
  return [
    item.Name ?? '',
    item.Level1Code ?? '',
    item.Level2Code ?? '',
    item.Level3Code ?? '',
    item.Level4Code ?? '',
    item.Level5Code ?? '',
    item.ID ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

interface ItemTreeV3Props {
  items: ConcurListItemV3[];
  compact?: boolean;
  filterQuery?: string;
  selectedId?: string;
  onSelect?: (item: ConcurListItemV3) => void;
}

export const ItemTreeV3 = memo(function ItemTreeV3({ items, compact = false, filterQuery, selectedId, onSelect }: ItemTreeV3Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');

  const tree = useMemo(() => buildTree(items), [items]);

  const effectiveQuery = filterQuery ?? appliedQuery;
  const filterFn = useMemo(() => {
    if (!effectiveQuery) return undefined;
    const q = effectiveQuery.toLowerCase();
    return (item: ConcurListItemV3) => itemSearchText(item).includes(q);
  }, [effectiveQuery]);

  const flatRows = useMemo(() => flattenTree(tree, expanded, filterFn), [tree, expanded, filterFn]);

  const { scrollRef, range, onScroll } = useVirtualTableRows({
    rowCount: flatRows.length,
    headerHeight: 32,
    rowHeight: compact ? 56 : ROW_HEIGHT,
  });

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const allIds = new Set<string>();
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) allIds.add(n.item.ID);
        collect(n.children);
      }
    };
    collect(tree);
    setExpanded(allIds);
  };

  const collapseAll = () => setExpanded(new Set());

  const handleFilterChange = (value: string) => {
    setQuery(value);
    clearTimeout((handleFilterChange as unknown as { timer?: ReturnType<typeof setTimeout> }).timer);
    (handleFilterChange as unknown as { timer: ReturnType<typeof setTimeout> }).timer = setTimeout(() => {
      setAppliedQuery(value);
    }, FILTER_DEBOUNCE_MS);
  };

  const visibleRows = flatRows.slice(range.start, range.end);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => handleFilterChange(e.target.value)}
          placeholder={`Filter ${items.length} item${items.length === 1 ? '' : 's'}…`}
          aria-label="Filter items"
          className={`${filterQuery !== undefined ? 'hidden' : ''} h-8 min-w-[180px] flex-1 rounded-md border bg-background px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-xs`}
        />
        <div className="flex items-center gap-1">
          <button onClick={expandAll} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            Expand all
          </button>
          <button onClick={collapseAll} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            Collapse all
          </button>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {items.length} items
          {appliedQuery && ` · ${flatRows.length} match`}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          This list has no items.
        </p>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          role="tree"
          aria-label="List items"
          className="overflow-auto rounded-md border bg-background/50"
          style={{ maxHeight: compact ? 220 : VIEWPORT_HEIGHT }}
        >
          <ListItemColumnHeader version="v3" compact={compact} />
          <div aria-hidden="true" style={{ height: range.topSpacerHeight }} />
          {visibleRows.map(({ node, depth }) => {
            const hasChildren = node.children.length > 0;
            const isOpen = expanded.has(node.item.ID) || !!filterFn;
            const colorClass = LEVEL_COLORS[(depth - 1) % LEVEL_COLORS.length];

            return (
              <div
                key={node.item.ID}
                role="treeitem"
                aria-expanded={hasChildren ? isOpen : undefined}
                aria-level={depth}
                className={`${compact ? compactListItemColumnsClass : listItemColumnsClass} border-b border-border/50 hover:bg-accent/50 ${selectedId === node.item.ID ? 'bg-primary/10' : ''}`}
                style={{ height: compact ? 56 : ROW_HEIGHT }}
              >
                <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${(depth - 1) * INDENT_REM}rem` }}>
                {hasChildren ? (
                  <button
                    onClick={() => toggleExpand(node.item.ID)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-muted-foreground hover:bg-accent"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                  >
                    <CaretRightIcon aria-hidden="true" size={14} className={isOpen ? 'rotate-90' : ''} />
                  </button>
                ) : (
                  <span className="w-5 shrink-0" />
                )}
                {!compact ? <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
                  L{depth}
                </span> : null}
                {onSelect ? <button type="button" aria-label={`View v3 item ${itemLabel(node.item)}`} className="min-w-0 break-words text-left text-xs font-medium hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelect(node.item)}>{itemLabel(node.item)}</button> : <span className="min-w-0 flex-1 truncate text-sm" title={itemLabel(node.item)}>{itemLabel(node.item)}</span>}
                </div>
                <span className="truncate font-mono text-xs text-muted-foreground">{node.item[`Level${depth}Code` as keyof ConcurListItemV3] ?? node.item.Level1Code ?? '—'}</span>
                <span className={`select-text font-mono text-xs text-muted-foreground ${compact ? 'break-all' : 'shrink-0'}`}>{compact ? node.item.ID : `v3 ID: ${node.item.ID}`}</span>
              </div>
            );
          })}
          <div aria-hidden="true" style={{ height: range.bottomSpacerHeight }} />
        </div>
      )}
    </div>
  );
});
