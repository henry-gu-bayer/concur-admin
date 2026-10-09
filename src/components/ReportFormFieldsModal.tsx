import { Fragment, useEffect, useMemo, useState } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { fetchReportFormFields, ReportFormField } from '../api/reportFormFieldsApi';
import type { ExpenseReport } from '../types';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { ErrorPanel } from './ui/AsyncState';

const SUMMARY_KEYS = new Set(['fieldSequence', 'fieldName', 'fieldId', 'controlType', 'dataType', 'fieldAccess', 'isRequired', 'maximumLength']);

function display(value: unknown): string {
  if (value == null) return '';
  if (value === '') return '""';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

/** Mount for one report/entity at a time. Closing aborts the request; results
 * stay in this dialog only, so an old report cannot populate a new selection. */
export function ReportFormFieldsModal({ report, entityId, onClose }: { report: ExpenseReport; entityId: string; onClose: () => void }) {
  const [fields, setFields] = useState<ReportFormField[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    setFields(null);
    setError(null);
    setExpanded(new Set());
    void fetchReportFormFields(report.ID, entityId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const sorted = [...result].sort((a, b) => (typeof a.fieldSequence === 'number' ? a.fieldSequence : Infinity) - (typeof b.fieldSequence === 'number' ? b.fieldSequence : Infinity));
      setFields(sorted);
      setExpanded(new Set(sorted.length ? [0] : []));
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not retrieve header form fields.');
    });
    return () => controller.abort();
  }, [report.ID, entityId, retry]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (fields ?? []).map((field, index) => ({ field, index })).filter(({ field }) => !query || Object.entries(field)
      .some(([key, value]) => value != null && `${key} ${display(value)}`.toLowerCase().includes(query)));
  }, [fields, search]);

  return (
    <Modal open onClose={onClose} title="Header form fields" description={`${report.Name ?? 'Unnamed report'} · ${report.ID}`}
      width="max-w-6xl" className="flex max-h-[calc(100dvh-2rem)] flex-col" bodyClassName="flex min-h-0 flex-col gap-4"
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{fields ? `${visible.length} of ${fields.length} fields` : error ? 'Retrieval failed' : 'Retrieving fields…'}</span><span>Null attributes omitted · False and 0 retained</span></div>}>
      <Input aria-label="Find form field or attribute" placeholder="Find field or attribute" value={search} onChange={event => setSearch(event.target.value)} className="max-w-md shrink-0" disabled={!fields} />
      {error ? <div className="overflow-auto"><ErrorPanel title="Could not retrieve header form fields" message={error} onRetry={() => setRetry(value => value + 1)} /></div>
        : !fields ? <p role="status" className="py-16 text-center text-sm text-muted-foreground">Retrieving header form fields…</p>
        : <div className="min-h-0 overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[760px] table-fixed text-left text-sm">
            <caption className="sr-only">Report header form fields</caption>
            <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground"><tr>
              <th className="w-10 p-3"><span className="sr-only">Details</span></th>
              <th className="w-14 py-3">Seq</th><th className="w-[26%] p-3">Field</th>
              {['Control', 'Type', 'Access', 'Required', 'Max length'].map(label => <th key={label} className="p-3">{label}</th>)}
            </tr></thead>
            <tbody>{visible.map(({ field, index }) => {
              const name = String(field.fieldName ?? field.fieldId ?? `Field ${index + 1}`);
              const extra = Object.entries(field).filter(([key, value]) => !SUMMARY_KEYS.has(key) && value != null);
              const isExpanded = expanded.has(index);
              const detailId = `report-form-field-${index}`;
              return <Fragment key={index}>
                <tr className={`border-t border-border align-top ${isExpanded ? 'bg-primary/5' : 'hover:bg-muted/30'}`}>
                  <td className="p-2">{extra.length > 0 && <button type="button" aria-label={`Attributes for ${name}`} aria-expanded={isExpanded} aria-controls={isExpanded ? detailId : undefined}
                    onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })}
                    className="rounded p-1.5 text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><CaretRightIcon size={16} className={isExpanded ? 'rotate-90' : ''} /></button>}</td>
                  <td className="py-3 text-xs tabular-nums">{display(field.fieldSequence)}</td>
                  <td className="break-words p-3"><span className="font-medium">{name}</span>{field.fieldId != null && <span className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">{display(field.fieldId)}</span>}</td>
                  {['controlType', 'dataType', 'fieldAccess', 'isRequired', 'maximumLength'].map(key => <td key={key} className="break-words p-3 text-xs">{display(field[key])}</td>)}
                </tr>
                {isExpanded && extra.length > 0 && <tr id={detailId} className="border-t border-border"><td colSpan={8} className="px-5 py-4 sm:px-10">
                  <dl className="grid gap-x-8 gap-y-2 md:grid-cols-2">{extra.map(([key, value]) => <div key={key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start gap-3 text-xs">
                    <dt className="break-words text-muted-foreground">{key}</dt><dd className={`whitespace-pre-wrap break-all ${typeof value === 'object' || /id$/i.test(key) ? 'font-mono' : ''}`}>{display(value)}</dd>
                  </div>)}</dl>
                </td></tr>}
              </Fragment>;
            })}</tbody>
          </table>
          {!visible.length && <p role="status" className="px-5 py-16 text-center text-sm text-muted-foreground">{fields.length ? 'No fields match your search.' : 'Concur returned no header form fields for this report.'}</p>}
        </div>}
    </Modal>
  );
}
