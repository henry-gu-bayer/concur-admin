import { SCAFFOLD_HINTS } from '../data/mock';
import { CategoryDescriptor } from '../types';

/**
 * Guided state for a registered-but-not-yet-implemented category. Shows the
 * category's intended shape (columns are already defined in its descriptor)
 * plus exactly what wiring is needed, so implementing it is a known next step
 * rather than a blank page or a fake table.
 */
export function CategoryScaffold({ category }: { category: CategoryDescriptor }) {
  const hint = SCAFFOLD_HINTS[category.id];

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <span className="h-7 w-7">{category.icon}</span>
      </div>
      <h2 className="text-lg font-semibold">{category.label}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{category.description}</p>

      <div className="mt-6 w-full max-w-md rounded-lg border bg-muted/40 p-4 text-left">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          To implement this category
        </h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-muted-foreground">
          <li>
            Add a retrieval method to <code className="rounded bg-muted px-1 font-mono text-xs">concurClient</code>
            {hint && <> — <code className="rounded bg-muted px-1 font-mono text-xs">{hint.apiHint}</code></>}
          </li>
          <li>Map the response into <code className="rounded bg-muted px-1 font-mono text-xs">ConfigItem[]</code>
            {hint && <span className="block text-xs">({hint.fieldsHint})</span>}
          </li>
          <li>Set <code className="rounded bg-muted px-1 font-mono text-xs">implemented: true</code> on the descriptor</li>
        </ol>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        The table columns are already defined — the table, search, filter, and detail
        panel will render automatically once data is wired.
      </p>
    </div>
  );
}
