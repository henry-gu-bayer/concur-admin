import { useEffect, useMemo, useState } from 'react';
import { CategoryDescriptor, ConfigItem } from '../types';
import { CategoryScaffold } from './CategoryScaffold';
import { ConfigTable } from './ConfigTable';
import { Input } from './ui/Input';

type StatusFilter = 'all' | 'active' | 'inactive';

const filters: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
];

/**
 * Main-stage orchestrator. Given the selected category descriptor it owns
 * retrieval state, search, and status filtering, then hands data to the
 * generic ConfigTable — identical behavior for every category, past and future.
 */
export function CategoryBrowser({ category }: { category: CategoryDescriptor }) {
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpandedId(null);
    setStatusFilter('all');
    setQuery('');

    category
      .fetchItems()
      .then((data) => !cancelled && setItems(data))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [category]);

  const visible = useMemo(() => {
    let list = items;
    if (statusFilter !== 'all') list = list.filter((i) => i.status === statusFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (i) => i.name.toLowerCase().includes(q) || i.summary?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, statusFilter, query]);

  if (!category.implemented) {
    return <CategoryScaffold category={category} />;
  }

  return (
    <div>
      {/* Slim toolbar: filter + search */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1" role="group" aria-label="Filter by status">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              aria-pressed={statusFilter === f.id}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                statusFilter === f.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${category.label.toLowerCase()}…`}
            aria-label={`Search ${category.label}`}
            className="pl-9"
          />
        </div>
        <p className="ml-auto hidden text-xs text-muted-foreground sm:block" aria-live="polite">
          {visible.length} of {items.length} {category.label.toLowerCase()}
        </p>
      </div>

      {/* Main stage */}
      {loading ? (
        <ConfigTable category={category} items={[]} loading expandedId={null} onToggle={() => {}} />
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-16 text-center" role="alert">
          <h2 className="text-base font-semibold text-destructive">Couldn't retrieve {category.label.toLowerCase()}</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{error}. Check the connection and try again.</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              category.fetchItems().then(setItems).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
            }}
            className="mt-5 rounded-md border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry retrieval
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
          <h2 className="text-base font-semibold">No {category.label.toLowerCase()} configured</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            This Concur entity returned no {category.label.toLowerCase()}. They may not be set up yet.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
          <h2 className="text-base font-semibold">Nothing matches these filters</h2>
          <p className="mt-1 text-sm text-muted-foreground">Try a different status or clear the search.</p>
          <button
            onClick={() => {
              setStatusFilter('all');
              setQuery('');
            }}
            className="mt-5 rounded-md border border-input bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ConfigTable
          category={category}
          items={visible}
          loading={false}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
        />
      )}

      {!loading && !error && items.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Retrieved from Concur just now · <button className="font-medium text-primary hover:underline">View raw JSON</button>
        </p>
      )}
    </div>
  );
}
