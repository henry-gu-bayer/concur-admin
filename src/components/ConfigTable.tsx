import { Fragment } from 'react';
import { CategoryDescriptor, ConfigItem } from '../types';
import { Badge } from './ui/Badge';
import { RowDetail } from './RowDetail';

function relativeDays(iso: string): string {
  const days = Math.round((Date.parse('2026-08-03T08:14:00Z') - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const m = Math.floor(days / 30);
  return m < 12 ? `${m} mo ago` : `${Math.floor(m / 12)} yr ago`;
}

const hideCls: Record<string, string> = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

interface Props {
  category: CategoryDescriptor;
  items: ConfigItem[];
  loading: boolean;
  expandedId: string | null;
  onToggle: (id: string) => void;
}

/**
 * Generic configuration-object table. Renders ANY category from its
 * descriptor's `columns` + each item's `row` map. This is the main stage.
 */
export function ConfigTable({ category, items, loading, expandedId, onToggle }: Props) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card" aria-busy="true" aria-label={`Loading ${category.label}`}>
        <div className="border-b bg-muted/50 px-4 py-3 sm:px-6">
          <div className="h-3 w-48 rounded bg-muted-foreground/20 animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-0 sm:px-6">
            <div className="h-4 flex-1 rounded bg-muted animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]" />
            <div className="hidden h-4 w-16 rounded bg-muted md:block" />
            <div className="h-5 w-16 rounded-full bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <table className="w-full text-sm" aria-label={`${category.label} configuration objects`}>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-3 sm:px-6">Name</th>
            {category.columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : ''} ${c.hideBelow ? hideCls[c.hideBelow] : 'hidden md:table-cell'}`}
              >
                {c.label}
              </th>
            ))}
            <th scope="col" className="px-4 py-3">Status</th>
            <th scope="col" className="hidden px-4 py-3 lg:table-cell">Updated</th>
            <th scope="col" className="px-4 py-3 text-right sm:px-6"><span className="sr-only">Expand</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <Fragment key={item.id}>
                <tr
                  onClick={() => onToggle(item.id)}
                  aria-expanded={expanded}
                  className={`cursor-pointer border-b transition-colors last:border-0 hover:bg-accent/50 ${
                    expanded ? 'bg-accent/40' : ''
                  } ${item.status === 'inactive' ? 'opacity-70' : ''}`}
                >
                  <td className="px-4 py-3.5 sm:px-6">
                    <div className="font-medium leading-tight">{item.name}</div>
                    {item.summary && <div className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">{item.summary}</div>}
                  </td>
                  {category.columns.map((c) => (
                    <td
                      key={c.id}
                      className={`px-4 py-3.5 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-muted-foreground'} ${c.hideBelow ? hideCls[c.hideBelow] : 'hidden md:table-cell'}`}
                    >
                      {item.row[c.id]}
                    </td>
                  ))}
                  <td className="px-4 py-3.5">
                    <Badge tone={item.status === 'active' ? 'primary' : 'muted'}>
                      {item.status === 'active' ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="hidden px-4 py-3.5 text-muted-foreground lg:table-cell">{relativeDays(item.updatedAt)}</td>
                  <td className="px-4 py-3.5 text-right sm:px-6">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(item.id);
                      }}
                      aria-label={expanded ? `Collapse ${item.name}` : `Expand ${item.name}`}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <svg
                        className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
                      >
                        <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={category.columns.length + 4} className="p-0">
                      <RowDetail item={item} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
