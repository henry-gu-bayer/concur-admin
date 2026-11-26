import { useSyncExternalStore } from 'react';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { getActiveEntityId, getEntities, subscribeEntities } from '../entities/entityStore';
import { groupedCategories } from '../registry/categories';
import { entityTone, isProduction, isUat } from './EnvironmentPicker';
import { Badge } from './ui/Badge';

function useActiveEntity() {
  const entities = useSyncExternalStore(subscribeEntities, getEntities, getEntities);
  const activeEntityId = useSyncExternalStore(subscribeEntities, getActiveEntityId, getActiveEntityId);
  return entities.find(({ id }) => id === activeEntityId);
}

/**
 * The tenant is Home's headline. Admins switch between UAT and Production many
 * times a day, and reading the wrong tenant is the costly mistake, so the
 * active entity is stated in large type before any feature can be opened.
 * UAT uses the same magenta as the app frame and the entity picker; production
 * uses the blue accent, which contrasts strongly with it.
 */
function TenantStatement() {
  const entity = useActiveEntity();
  const production = entity ? isProduction(entity.id, entity.label) : false;
  const uat = entity ? isUat(entity.id, entity.label) : false;
  const rule = !entity ? 'border-border' : uat ? 'border-uat' : 'border-primary';

  return (
    <div className={`border-l-4 pl-4 transition-colors duration-fast motion-reduce:transition-none sm:pl-5 ${rule}`}>
      {entity ? (
        <>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <h1>
              <span className="block text-sm font-normal text-muted-foreground">Reading from</span>{' '}
              <span className="block text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{entity.label}</span>
            </h1>
            {production && <span className="mb-1.5"><Badge tone="primary">Production</Badge></span>}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{entity.id}</p>
          <p className="mt-3 max-w-prose text-sm text-foreground/75">
            Every feature below reads this tenant. Switch tenants from the entity menu at the top right.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">No Concur entity selected</h1>
          <p className="mt-3 max-w-prose text-sm text-foreground/75">
            If the entity menu stays empty, add entity IDs to <code className="font-mono text-xs">CONCUR_ENTITIES</code> in <code className="font-mono text-xs">.env</code> and restart the dev server.
          </p>
        </>
      )}
    </div>
  );
}

export function HomeView({ onOpenCategory }: { onOpenCategory: (id: string) => void }) {
  const groups = groupedCategories();
  // Feature icons wear the same environment tone as the entity picker and the
  // active sidebar item, so the whole page reads as one environment.
  const entity = useActiveEntity();
  const iconTone = entityTone(entity);
  const arrowHover = entity && isUat(entity.id, entity.label)
    ? 'group-hover:text-uat group-focus-visible:text-uat'
    : 'group-hover:text-primary group-focus-visible:text-primary';

  // Sections and features carry different roles, so they look different:
  // a section is a quiet, non-interactive label sitting on a rule that runs to
  // the column edge; a feature is a large, bold, tiled row that reacts to hover
  // and focus. Nothing about a section heading suggests it can be clicked.
  const renderGroup = ({ group, items }: (typeof groups)[number]) => {
    const headingId = `home-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return (
      <section key={group} aria-labelledby={headingId}>
        <div className="mb-2 flex items-center gap-3">
          <h2 id={headingId} className="shrink-0 text-sm font-medium text-muted-foreground">{group}</h2>
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
        </div>
        <ul className="space-y-1">
          {items.map(({ id, label, summary, icon }) => (
            <li key={id}>
              <button
                type="button"
                aria-labelledby={`home-${id}-label`}
                aria-describedby={`home-${id}-summary`}
                onClick={() => onOpenCategory(id)}
                className="group grid min-h-16 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-accent/70 motion-reduce:transition-none sm:px-3"
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-md border ${iconTone}`}>{icon}</span>
                <span className="min-w-0">
                  <span id={`home-${id}-label`} className="block break-words text-base font-semibold leading-snug">{label}</span>
                  <span id={`home-${id}-summary`} className="mt-0.5 block break-words text-sm text-muted-foreground">{summary}</span>
                </span>
                <ArrowRightIcon size={16} aria-hidden="true" className={`text-muted-foreground/60 transition-colors duration-fast motion-reduce:transition-none ${arrowHover}`} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 xl:pl-12 xl:pr-10">
      <TenantStatement />
      <div className="mt-10 grid gap-8 lg:grid-cols-[1.17fr_1fr] lg:gap-x-8 xl:gap-x-16">
        <div className="min-w-0 space-y-8">{groups.filter(({ group }) => group === 'Foundation data').map(renderGroup)}</div>
        <div className="min-w-0 space-y-8">{groups.filter(({ group }) => group !== 'Foundation data').map(renderGroup)}</div>
      </div>
    </div>
  );
}
