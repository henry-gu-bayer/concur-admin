import { useCallback, useEffect, useRef, useSyncExternalStore, useState } from 'react';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
import { InfoIcon } from '@phosphor-icons/react/dist/csr/Info';
import { AuthStatus } from './components/AuthStatus';
import { EnvironmentPicker, entityTone, isUat } from './components/EnvironmentPicker';
import { HomeView } from './components/HomeView';
import { Button } from './components/ui/Button';
import { Modal } from './components/ui/Modal';
import { getLocationsSearchSnapshot, subscribeLocationsSearch } from './components/locationsSearchStore';
import { getActiveEntityId, getEntities, subscribeEntities } from './entities/entityStore';
import { categories, groupedCategories } from './registry/categories';
import { getCategoryNavigationRequest, subscribeViewNavigation } from './state/viewNavigation';
import { ReturnHome, WorkspaceVisible } from './state/workspaceVisibility';
import type { CategoryDescriptor } from './types';

function Workspaces({ active, entityId }: { active: CategoryDescriptor | undefined; entityId: string }) {
  const [visited, setVisited] = useState<CategoryDescriptor[]>([]);
  if (active && !visited.includes(active)) setVisited([...visited, active]);

  return visited.map((category) => {
    const visible = category === active;
    const splitPane = ['locations', 'localities', 'users', 'forms', 'sae-check'].includes(category.id);
    return (
      <WorkspaceVisible.Provider key={category.id} value={visible}>
        <div hidden={!visible} className={visible ? `flex min-h-0 flex-1 flex-col overflow-auto px-5 py-5 sm:px-7 ${splitPane ? 'xl:overflow-hidden' : ''}` : 'hidden'}>
          <div className={`min-h-0 flex-1 ${splitPane ? 'xl:overflow-hidden' : ''}`}>
            <div className="h-full min-h-0">{category.render({ entityId })}</div>
          </div>
        </div>
      </WorkspaceVisible.Provider>
    );
  });
}

