import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LinkSimpleIcon } from '@phosphor-icons/react/dist/csr/LinkSimple';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { fetchLinkedReportValue, type ReportFormField } from '../api/reportFormFieldsApi';

export interface ConfiguredFieldValue {
  field: ReportFormField;
  label: string;
  value: string;
  link?: string;
}

function displayAttribute(value: unknown): string {
  if (value === '') return '""';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

function LinkedValue({ row, entityId }: { row: ConfiguredFieldValue; entityId: string }) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!row.link) return;
    const controller = new AbortController();
    setResolved(null);
    setError(false);
    void fetchLinkedReportValue(row.link, entityId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setResolved(value); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [row.link, entityId, retry]);

  if (!row.link) return <>{row.value}</>;
  if (error) return <span className="flex flex-wrap items-center gap-2"><span>{row.value}</span><span className="text-muted-foreground">Value unavailable</span><button type="button" className="text-primary underline" onClick={() => setRetry(value => value + 1)}>Retry</button></span>;
  if (resolved === null) return <span role="status" className="text-muted-foreground">Retrieving value…</span>;
  return <span className="inline-flex items-start gap-1.5"><LinkSimpleIcon aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-primary" />{resolved}</span>;
}

function FieldProperties({ field, anchor, onClose }: { field: ReportFormField; anchor: HTMLElement; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    // Background scroll invalidates the anchor position; internal scroll must
    // remain usable when the field has more attributes than fit in the popup.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && dialogRef.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('scroll', onScroll, true); anchor.focus(); };
  }, [anchor, onClose]);

  const rect = anchor.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 32);
  const left = Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16));
  const top = Math.max(16, Math.min(rect.bottom + 6, window.innerHeight - window.innerHeight * 0.7 - 16));
  const label = field.fieldName?.trim() || field.fieldId || 'Field';
  return createPortal(<div className="fixed inset-0 z-popover">
    <button type="button" tabIndex={-1} aria-label="Close field properties" className="absolute inset-0 w-full cursor-default bg-transparent" onClick={onClose} />
    <div ref={dialogRef} role="dialog" aria-label={`${label} properties`} className="fixed max-h-[70vh] overflow-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl" style={{ left, top, width }}>
      <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3">
        <h3 className="min-w-0 break-words text-sm font-semibold">{label} properties</h3>
        <button ref={closeRef} type="button" aria-label="Close" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={onClose}><XIcon size={16} /></button>
      </div>
      <dl className="grid gap-2">{Object.entries(field).filter(([, value]) => value != null).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3 text-xs">
        <dt className="break-words text-muted-foreground">{key}</dt><dd className="whitespace-pre-wrap break-all">{displayAttribute(value)}</dd>
      </div>)}</dl>
    </div>
  </div>, document.body);
}

/** Shared compact presentation for report and expense form definitions. */
export function ConfiguredFormFields({ rows, entityId }: { rows: ConfiguredFieldValue[]; entityId: string }) {
  const [selected, setSelected] = useState<{ field: ReportFormField; anchor: HTMLElement } | null>(null);
  return <>
    <dl className="divide-y divide-border px-3">{rows.map((row, index) => <div key={row.field.formFieldId ?? `${row.field.fieldId ?? 'field'}-${index}`} className="grid min-w-0 items-start gap-2 py-2.5 text-xs" style={{ gridTemplateColumns: 'minmax(0, min(var(--detail-label-width, 180px), 40%)) minmax(0, 1fr) 28px' }}>
      <dt className="min-w-0 break-words font-medium">{row.label}{row.field.isRequired && <span aria-label="required" className="ml-1 text-destructive">*</span>}</dt>
      <dd className={`min-w-0 break-words rounded px-2 py-1 ${row.field.fieldAccess === 'HD' ? 'bg-muted text-muted-foreground' : 'text-foreground'}`}><LinkedValue row={row} entityId={entityId} /></dd>
      <button type="button" aria-label={`Properties for ${row.label}`} title={`Properties for ${row.label}`} onClick={event => setSelected({ field: row.field, anchor: event.currentTarget })} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"><SlidersHorizontalIcon aria-hidden="true" size={17} /></button>
    </div>)}</dl>
    <p className="border-t px-3 py-2 text-[11px] text-muted-foreground"><span className="font-semibold text-destructive">*</span> Required · Gray value = hidden on Concur form</p>
    {selected && <FieldProperties field={selected.field} anchor={selected.anchor} onClose={() => setSelected(null)} />}
  </>;
}
