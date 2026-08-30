import { useCallback, useSyncExternalStore, useState } from 'react';
import { AuthStatus } from './components/AuthStatus';
import { ApiLogsView } from './components/ApiLogsView';
import { getLocationsSearchSnapshot, subscribeLocationsSearch } from './components/locationsSearchStore';
import { Badge } from './components/ui/Badge';
import { categories, groupedCategories } from './registry/categories';
import { getActiveEntityId, getEntities, setActiveEntity, subscribeEntities } from './entities/entityStore';
import { initAuth, selectAuthEntity } from './auth/tokenStore';

export default function App() {
  const [activeId, setActiveId] = useState('lists');
  const [showApiLogs, setShowApiLogs] = useState(false);
  const entities = useSyncExternalStore(subscribeEntities, getEntities, getEntities);
  const activeEntityId = useSyncExternalStore(subscribeEntities, getActiveEntityId, getActiveEntityId);
  const subscribeLocationTask = useCallback((listener: () => void) => subscribeLocationsSearch(activeEntityId, listener), [activeEntityId]);
  const getLocationTask = useCallback(() => getLocationsSearchSnapshot(activeEntityId), [activeEntityId]);
  const locationTask = useSyncExternalStore(subscribeLocationTask, getLocationTask, getLocationTask);
  const active = categories.find((c) => c.id === activeId) ?? categories[0];
  const activeEntity = entities.find((entity) => entity.id === activeEntityId);
  const productionEntity = /production|prod/i.test(`${activeEntity?.id ?? ''} ${activeEntity?.label ?? ''}`);
  const groups = groupedCategories();

  return (
    <div className="flex h-screen overflow-hidden">
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
                  const isActive = cat.id === activeId && !showApiLogs;
                  return (
                    <li key={cat.id}>
                      <button
                        onClick={() => { setActiveId(cat.id); setShowApiLogs(false); }}
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
                        {cat.id === 'locations' && locationTask.action && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" aria-label="Locations query running">
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

        <div className="border-t px-3 py-3">
          <button
            type="button"
            onClick={() => setShowApiLogs(true)}
            aria-current={showApiLogs ? 'page' : undefined}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              showApiLogs ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-accent'
            }`}
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 5.5h16M4 12h16M4 18.5h10" strokeLinecap="round" />
              <circle cx="17.5" cy="18.5" r="2.5" />
            </svg>
            API Logs
          </button>
        </div>

        <div className="border-t px-3 py-3">
          <label className="mb-1 block px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="active-concur-entity">Entity</label>
          <select
            id="active-concur-entity"
            aria-label="Active Concur entity"
            value={activeEntityId}
            onChange={(event) => {
              setActiveEntity(event.target.value);
              selectAuthEntity();
              void initAuth();
            }}
            className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.label}</option>)}
          </select>
        </div>
      </nav>

      {/* ── Main column ─────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-sticky flex items-center justify-between gap-4 border-b bg-background px-5 py-3.5 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-lg font-semibold leading-tight">{showApiLogs ? 'API Logs' : active.label}</h1>
          </div>
          <div className="flex items-center gap-3">
            {activeEntity && (
              <span aria-label={`Active entity: ${activeEntity.label}`}>
                <Badge tone={productionEntity ? 'warning' : 'primary'} dot>{activeEntity.label}</Badge>
              </span>
            )}
            <AuthStatus />
          </div>
        </header>

        <main className={`flex min-h-0 flex-1 flex-col overflow-auto px-5 py-5 sm:px-7 ${!showApiLogs && (active.id === 'locations' || active.id === 'localities' || active.id === 'users') ? 'xl:overflow-hidden' : ''}`}>
          <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{showApiLogs ? 'Read-only local Concur API call logs. Select an entry to inspect its response payload.' : active.description}</p>
          <div className={`min-h-0 flex-1 ${!showApiLogs && (active.id === 'locations' || active.id === 'localities' || active.id === 'users') ? 'xl:overflow-hidden' : ''}`}>
          {showApiLogs
            ? <ApiLogsView key={activeEntityId} />
            : <div key={`${active.id}-${activeEntityId}`} className="h-full min-h-0">{active.render({ entityId: activeEntityId })}</div>}
          </div>
        </main>
      </div>
    </div>
  );
}
