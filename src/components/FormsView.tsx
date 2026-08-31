import { useEffect, useState } from 'react';
import { getFormsSnapshot, refreshForms } from '../api/formsApi';
import { timeAgo } from '../api/listsApi';
import { FormEntry, FormFieldEntry, FormTypeEntry, FormsProgress, FormsSnapshot } from '../types';
import { SectionTone, sectionToneCycle, sectionTones } from './sectionTones';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

/**
 * Forms & Fields view — renders the local snapshot of the Expense Form v1.1
 * crawl as a form type → form → fields hierarchy of tinted collapsible
 * sections. Concur is only contacted via the explicit Retrieve All action (SSE
 * progress), never on page load.
 */
export function FormsView() {
  const [snapshot, setSnapshot] = useState<FormsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<FormsProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    getFormsSnapshot()
      .then((snap) => {
        if (cancelled) return;
        setSnapshot(snap);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const doRefresh = () => {
    setRefreshing(true);
    setError(null);
    setProgress(null);
    void refreshForms({
      onProgress: (p) => setProgress(p),
      onDone: (summary) => {
        if (summary.error) setError(summary.error);
        getFormsSnapshot()
          .then(setSnapshot)
          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => {
            setRefreshing(false);
            setProgress(null);
          });
      },
      onError: (message) => {
        setError(message);
        setRefreshing(false);
        setProgress(null);
      },
    });
  };

  const q = query.trim().toLowerCase();
  const visibleTypes = (snapshot?.formTypes ?? []).filter((t) => typeMatches(t, q));
  const totals = snapshot
    ? {
        forms: snapshot.formTypes.reduce((n, t) => n + t.forms.length, 0),
        fields: snapshot.formTypes.reduce((n, t) => n + t.forms.reduce((m, f) => m + f.fields.length, 0), 0),
      }
    : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search forms and fields"
          placeholder="Search types, forms, or fields…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64"
        />
        {snapshot && (
          <span className="text-xs text-muted-foreground">
            Fetched {timeAgo(snapshot.retrievedAt)} · {snapshot.formTypes.length} types · {totals!.forms} forms · {totals!.fields} fields
          </span>
        )}
        {snapshot && (
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={doRefresh} loading={refreshing}>
              {refreshing ? 'Retrieving…' : 'Retrieve All'}
            </Button>
          </div>
        )}
      </div>

      {refreshing && <FormsProgressPanel progress={progress} />}

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}
      {loadError && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {loadError}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading forms snapshot…</p>
      ) : !snapshot ? (
        <div className="rounded-md border border-dashed bg-card px-4 py-10 text-center">
          <p className="mb-3 text-sm text-muted-foreground">No forms data yet. Retrieve all once — the snapshot is stored locally until you retrieve it again.</p>
          <Button onClick={doRefresh} loading={refreshing} aria-label="Retrieve all forms and fields">Retrieve All</Button>
        </div>
      ) : visibleTypes.length === 0 ? (
        <p className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">No form types match the filter.</p>
      ) : (
        <div className="space-y-2">
          {visibleTypes.map((type) => (
            <FormTypeSection
              key={type.formCode}
              type={type}
              tone={sectionToneCycle[snapshot.formTypes.indexOf(type) % sectionToneCycle.length]}
              query={q}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FormsProgressPanel({ progress }: { progress: FormsProgress | null }) {
  const total = progress?.formsTotal;
  const fetched = progress?.formsFetched ?? 0;
  const knownTotal = typeof total === 'number' && total > 0;
  const percent = knownTotal ? Math.min(99, Math.round((fetched / total) * 100)) : undefined;
  const detail = !progress
    ? 'Starting retrieval…'
    : progress.phase === 'types'
      ? `Discovered ${progress.types ?? 0} form types…`
      : `${fetched.toLocaleString()}/${total?.toLocaleString() ?? '?'} forms${progress.formName ? ` · ${progress.formName}` : ''}`;

  return (
    <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2" role="status" aria-live="polite">
      <div className="mb-1.5 flex items-baseline gap-3 text-xs">
        <span className="font-semibold text-foreground">Retrieving all forms and fields</span>
        <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
        <span className="ml-auto shrink-0 font-semibold tabular-nums text-primary">{percent === undefined ? 'In progress' : `${percent}%`}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Forms and fields retrieval progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={`h-full rounded-full bg-primary transition-[width] duration-300 ${percent === undefined ? 'animate-pulse' : ''}`}
          style={{ width: percent === undefined ? '34%' : `${percent}%` }}
        />
      </div>
    </div>
  );
}

/* ── Matching helpers ───────────────────────────────────────────────── */

function fieldMatches(field: FormFieldEntry, q: string): boolean {
  if (!q) return true;
  return [field.label, field.id].some((v) => (v ?? '').toLowerCase().includes(q));
}

function formMatches(form: FormEntry, q: string): boolean {
  if (!q) return true;
  return form.name.toLowerCase().includes(q) || form.fields.some((f) => fieldMatches(f, q));
}

function typeMatches(type: FormTypeEntry, q: string): boolean {
  if (!q) return true;
  return (
    type.name.toLowerCase().includes(q) ||
    type.formCode.toLowerCase().includes(q) ||
    type.forms.some((f) => formMatches(f, q))
  );
}

/* ── Sections ───────────────────────────────────────────────────────── */

/** Render cap per type when not searching — entities can hold thousands of forms. */
const FORM_DISPLAY_CAP = 100;

function FormTypeSection({ type, tone, query }: { type: FormTypeEntry; tone: SectionTone; query: string }) {
  const toneCls = sectionTones[tone];
  const [open, setOpen] = useState(false);
  const contentId = `form-type-${type.formCode}`;

  const selfMatch = !query || type.name.toLowerCase().includes(query) || type.formCode.toLowerCase().includes(query);
  const formsToShow = !query || selfMatch ? type.forms : type.forms.filter((f) => formMatches(f, query));
  const capped = !query && formsToShow.length > FORM_DISPLAY_CAP;
  const shownForms = capped ? formsToShow.slice(0, FORM_DISPLAY_CAP) : formsToShow;
  const descendantMatch = query !== '' && !selfMatch && formsToShow.length > 0;
  const expanded = open || descendantMatch;
  const fieldCount = type.forms.reduce((n, f) => n + f.fields.length, 0);

  return (
    <section className={`overflow-hidden rounded-md border ${toneCls.section}`}>
      <button
        type="button"
        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${toneCls.header}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={`text-xs font-semibold uppercase tracking-wide ${toneCls.title}`}>
          {type.name} <span className="font-normal normal-case opacity-80">({type.formCode})</span>
          {descendantMatch && (
            <span className="ml-1.5 font-normal normal-case opacity-80">· Matched in form: {formsToShow[0].name}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={`text-[11px] tabular-nums ${toneCls.title} opacity-80`}>
            {type.forms.length} forms · {fieldCount} fields
          </span>
          <svg
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''} ${toneCls.title}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {expanded && (
        <div id={contentId} className={`space-y-2 border-t px-3 py-2 ${toneCls.body}`}>
          {type.error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
              {type.error}
            </p>
          )}
          {formsToShow.length === 0 && !type.error && (
            <p className="px-1 py-2 text-xs text-muted-foreground">No forms match the filter.</p>
          )}
          {shownForms.map((form) => (
            <FormSubsection key={form.formId} form={form} tone={tone} query={selfMatch ? '' : query} />
          ))}
          {capped && (
            <p className="px-1 py-1 text-xs text-muted-foreground">
              …and {formsToShow.length - FORM_DISPLAY_CAP} more forms — use search to filter.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function FormSubsection({ form, tone, query }: { form: FormEntry; tone: SectionTone; query: string }) {
  const toneCls = sectionTones[tone];
  const [open, setOpen] = useState(false);
  const contentId = `form-${form.formId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const selfMatch = !query || form.name.toLowerCase().includes(query);
  const fieldsToShow = !query || selfMatch ? form.fields : form.fields.filter((f) => fieldMatches(f, query));
  const descendantMatch = query !== '' && !selfMatch && fieldsToShow.length > 0;
  const expanded = open || descendantMatch;

  return (
    <div className={`overflow-hidden rounded-md border bg-card ${toneCls.section}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-xs font-medium text-foreground">{form.name}</span>
          <span className="shrink-0 break-all font-mono text-[11px] text-muted-foreground">{form.formId}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {form.error && <span className="text-[11px] font-semibold text-destructive">Error</span>}
          <span className="text-[11px] tabular-nums text-muted-foreground">{form.fields.length} fields</span>
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {expanded && (
        <div id={contentId} className={`border-t p-2.5 ${toneCls.body}`}>
          {form.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
              {form.error}
            </p>
          ) : fieldsToShow.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted-foreground">No fields recorded.</p>
          ) : (
            <FieldsTable form={form} fields={fieldsToShow} tone={tone} />
          )}
        </div>
      )}
    </div>
  );
}

type FieldSortId = 'sequence' | 'label' | 'id' | 'controlType' | 'dataType';

function FieldsTable({ form, fields, tone }: { form: FormEntry; fields: FormFieldEntry[]; tone: SectionTone }) {
  const toneCls = sectionTones[tone];
  const [sort, setSort] = useState<{ id: FieldSortId; dir: 1 | -1 }>({ id: 'sequence', dir: 1 });

  const toggleSort = (id: FieldSortId) =>
    setSort((s) => (s.id === id ? { id, dir: s.dir === 1 ? -1 : 1 } : { id, dir: 1 }));
  const sortArrow = (id: FieldSortId) => (sort.id === id ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');

  const sorted = [...fields].sort((a, b) => {
    let r: number;
    if (sort.id === 'label') r = (a.label ?? '').localeCompare(b.label ?? '');
    else if (sort.id === 'id') r = (a.id ?? '').localeCompare(b.id ?? '');
    else if (sort.id === 'controlType') r = (a.controlType ?? '').localeCompare(b.controlType ?? '');
    else if (sort.id === 'dataType') r = (a.dataType ?? '').localeCompare(b.dataType ?? '');
    else r = (a.sequence ?? 9999) - (b.sequence ?? 9999);
    return r * sort.dir;
  });

  const sortableTh = (id: FieldSortId, label: string, alignRight = false) => (
    <th key={id} scope="col" aria-sort={sort.id === id ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className="p-0">
      <button
        type="button"
        onClick={() => toggleSort(id)}
        className={`w-full px-2 py-1.5 ${alignRight ? 'text-right' : 'text-left'} hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        {label}{sortArrow(id)}
      </button>
    </th>
  );

  return (
    <div className={`overflow-hidden rounded-md border ${toneCls.section}`}>
      <table className="w-full text-sm" aria-label={`Fields for ${form.name}`}>
        <thead>
          <tr className={`border-b text-left text-[11px] font-medium uppercase tracking-wide ${toneCls.header} ${toneCls.title} ${toneCls.body}`}>
            {sortableTh('sequence', 'Seq', true)}
            {sortableTh('label', 'Label')}
            {sortableTh('id', 'ID')}
            {sortableTh('controlType', 'Control')}
            {sortableTh('dataType', 'Type')}
            <th scope="col" className="px-2 py-1.5 text-right">Max</th>
            <th scope="col" className="px-2 py-1.5">Req</th>
            <th scope="col" className="px-2 py-1.5">Access</th>
            <th scope="col" className="px-2 py-1.5">Custom</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((f, i) => (
            <tr key={`${f.id ?? 'field'}-${i}`} className="border-b last:border-0 hover:bg-accent/40">
              <td className="px-2 py-1 text-right tabular-nums text-[11px] text-muted-foreground">{f.sequence ?? '—'}</td>
              <td className="px-2 py-1 text-xs font-medium text-foreground">{f.label ?? '—'}</td>
              <td className="px-2 py-1 font-mono text-[11px] text-muted-foreground">{f.id ?? '—'}</td>
              <td className="px-2 py-1 text-xs text-muted-foreground">{f.controlType ?? '—'}</td>
              <td className="px-2 py-1 text-xs text-muted-foreground">{f.dataType ?? '—'}</td>
              <td className="px-2 py-1 text-right tabular-nums text-xs text-muted-foreground">{f.maxLength ?? '—'}</td>
              <td className="px-2 py-1 text-xs">{f.required ? <span className="font-medium text-foreground">Yes</span> : <span className="text-muted-foreground">—</span>}</td>
              <td className="px-2 py-1 font-mono text-[11px] text-muted-foreground">{f.access ?? '—'}</td>
              <td className="px-2 py-1 text-xs text-muted-foreground">{f.custom ? 'Yes' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
