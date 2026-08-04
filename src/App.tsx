import { useState } from 'react';
import { AuthStatus } from './components/AuthStatus';
import { CategoryBrowser } from './components/CategoryBrowser';
import { ExpenseGroupsView } from './components/ExpenseGroupsView';
import { ListsView } from './components/ListsView';
import { Badge } from './components/ui/Badge';
import { Button } from './components/ui/Button';
import { categories, groupedCategories } from './registry/categories';

export default function App() {
  const [activeId, setActiveId] = useState('lists');
  const active = categories.find((c) => c.id === activeId) ?? categories[0];
  const groups = groupedCategories();

  return (
    <div className="flex min-h-screen">
      {/* ── Category sidebar (navigation only) ───────────── */}
      <nav aria-label="Configuration categories" className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r bg-card">
        <div className="flex items-center gap-2.5 border-b px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground" aria-hidden="true">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-3Z" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">Concur Config</p>
            <p className="truncate text-xs text-muted-foreground">Admin browser</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map(({ group, items }) => (
            <div key={group} className="mb-5">
              <p className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </p>
              <ul className="space-y-0.5">
                {items.map((cat) => {
                  const isActive = cat.id === activeId;
                  return (
                    <li key={cat.id}>
                      <button
                        onClick={() => setActiveId(cat.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isActive
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-foreground hover:bg-accent'
                        }`}
                      >
                        <span className={`h-4.5 w-4.5 h-5 w-5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                          {cat.icon}
                        </span>
                        <span className="flex-1 truncate text-left">{cat.label}</span>
                        {!cat.implemented && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            soon
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t px-5 py-3">
          <p className="text-xs text-muted-foreground">Entity: <span className="font-medium text-foreground">Bayer · EU Production</span></p>
        </div>
      </nav>

      {/* ── Main column ─────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-sticky flex items-center justify-between gap-4 border-b bg-background px-5 py-3.5 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-lg font-semibold leading-tight">{active.label}</h1>
            {!active.implemented && <Badge>scaffold</Badge>}
          </div>
          <div className="flex items-center gap-3">
            <AuthStatus />
            <Button variant="ghost" size="sm" aria-label="Connection settings">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Button>
          </div>
        </header>

        <main className="flex-1 px-5 py-5 sm:px-7">
          <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{active.description}</p>
          {active.id === 'lists' ? (
            <ListsView />
          ) : active.id === 'expense-groups' ? (
            <ExpenseGroupsView />
          ) : (
            <CategoryBrowser key={active.id} category={active} />
          )}
        </main>
      </div>
    </div>
  );
}
