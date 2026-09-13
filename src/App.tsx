import { useCallback, useSyncExternalStore, useState } from 'react';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { AuthStatus } from './components/AuthStatus';
import { ApiLogsView } from './components/ApiLogsView';
import { EnvironmentPicker } from './components/EnvironmentPicker';
import { getLocationsSearchSnapshot, subscribeLocationsSearch } from './components/locationsSearchStore';
import { getActiveEntityId, subscribeEntities } from './entities/entityStore';
import { categories, groupedCategories } from './registry/categories';

export default function App() {
  const [activeId, setActiveId] = useState('lists');
  const [showApiLogs, setShowApiLogs] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const activeEntityId = useSyncExternalStore(subscribeEntities, getActiveEntityId, getActiveEntityId);
  const subscribeLocationTask = useCallback((listener: () => void) => subscribeLocationsSearch(activeEntityId, listener), [activeEntityId]);
  const getLocationTask = useCallback(() => getLocationsSearchSnapshot(activeEntityId), [activeEntityId]);
  const locationTask = useSyncExternalStore(subscribeLocationTask, getLocationTask, getLocationTask);
  const active = categories.find((c) => c.id === activeId) ?? categories[0];
  const groups = groupedCategories();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Category sidebar (navigation only) ───────────── */}
      <nav
        aria-label="Configuration categories"
        className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r bg-card transition-all duration-200 ease-out ${sidebarCollapsed ? 'w-16' : 'w-64'}`}
      >
        <div className={`flex items-center border-b py-4 ${sidebarCollapsed ? 'justify-center px-2' : 'gap-2.5 px-5'}`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground" aria-hidden="true">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M16.76 7.24 A5.5 5.5 0 1 0 16.76 16.76" strokeLinecap="butt" />
            </svg>
          </span>
          <div className={sidebarCollapsed ? 'sr-only' : 'min-w-0'}>
            <p className="truncate text-sm font-semibold leading-tight">Concur Admin</p>
          </div>
        </div>

        <div className={`flex-1 overflow-y-auto py-4 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {groups.map(({ group, items }) => (
            <div key={group} className={sidebarCollapsed ? 'mb-3' : 'mb-5'}>
              <p className={sidebarCollapsed ? 'sr-only' : 'mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground'}>
                {group}
              </p>
              <ul className="space-y-0.5">
                {items.map((cat) => {
                  const isActive = cat.id === activeId && !showApiLogs;
                  return (
                    <li key={cat.id}>
                      <button
                        onClick={() => { setActiveId(cat.id); setShowApiLogs(false); }}
                        aria-current={isActive ? 'page' : undefined}
                        title={sidebarCollapsed ? cat.label : undefined}
                        className={`flex w-full items-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-2.5 py-2'} ${
                          isActive
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-foreground hover:bg-accent'
                        }`}
                      >
                        <span className={`h-5 w-5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                          {cat.icon}
                        </span>
                        <span className={sidebarCollapsed ? 'sr-only' : 'flex-1 truncate text-left'}>{cat.label}</span>
                        {cat.id === 'locations' && locationTask.action && (
                          <span className={sidebarCollapsed ? 'sr-only' : 'rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary'} aria-label="Locations query running">
                            Running
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

        <div className={`border-t py-3 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          <button
            type="button"
            onClick={() => setShowApiLogs(true)}
            aria-current={showApiLogs ? 'page' : undefined}
            title={sidebarCollapsed ? 'API Logs' : undefined}
            className={`flex w-full items-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-2.5 py-2'} ${
              showApiLogs ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-accent'
            }`}
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 5.5h16M4 12h16M4 18.5h10" strokeLinecap="round" />
              <circle cx="17.5" cy="18.5" r="2.5" />
            </svg>
            <span className={sidebarCollapsed ? 'sr-only' : undefined}>API Logs</span>
          </button>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={`mt-1.5 flex w-full items-center rounded-md py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sidebarCollapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'}`}
          >
            {sidebarCollapsed ? <CaretRightIcon aria-hidden="true" size={18} /> : <CaretLeftIcon aria-hidden="true" size={18} />}
            <span className={sidebarCollapsed ? 'sr-only' : undefined}>Collapse navigation</span>
          </button>
        </div>

              </nav>

      {/* ── Main column ─────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-sticky flex items-center justify-between gap-4 border-b bg-background px-5 py-3.5 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-lg font-semibold leading-tight">{showApiLogs ? 'API Logs' : active.label}</h1>
          </div>
          <div className="flex items-center gap-3">
            <EnvironmentPicker />
            <AuthStatus />
          </div>
        </header>

        <main className={`flex min-h-0 flex-1 flex-col overflow-auto px-5 py-5 sm:px-7 ${!showApiLogs && (active.id === 'locations' || active.id === 'localities' || active.id === 'users' || active.id === 'forms') ? 'xl:overflow-hidden' : ''}`}>
          <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{showApiLogs ? 'Read-only local Concur API call logs. Select an entry to inspect its response payload.' : active.description}</p>
          <div className={`min-h-0 flex-1 ${!showApiLogs && (active.id === 'locations' || active.id === 'localities' || active.id === 'users' || active.id === 'forms') ? 'xl:overflow-hidden' : ''}`}>
          {showApiLogs
            ? <ApiLogsView key={activeEntityId} />
            : <div key={`${active.id}-${activeEntityId}`} className="h-full min-h-0">{active.render({ entityId: activeEntityId })}</div>}
          </div>
        </main>
      </div>
    </div>
  );
}
