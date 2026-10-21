/** Fixed-height item columns keep names and codes aligned while preserving
 * virtual scrolling and horizontal access on narrow screens. The version-
 * specific IDs belong to the detail pane; one merged list needs only the two
 * fields both API versions share. */
export const listItemColumnsClass = 'grid min-w-[16rem] grid-cols-[minmax(8rem,1fr)_minmax(5rem,0.45fr)] items-center gap-3 px-3';

export function ListItemColumnHeader() {
  return <div className={`${listItemColumnsClass} sticky top-0 z-10 h-8 border-b bg-muted text-xs font-medium text-muted-foreground`}>
    <span>Name</span><span>Code</span>
  </div>;
}