import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getActiveEntityId, getEntities, setActiveEntity, type ConcurEntity, subscribeEntities } from '../entities/entityStore';
import { selectAuthEntity, initAuth, entityHasToken, subscribe as subscribeToken } from '../auth/tokenStore';

/** Derive a display region label from the entity id prefix. */
function regionFor(id: string): string {
  const prefix = id.split('-')[0] ?? '';
  return prefix.toUpperCase();
}

/**
 * Split a label into its leading region code and the rest, so the trigger can
 * set the region (US / EU) in bold. A label that doesn't start with the
 * entity's region code is returned whole.
 */
function splitRegion(entity: ConcurEntity): { region: string; rest: string } {
  const region = regionFor(entity.id);
  return region && entity.label.toUpperCase().startsWith(`${region} `)
    ? { region: entity.label.slice(0, region.length), rest: entity.label.slice(region.length) }
    : { region: '', rest: entity.label };
}

/** Is this entity a UAT (test) environment? */
export function isUat(id: string, label: string): boolean {
  return /uat/i.test(`${id} ${label}`);
}

/**
 * Border, tint, and text classes marking an entity's environment. A UAT entity
 * uses the same magenta as the app frame; production and every other entity
 * use the blue accent, which contrasts strongly with magenta. (Amber was
 * dropped for production because it read too close to the UAT magenta.)
 * The entity picker trigger, the active sidebar item, and the Home feature
 * icons share this tone so they always agree. Their UAT border is magenta at
 * 30% opacity; only the app frame uses the full-strength magenta.
 */
export function entityTone(entity: ConcurEntity | undefined): string {
  return entity && isUat(entity.id, entity.label)
    ? 'border-uat/30 bg-uat/5 text-uat'
    : 'border-primary/25 bg-primary/5 text-primary';
}

/** Is this entity a production environment? */
export function isProduction(id: string, label: string): boolean {
  return /production|prod/i.test(`${id} ${label}`);
}

/** Group entities by region, preserving original order within each group. */
interface EntityGroup { region: string; entities: ConcurEntity[]; }

function groupByRegion(entities: ConcurEntity[]): EntityGroup[] {
  const map = new Map<string, ConcurEntity[]>();
  for (const entity of entities) {
    const region = regionFor(entity.id);
    const list = map.get(region);
    if (list) list.push(entity);
    else map.set(region, [entity]);
  }
  const seen = new Set<string>();
  const ordered: EntityGroup[] = [];
  for (const entity of entities) {
    const region = regionFor(entity.id);
    if (seen.has(region)) continue;
    seen.add(region);
    ordered.push({ region, entities: map.get(region)! });
  }
  return ordered;
}

export function EnvironmentPicker() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const entities = useSyncExternalStore(subscribeEntities, getEntities, getEntities);
  const activeEntityId = useSyncExternalStore(subscribeEntities, getActiveEntityId, getActiveEntityId);

  const activeEntity = entities.find((e) => e.id === activeEntityId);
  const groups = groupByRegion(entities);
  // Subscribe to the token store: the token usually arrives after the first
  // render, and without this the trigger would stay in its no-token style.
  const activeHasToken = useSyncExternalStore(subscribeToken, () => entityHasToken(activeEntityId));

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open]);

  const switchEntity = useCallback((id: string) => {
    setActiveEntity(id);
    selectAuthEntity();
    void initAuth();
    setOpen(false);
  }, []);

  // The trigger shows the entity's environment tone once it has a token.
  const hasTokenTone = activeHasToken
    ? entityTone(activeEntity)
    : 'border-border bg-card text-muted-foreground';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active entity: ${activeEntity?.label ?? ''}`}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hasTokenTone}`}
      >
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18" strokeLinecap="round" />
        </svg>
        <span className="max-w-28 truncate">
          {activeEntity ? (() => {
            const { region, rest } = splitRegion(activeEntity);
            return <>{region && <span className="font-bold">{region}</span>}{rest}</>;
          })() : 'Select entity'}
        </span>
        <svg className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select Concur entity"
          className="absolute right-0 top-full z-50 mt-1.5 min-w-44 origin-top-right rounded-lg border bg-popover p-1 shadow-md"
        >
          {groups.map((group) => (
            <div key={group.region}>
              <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
                {group.region}
              </div>
              {group.entities.map((entity) => {
                const active = entity.id === activeEntityId;
                const prod = isProduction(entity.id, entity.label);
                const uat = isUat(entity.id, entity.label);
                const hasToken = entityHasToken(entity.id);
                return (
                  <button
                    key={entity.id}
                    role="option"
                    aria-selected={active}
                    onClick={() => switchEntity(entity.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? (uat ? 'bg-uat/10 font-medium text-uat' : 'bg-primary/10 font-medium text-primary')
                        : hasToken
                          ? 'text-foreground hover:bg-accent'
                          : 'text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        hasToken
                          ? (prod ? 'bg-primary' : uat ? 'bg-uat' : 'bg-success')
                          : 'bg-muted-foreground/40'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{entity.label}</span>
                    {active && (
                      <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}