export default function App() {
  const [activeId, setActiveId] = useState('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const homeButtonRef = useRef<HTMLButtonElement>(null);
  const focusHeading = useRef(false);
  const activeEntityId = useSyncExternalStore(subscribeEntities, getActiveEntityId, getActiveEntityId);
  const entities = useSyncExternalStore(subscribeEntities, getEntities, getEntities);
  const activeEntity = entities.find((entity) => entity.id === activeEntityId);
  const uat = activeEntity ? isUat(activeEntity.id, activeEntity.label) : false;
  const subscribeLocationTask = useCallback((listener: () => void) => subscribeLocationsSearch(activeEntityId, listener), [activeEntityId]);
  const getLocationTask = useCallback(() => getLocationsSearchSnapshot(activeEntityId), [activeEntityId]);
  const locationTask = useSyncExternalStore(subscribeLocationTask, getLocationTask, getLocationTask);
  const active = categories.find((category) => category.id === activeId);
  const aboutTitle = `About ${active?.label ?? 'Home'}`;
  const closeDescription = () => setDescriptionOpen(false);

  const openCategory = useCallback((categoryId: string) => {
    setActiveId(categoryId);
    setDescriptionOpen(false);
  }, []);
  const openHome = useCallback(() => {
    focusHeading.current = true;
    openCategory('home');
  }, [openCategory]);

  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    const target = activeId === 'home' ? homeButtonRef.current : headingRef.current;
    target?.focus();
  }, [activeId]);

  // Views publish cross-view navigation requests through a module store; the
  // shell owns the active category, so it applies them here.
  useEffect(() => subscribeViewNavigation(() => {
    const request = getCategoryNavigationRequest();
    if (!request || !categories.some((category) => category.id === request.categoryId)) return;
    openCategory(request.categoryId);
  }), [openCategory]);

  // The active sidebar item wears the same tone as the entity picker trigger:
  // magenta under UAT, the blue accent everywhere else. Inactive items keep a
  // transparent border so selection never shifts the layout.
  const activeNavTone = entityTone(activeEntity);
  const runningBadgeTone = uat ? 'bg-uat/10 text-uat' : 'bg-primary/10 text-primary';

  const renderNavButton = ({ id, label, icon }: Pick<CategoryDescriptor, 'id' | 'label' | 'icon'>) => {
    const isActive = id === activeId;
    return (
      <button
        ref={id === 'home' ? homeButtonRef : undefined}
        type="button"
        onClick={() => openCategory(id)}
        aria-current={isActive ? 'page' : undefined}
        title={sidebarCollapsed ? label : undefined}
        className={`flex w-full items-center rounded-md text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${sidebarCollapsed ? 'justify-center px-2 py-2.5 lg:py-3.5' : 'gap-2.5 px-2.5 py-2'} ${
          isActive ? `border font-medium ${activeNavTone}` : 'border border-transparent text-foreground hover:bg-accent hover:text-foreground'
        }`}
      >
        <span className={`h-5 w-5 shrink-0 ${isActive ? 'text-current' : 'text-muted-foreground'}`}>
          {icon}
        </span>
        <span className={sidebarCollapsed ? 'sr-only' : 'flex-1 truncate text-left'}>{label}</span>
        {id === 'locations' && locationTask.action && (
          <span className={sidebarCollapsed ? 'sr-only' : `rounded-full px-1.5 py-0.5 text-[10px] font-medium ${runningBadgeTone}`} aria-label="Locations query running">
            Running
          </span>
        )}
      </button>
    );
  };

  return <ReturnHome.Provider value={openHome}>
    {/* A UAT tenant frames the whole app, sidebar included, as Concur's own
        test environments do. The frame uses the full UAT magenta; the
        lighter 30% borders are reserved for the picker, sidebar, and Home icons. The 4px border is always reserved and only its
        color changes, so switching entities never shifts the layout. It is a
        real border rather than an overlay, so it never covers scrollbars or
        click targets. */}
    <div
      data-environment={uat ? 'uat' : undefined}
      className={`flex h-screen overflow-hidden border-4 transition-colors duration-fast motion-reduce:transition-none ${uat ? 'border-uat' : 'border-transparent'}`}
    >
      {/* ── Category sidebar (navigation only) ───────────── */}
      <nav
        aria-label="Configuration categories"
        className={`sticky top-0 flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-muted text-foreground ${sidebarCollapsed ? 'w-16 lg:w-[4.625rem]' : 'w-64 max-sm:w-40'}`}
      >
        <div className={`shrink-0 pt-2 lg:pt-3 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {renderNavButton({ id: 'home', label: 'Home', icon: <HouseIcon aria-hidden="true" size={20} /> })}
        </div>

        <div className={`flex-1 overflow-y-auto py-2 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {groupedCategories(categories.filter((category) => !category.sidebarFooter)).map(({ group, items }) => (
            <div key={group} className={sidebarCollapsed ? 'mb-1' : 'mb-5'}>
              <p className={sidebarCollapsed ? 'sr-only' : 'mb-2 px-2 text-xs font-medium text-muted-foreground'}>
                {group}
              </p>
              <ul className="space-y-0.5">
                {items.map((category) => <li key={category.id}>{renderNavButton(category)}</li>)}
              </ul>
            </div>
          ))}
        </div>

        <div className={`border-t border-border py-3 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          <ul className="space-y-0.5">
            {categories.filter((category) => category.sidebarFooter).map((category) => <li key={category.id}>{renderNavButton(category)}</li>)}
          </ul>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={`mt-1.5 flex w-full items-center rounded-md py-2 text-xs text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${sidebarCollapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'}`}
          >
            {sidebarCollapsed ? <CaretRightIcon aria-hidden="true" size={18} /> : <CaretLeftIcon aria-hidden="true" size={18} />}
            <span className={sidebarCollapsed ? 'sr-only' : undefined}>Collapse navigation</span>
          </button>
        </div>
      </nav>

      {/* ── Main column ─────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-sticky flex min-h-[4.125rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-background px-4 py-3.5 sm:px-6">
          {active ? (
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <h1 ref={headingRef} tabIndex={-1} className="truncate text-lg font-semibold leading-tight">{active.label}</h1>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={aboutTitle}
                title={aboutTitle}
                aria-haspopup="dialog"
                onClick={() => setDescriptionOpen(true)}
                className="shrink-0 text-muted-foreground"
              >
                <InfoIcon size={18} aria-hidden="true" />
              </Button>
            </div>
          ) : <p className="text-lg font-semibold leading-tight">Home</p>}
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <EnvironmentPicker />
            <AuthStatus />
          </div>
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!active && (
            <div className="overflow-auto">
              <HomeView onOpenCategory={(id) => {
                focusHeading.current = true;
                openCategory(id);
              }} />
            </div>
          )}
          {/* Views keep their work while hidden. Switching entities discards the
              mounted workspaces so old requests never populate the new UI. */}
          <Workspaces key={activeEntityId} active={active} entityId={activeEntityId} />
        </main>
      </div>
      {active && (
        <Modal
          open={descriptionOpen}
          onClose={closeDescription}
          title={aboutTitle}
          className="flex max-h-[calc(100dvh-2rem)] flex-col"
          bodyClassName="min-h-0 overflow-y-auto"
          footer={<Button type="button" size="sm" onClick={closeDescription}>Done</Button>}
        >
          <p className="text-sm leading-6 text-muted-foreground">{active.description}</p>
        </Modal>
      )}
    </div>
  </ReturnHome.Provider>;
}
