import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { groupedCategories } from '../registry/categories';

export function HomeView({ onOpenCategory }: { onOpenCategory: (id: string) => void }) {
  const groups = groupedCategories();

  const renderGroup = ({ group, items }: (typeof groups)[number]) => (
    <section key={group}>
      <h2 className="mb-2 text-base font-semibold">{group}</h2>
      <ul className="border-t">
        {items.map(({ id, label, summary, icon }) => (
          <li key={id} className="border-b">
            <button
              type="button"
              aria-labelledby={`home-${id}-label`}
              aria-describedby={`home-${id}-summary`}
              onClick={() => onOpenCategory(id)}
              className="group grid min-h-16 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2 text-left transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-inset motion-reduce:transition-none sm:px-4"
            >
              <span className="h-5 w-5 text-muted-foreground">{icon}</span>
              <span className="min-w-0">
                <span id={`home-${id}-label`} className="block break-words text-sm font-semibold">{label}</span>
                <span id={`home-${id}-summary`} className="block break-words text-sm text-foreground/75">{summary}</span>
              </span>
              <ArrowRightIcon size={16} aria-hidden="true" className="text-muted-foreground/70 transition-colors duration-150 group-hover:text-primary group-focus-visible:text-primary motion-reduce:transition-none" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="px-4 py-7 sm:px-8 sm:py-10 lg:pt-11 xl:pl-12 xl:pr-10">
      <h1 className="text-lg font-semibold leading-tight">Concur Admin</h1>
      <p className="mt-2 text-sm text-foreground/75">Choose a feature to browse, search, or validate Concur data.</p>
      <p className="mt-2 text-xs text-muted-foreground">You can return Home while jobs continue.</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.17fr_1fr] lg:gap-x-8 xl:gap-x-16">
        <div className="min-w-0 space-y-5">{groups.filter(({ group }) => group === 'Foundation data').map(renderGroup)}</div>
        <div className="min-w-0 space-y-5">{groups.filter(({ group }) => group !== 'Foundation data').map(renderGroup)}</div>
      </div>
    </div>
  );
}
