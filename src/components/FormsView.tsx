import { KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { getFormsSnapshot, refreshForms } from '../api/formsApi';
import { timeAgo } from '../api/listsApi';
import { FormEntry, FormFieldEntry, FormTypeEntry, FormsProgress, FormsSnapshot } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import { ResizableDetailLayout } from './ui/Resizable';

const PAGE_SIZE = 50;
type FormSortId = 'name' | 'type' | 'fields' | 'status';
type SortState = { id: FormSortId; dir: 1 | -1 };
type FormRow = { form: FormEntry; type: FormTypeEntry };

/**
 * Forms & Fields workbench — keeps Concur retrieval explicit while presenting
 * the local snapshot with the same table-and-detail interaction used by the
 * other configuration browsers. Flattening form types into filterable rows
 * makes large snapshots scannable without rendering thousands of accordions.
 */
export function FormsView() {
  const [snapshot, setSnapshot] = useState<FormsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<FormsProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sort, setSort] = useState<SortState>({ id: 'name', dir: 1 });
  const [page, setPage] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFormsSnapshot()
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setLoadError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const doRefresh = () => {
    setRefreshing(true);
    setError(null);
    setProgress(null);
    void refreshForms({
      onProgress: setProgress,
      onDone: (summary) => {
        if (summary.error) setError(summary.error);
        getFormsSnapshot()
          .then(setSnapshot)
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
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

  const totals = useMemo(() => snapshot ? {
    forms: snapshot.formTypes.reduce((count, type) => count + type.forms.length, 0),
    fields: snapshot.formTypes.reduce((count, type) => count + type.forms.reduce((sum, form) => sum + form.fields.length, 0), 0),
  } : null, [snapshot]);

  const rows = useMemo<FormRow[]>(() => {
    if (!snapshot) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return snapshot.formTypes
      .filter((type) => typeFilter === 'all' || type.formCode === typeFilter)
      .flatMap((type) => type.forms.map((form) => ({ form, type })))
      .filter(({ form, type }) => formRowMatches(form, type, normalizedQuery))
      .sort((a, b) => compareFormRows(a, b, sort));
  }, [query, snapshot, sort, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selected = rows.find((row) => formRowKey(row) === selectedKey) ?? visibleRows[0] ?? null;

  useEffect(() => { setPage(1); }, [query, typeFilter]);
  useEffect(() => {
    if (selected && selectedKey !== formRowKey(selected)) setSelectedKey(formRowKey(selected));
    if (!selected && selectedKey !== null) setSelectedKey(null);
  }, [selected, selectedKey]);

  const toggleSort = (id: FormSortId) => {
    setSort((current) => current.id === id ? { id, dir: current.dir === 1 ? -1 : 1 } : { id, dir: 1 });
    setPage(1);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading forms snapshot…</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Filter by form type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="w-full sm:w-56">
          <option value="all">All form types</option>
          {(snapshot?.formTypes ?? []).map((type) => <option key={type.formCode} value={type.formCode}>{type.name}</option>)}
        </Select>
        <div className="min-w-64 flex-1">
          <Input aria-label="Search forms and fields" placeholder="Search form names, IDs, types, or fields…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Button variant="outline" size="sm" className="h-10 shrink-0" onClick={doRefresh} loading={refreshing}>
          {refreshing ? 'Retrieving…' : 'Retrieve All'}
        </Button>
      </div>

      {refreshing && <FormsProgressPanel progress={progress} />}
      {(error || loadError) && <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error ?? loadError}</div>}

      {!snapshot ? (
        <div className="rounded-md border border-dashed bg-card px-4 py-10 text-center">
          <p className="mb-3 text-sm text-muted-foreground">No forms data yet. Retrieve all once — the snapshot is stored locally until you retrieve it again.</p>
          <Button onClick={doRefresh} loading={refreshing} aria-label="Retrieve all forms and fields">Retrieve All</Button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge tone="success" dot>Snapshot ready</Badge>
            <span title={new Date(snapshot.retrievedAt).toLocaleString()}>
              Retrieved {timeAgo(snapshot.retrievedAt)} · {snapshot.formTypes.length.toLocaleString()} types · {totals!.forms.toLocaleString()} forms · {totals!.fields.toLocaleString()} fields
            </span>
          </div>
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed bg-card px-4 py-10 text-center">
              <h2 className="text-sm font-semibold text-foreground">No forms found</h2>
              <p className="mt-1 text-sm text-muted-foreground">Try a different search or form type.</p>
            </div>
          ) : (
            <ResizableDetailLayout
              label="Resize form results and field details"
              initialListPercent={52}
              list={<FormsTable rows={visibleRows} selectedKey={selectedKey} sort={sort} onSort={toggleSort} onSelect={setSelectedKey} total={rows.length} page={safePage} pageCount={pageCount} onPage={setPage} />}
              detail={<FormDetailsPanel row={selected} query={query.trim().toLowerCase()} />}
            />
          )}
        </>
      )}
    </div>
  );
}

function FormsProgressPanel({ progress }: { progress: FormsProgress | null }) {
  const total = progress?.formsTotal;
  const fetched = progress?.formsFetched ?? 0;
  const knownTotal = typeof total === 'number' && total > 0;
  const percent = knownTotal ? Math.min(99, Math.round((fetched / total) * 100)) : undefined;
  const detail = !progress ? 'Starting retrieval…' : progress.phase === 'types'
    ? `Discovered ${progress.types ?? 0} form types…`
    : `${fetched.toLocaleString()}/${total?.toLocaleString() ?? '?'} forms${progress.formName ? ` · ${progress.formName}` : ''}`;

  return (
    <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2" role="status" aria-live="polite">
      <div className="mb-1.5 flex items-baseline gap-3 text-xs">
        <span className="font-semibold text-foreground">Retrieving all forms and fields</span>
        <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
        <span className="ml-auto shrink-0 font-semibold tabular-nums text-primary">{percent === undefined ? 'In progress' : `${percent}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Forms and fields retrieval progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className={`h-full rounded-full bg-primary transition-[width] duration-300 ${percent === undefined ? 'animate-pulse' : ''}`} style={{ width: percent === undefined ? '34%' : `${percent}%` }} />
      </div>
    </div>
  );
}

function FormsTable({ rows, selectedKey, sort, onSort, onSelect, total, page, pageCount, onPage }: {
  rows: FormRow[];
  selectedKey: string | null;
  sort: SortState;
  onSort: (id: FormSortId) => void;
  onSelect: (key: string) => void;
  total: number;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  const selectFromKeyboard = (event: KeyboardEvent<HTMLTableRowElement>, key: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect(key);
  };

  return (
    <section aria-label="Form results" className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm xl:h-full xl:min-h-0">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
        <span>{total.toLocaleString()} form{total === 1 ? '' : 's'}</span>
        <span className="tabular-nums">Page {page} of {pageCount}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" data-testid="forms-results-scroll-region">
        <table className="w-full table-fixed text-sm" aria-label="Forms and fields">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="border-b bg-muted/50 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <SortableHeader id="name" label="Form name" sort={sort} onToggle={onSort} className="w-[44%]" />
              <SortableHeader id="type" label="Form type" sort={sort} onToggle={onSort} className="w-[27%]" />
              <SortableHeader id="fields" label="Fields" sort={sort} onToggle={onSort} className="w-[14%]" alignRight />
              <SortableHeader id="status" label="Status" sort={sort} onToggle={onSort} className="w-[15%]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = formRowKey(row);
              const selected = key === selectedKey;
              return (
                <tr key={key} tabIndex={0} aria-selected={selected} onClick={() => onSelect(key)} onKeyDown={(event) => selectFromKeyboard(event, key)} className={`cursor-pointer border-b last:border-0 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected ? 'bg-accent/60' : ''}`}>
                  <td className="px-3 py-2">
                    <div className="truncate text-xs font-medium text-foreground">{row.form.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{row.form.formId}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="truncate text-xs text-foreground">{row.type.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{row.type.formCode}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">{row.form.fields.length.toLocaleString()}</td>
                  <td className="px-3 py-2">{row.form.error ? <Badge tone="destructive">Error</Badge> : <Badge tone="success">Ready</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t bg-card px-3 py-2">
        <span className="text-xs text-muted-foreground">{((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, total).toLocaleString()} of {total.toLocaleString()}</span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
          <Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</Button>
        </div>
      </div>
    </section>
  );
}

function SortableHeader({ id, label, sort, onToggle, className = '', alignRight = false }: {
  id: FormSortId;
  label: string;
  sort: SortState;
  onToggle: (id: FormSortId) => void;
  className?: string;
  alignRight?: boolean;
}) {
  const active = sort.id === id;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={`p-0 ${className}`}>
      <button type="button" onClick={() => onToggle(id)} className={`w-full px-3 py-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${alignRight ? 'text-right' : 'text-left'}`}>
        {label}{active ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
}

function FormDetailsPanel({ row, query }: { row: FormRow | null; query: string }) {
  if (!row) return (
    <aside aria-label="Form details" className="flex min-w-0 items-center justify-center rounded-lg border bg-card p-6 text-center shadow-sm xl:h-full">
      <div><h2 className="text-sm font-semibold text-foreground">No form selected</h2><p className="mt-1 text-sm text-muted-foreground">Choose a form to inspect its configured fields.</p></div>
    </aside>
  );

  const selfMatch = !query || [row.form.name, row.form.formId, row.type.name, row.type.formCode].some((value) => value.toLowerCase().includes(query));
  const fields = selfMatch ? row.form.fields : row.form.fields.filter((field) => fieldMatches(field, query));

  return (
    <aside aria-label="Form details" className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm xl:h-full xl:min-h-0">
      <div className="border-b px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="break-words text-sm font-semibold text-foreground">{row.form.name}</h2><p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{row.form.formId}</p></div>
          {row.form.error ? <Badge tone="destructive">Error</Badge> : <Badge tone="success">Ready</Badge>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <DetailField label="Form type" value={row.type.name} />
          <DetailField label="Type code" value={row.type.formCode} mono />
          <DetailField label="Configured fields" value={row.form.fields.length.toLocaleString()} />
          <DetailField label="Custom fields" value={row.form.fields.filter((field) => field.custom).length.toLocaleString()} />
        </dl>
      </div>
      {row.form.error ? (
        <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{row.form.error}</div>
      ) : fields.length === 0 ? (
        <div className="flex min-h-48 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">{row.form.fields.length === 0 ? 'No fields recorded for this form.' : 'No fields in this form match the search.'}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3 pt-0"><FieldsTable form={row.form} fields={fields} /></div>
      )}
    </aside>
  );
}

function DetailField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className={`mt-0.5 truncate text-xs text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd></div>;
}

type FieldSortId = 'sequence' | 'label' | 'id' | 'controlType' | 'dataType';

function FieldsTable({ form, fields }: { form: FormEntry; fields: FormFieldEntry[] }) {
  const [sort, setSort] = useState<{ id: FieldSortId; dir: 1 | -1 }>({ id: 'sequence', dir: 1 });
  const toggleSort = (id: FieldSortId) => setSort((current) => current.id === id ? { id, dir: current.dir === 1 ? -1 : 1 } : { id, dir: 1 });
  const sorted = [...fields].sort((a, b) => compareFields(a, b, sort));

  return (
    <table className="mt-3 w-full table-fixed text-sm [&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap" aria-label={`Fields for ${form.name}`}>
      <colgroup>
        <col className="w-[9%]" />
        <col className="w-[24%]" />
        <col className="w-[25%]" />
        <col className="w-[17%]" />
        <col className="w-[17%]" />
        <col className="w-[8%]" />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-muted">
        <tr className="border-b text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <FieldHeader id="sequence" label="Seq" sort={sort} onToggle={toggleSort} alignRight />
          <FieldHeader id="label" label="Label" sort={sort} onToggle={toggleSort} />
          <FieldHeader id="id" label="ID" sort={sort} onToggle={toggleSort} />
          <FieldHeader id="controlType" label="Control" sort={sort} onToggle={toggleSort} />
          <FieldHeader id="dataType" label="Type" sort={sort} onToggle={toggleSort} />
          <th scope="col" className="px-2 py-2 text-center">Req</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((field, index) => (
          <tr key={`${field.id ?? 'field'}-${index}`} className="border-b last:border-0 hover:bg-accent/40">
            <td className="px-2 py-2 text-right text-[11px] tabular-nums text-muted-foreground">{field.sequence ?? '—'}</td>
            <td className="px-2 py-2 text-xs font-medium text-foreground" title={field.label}>{field.label ?? '—'}</td>
            <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground" title={field.id}>{field.id ?? '—'}</td>
            <td className="px-2 py-2 text-xs text-muted-foreground" title={field.controlType}>{field.controlType ?? '—'}</td>
            <td className="px-2 py-2 text-xs text-muted-foreground" title={field.dataType}>{field.dataType ?? '—'}</td>
            <td className="px-2 py-2 text-center text-xs">{field.required ? <span className="font-medium text-foreground">Yes</span> : <span className="text-muted-foreground">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FieldHeader({ id, label, sort, onToggle, alignRight = false }: { id: FieldSortId; label: string; sort: { id: FieldSortId; dir: 1 | -1 }; onToggle: (id: FieldSortId) => void; alignRight?: boolean }) {
  const active = sort.id === id;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className="p-0">
      <button type="button" onClick={() => onToggle(id)} className={`w-full px-2 py-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${alignRight ? 'text-right' : 'text-left'}`}>{label}{active ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button>
    </th>
  );
}

function formRowKey({ form, type }: FormRow): string { return `${type.formCode}:${form.formId}`; }
function fieldMatches(field: FormFieldEntry, query: string): boolean {
  return [field.label, field.id, field.controlType, field.dataType, field.access].some((value) => (value ?? '').toString().toLowerCase().includes(query));
}
function formRowMatches(form: FormEntry, type: FormTypeEntry, query: string): boolean {
  if (!query) return true;
  return [form.name, form.formId, type.name, type.formCode].some((value) => value.toLowerCase().includes(query)) || form.fields.some((field) => fieldMatches(field, query));
}
function compareFormRows(a: FormRow, b: FormRow, sort: SortState): number {
  let result: number;
  if (sort.id === 'type') result = a.type.name.localeCompare(b.type.name) || a.form.name.localeCompare(b.form.name);
  else if (sort.id === 'fields') result = a.form.fields.length - b.form.fields.length;
  else if (sort.id === 'status') result = Number(Boolean(a.form.error)) - Number(Boolean(b.form.error));
  else result = a.form.name.localeCompare(b.form.name);
  return result * sort.dir;
}
function compareFields(a: FormFieldEntry, b: FormFieldEntry, sort: { id: FieldSortId; dir: 1 | -1 }): number {
  let result: number;
  if (sort.id === 'label') result = (a.label ?? '').localeCompare(b.label ?? '');
  else if (sort.id === 'id') result = (a.id ?? '').localeCompare(b.id ?? '');
  else if (sort.id === 'controlType') result = (a.controlType ?? '').localeCompare(b.controlType ?? '');
  else if (sort.id === 'dataType') result = (a.dataType ?? '').localeCompare(b.dataType ?? '');
  else result = (a.sequence ?? 9999) - (b.sequence ?? 9999);
  return result * sort.dir;
}
