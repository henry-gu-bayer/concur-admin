import { useEffect, useMemo, useState } from 'react';
import { getListResource } from '../api/listResourceApi';
import { Button } from './ui/Button';

export function recordData(value: object | null | undefined): Record<string, unknown> | null {
  return value ? value as Record<string, unknown> : null;
}

export function resourceUri(record: Record<string, unknown> | null): string | undefined {
  return typeof record?.URI === 'string' && record.URI.trim() ? record.URI.trim() : undefined;
}

export function useListResource(record: Record<string, unknown> | null, entityId: string, generation = 0) {
  const uri = resourceUri(record);
  const key = `${entityId}:${generation}:${uri ?? ''}`;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; data?: Record<string, unknown>; error?: string; loading: boolean }>({ key: '', loading: false });
  useEffect(() => {
    if (!uri) return;
    const controller = new AbortController();
    setState({ key, loading: true });
    void getListResource(uri, entityId, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, data, loading: false });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : String(error), loading: false });
    });
    return () => controller.abort();
  }, [uri, entityId, key, retry]);
  const current = uri && state.key === key ? state : null;
  const data = useMemo(() => record ? { ...record, ...(current?.data ?? {}) } : null, [record, current?.data]);
  return { data, loading: Boolean(uri && (!current || current.loading)), error: current?.error, retry: () => setRetry(value => value + 1) };
}

export function ResourceFeedback({ loading, error, retry }: { loading: boolean; error?: string; retry: () => void }) {
  return <>
    {loading ? <p role="status" className="py-2 text-xs text-muted-foreground">Retrieving complete v3 details…</p> : null}
    {error ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 p-2 text-xs text-destructive">Complete details unavailable. Cached fields are shown. {error}<Button type="button" size="sm" variant="outline" onClick={retry}>Retry details</Button></div> : null}
  </>;
}

export interface RecordField { key: string; label: string; value: string }
const technicalKeys = new Set(['uri', 'href', 'links']);

function fieldLabel(key: string): string {
  const known: Record<string, string> = { id: 'ID', listid: 'List ID', parentid: 'Parent ID', connectorid: 'Connector ID', uri: 'URI' };
  return known[key.toLowerCase()] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, character => character.toUpperCase());
}

/** Flatten every actual field, including unknown future properties, false,
 * zero and null. Endpoint links belong only in the technical disclosure. */
export function listRecordFields(record: Record<string, unknown> | null): RecordField[] {
  const fields: RecordField[] = [];
  const walk = (value: unknown, path: string[], labels: string[]) => {
    if (value === undefined) return;
    if (value && typeof value === 'object' && Object.keys(value).length) {
      Object.entries(value).forEach(([key, nested]) => {
        if (!technicalKeys.has(key.toLowerCase())) walk(nested, [...path, key], [...labels, fieldLabel(key)]);
      });
      return;
    }
    fields.push({ key: path.join('.').toLowerCase(), label: labels.join(' · '), value: value == null || value === '' ? '—' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'object' ? JSON.stringify(value) : String(value) });
  };
  if (record) Object.entries(record).forEach(([key, value]) => { if (!technicalKeys.has(key.toLowerCase())) walk(value, [key], [fieldLabel(key)]); });
  return fields;
}

export function ListMetadataComparison({ v4, v3 }: { v4: Record<string, unknown> | null; v3: Record<string, unknown> | null }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const current = listRecordFields(v4);
    const legacy = listRecordFields(v3);
    const map = new Map<string, { label: string; v4?: string; v3?: string }>();
    current.forEach(field => map.set(field.key, { label: field.label, v4: field.value }));
    legacy.forEach(field => map.set(field.key, { ...map.get(field.key), label: map.get(field.key)?.label ?? field.label, v3: field.value }));
    const priority = ['id', 'category.type', 'category.id', 'levelcount', 'displayformat'];
    return Array.from(map, ([key, value]) => ({ key, ...value, label: key === 'id' ? 'List ID' : key === 'category.type' ? 'Category' : key === 'category.id' ? 'Category ID' : key === 'levelcount' ? 'Levels' : value.label }))
      .sort((a, b) => (priority.includes(a.key) ? priority.indexOf(a.key) : 100) - (priority.includes(b.key) ? priority.indexOf(b.key) : 100));
  }, [v4, v3]);
  return <>
    <div className="overflow-x-auto rounded-md border"><table aria-label="List metadata" className="w-full table-fixed text-left text-xs">
      <colgroup><col className="w-1/5" /><col /><col /></colgroup>
      <thead className="bg-muted/50"><tr>{['Field', 'v4 data', 'v3 data'].map(label => <th key={label} className="px-3 py-2 font-semibold">{label}</th>)}</tr></thead>
      <tbody>{(all ? rows : rows.slice(0, 5)).map(row => <tr key={row.key} className="border-t align-top"><th scope="row" className="break-words px-3 py-2 font-normal text-muted-foreground">{row.label}</th><td className={`break-all px-3 py-2 ${row.key.endsWith('id') ? 'font-mono' : ''}`}>{row.v4 ?? 'Not available'}</td><td className={`break-all px-3 py-2 ${row.key.endsWith('id') ? 'font-mono' : ''}`}>{row.v3 ?? 'Not available'}</td></tr>)}</tbody>
    </table></div>
    {rows.length > 5 ? <button type="button" className="mt-2 text-xs text-primary hover:underline" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? 'Show fewer list fields' : `Show all list fields (${rows.length})`}</button> : null}
  </>;
}

export function RecordFieldTable({ record, label }: { record: Record<string, unknown> | null; label: string }) {
  const fields = useMemo(() => listRecordFields(record), [record]);
  return <dl aria-label={label} className="divide-y overflow-hidden rounded-md border text-xs">{fields.map(field => <div key={field.key} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 px-3 py-2"><dt className="break-words text-muted-foreground">{field.label}</dt><dd className={`break-all ${field.key.endsWith('id') ? 'font-mono' : ''}`}>{field.value}</dd></div>)}</dl>;
}

export function TechnicalRecord({ record }: { record: Record<string, unknown> | null }) {
  return <details className="mt-3 rounded-md border bg-muted/20 p-3 text-xs"><summary className="cursor-pointer text-muted-foreground">Technical information</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono">{JSON.stringify(record, null, 2)}</pre></details>;
}
