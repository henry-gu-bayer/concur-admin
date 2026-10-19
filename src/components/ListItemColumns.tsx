/** Shared fixed-height tree columns keep names, codes and IDs aligned while
 * preserving virtual scrolling and horizontal access on narrow screens. */
export const listItemColumnsClass = 'grid min-w-[48rem] grid-cols-[minmax(16rem,1fr)_8rem_minmax(20rem,1.2fr)] items-center gap-3 px-3';
export const compactListItemColumnsClass = 'grid min-w-[22rem] grid-cols-[minmax(6rem,1fr)_3.5rem_minmax(9rem,1.2fr)] items-center gap-2 px-2';

export function ListItemColumnHeader({ version, compact = false }: { version: 'v3' | 'v4'; compact?: boolean }) {
  return <div className={`${compact ? compactListItemColumnsClass : listItemColumnsClass} sticky top-0 z-10 h-8 border-b bg-muted text-xs font-medium text-muted-foreground`}>
    <span>Name</span><span>Code</span><span>{version} ID</span>
  </div>;
}
