import { ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ApiLogEntry, ApiLogFile, getLogEntries, getLogFiles } from '../api/apiLogsApi';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';

function formatXml(xml: string): string {
  return xml
    .replace(/>\s*</g, '><')
    .replace(/(>)(<)(\/?)/g, '$1\n$2$3')
    .split('\n')
    .reduce<{ lines: string[]; depth: number }>((state, line) => {
      if (/^<\//.test(line)) state.depth = Math.max(0, state.depth - 1);
      state.lines.push(`${'  '.repeat(state.depth)}${line}`);
      if (/^<[^!?/][^>]*[^/]?>$/.test(line) && !/<\/.+>$/.test(line)) state.depth += 1;
      return state;
    }, { lines: [], depth: 0 }).lines.join('\n');
}

export function formatResponsePayload(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null) return JSON.stringify(payload, null, 2);
  const text = String(payload ?? '');
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text.trimStart().startsWith('<') ? formatXml(text) : text;
  }
}

function paramsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of params.entries()) {
    const current = out[key];
    if (current === undefined) out[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else out[key] = [current, value];
  }
  return out;
}

export function formatRequestParams(url?: string): string {
  try {
    const params = new URL(url ?? '').searchParams;
    if ([...params.keys()].length === 0) return 'No request parameters.';
    return JSON.stringify(paramsToObject(params), null, 2);
  } catch {
    return 'No request parameters.';
  }
}

export function formatRequestPayload(payload: unknown): string {
  if (payload === undefined || payload === null || payload === '') return 'No request payload.';
  if (typeof payload === 'object') return JSON.stringify(payload, null, 2);
  const text = String(payload);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    if (text.includes('=')) {
      try {
        return JSON.stringify(paramsToObject(new URLSearchParams(text)), null, 2);
      } catch {
        /* fall through */
      }
    }
    return formatResponsePayload(text);
  }
}

function endpoint(url?: string): string {
  try {
    return new URL(url ?? '').pathname;
  } catch {
    return url ?? '—';
  }
}

export function formatLogDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function ApiLogsView() {
  const [files, setFiles] = useState<ApiLogFile[]>([]);
  const [file, setFile] = useState('');
  const [entries, setEntries] = useState<ApiLogEntry[]>([]);
  const [selected, setSelected] = useState<ApiLogEntry | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paneWidth, setPaneWidth] = useState(47);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const load = async (requestedFile?: string) => {
    setLoading(true);
    setError(null);
    try {
      const available = await getLogFiles();
      setFiles(available);
      const nextFile = requestedFile ?? (file || available[0]?.name || '');
      setFile(nextFile);
      const nextEntries = nextFile ? await getLogEntries(nextFile) : [];
      setEntries(nextEntries);
      setSelected(nextEntries[0] ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) =>
      (!needle || [entry.url, entry.method, entry.responseStatus, entry.correlationId].some((value) => String(value ?? '').toLowerCase().includes(needle))) &&
      (status === 'all' || String(entry.responseStatus) === status)
    );
  }, [entries, query, status]);

  const statusValues = [...new Set(entries.map((entry) => entry.responseStatus).filter((value): value is number => value !== undefined))].sort();
  const copyPayload = () => selected && void navigator.clipboard?.writeText(formatResponsePayload(selected.responseBody));
  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const resize = (move: PointerEvent) => {
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPaneWidth(Math.round(Math.min(70, Math.max(30, ((move.clientX - rect.left) / rect.width) * 100))));
    };
    const stopResize = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResize);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);
  };

  return (
    <div>
      <div className="mb-2 flex min-w-0 items-center gap-1.5 overflow-x-auto">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter API logs" placeholder="Filter URL, method, status, or correlation ID" className="h-8 min-w-[220px] flex-1 text-xs" />
        <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status" className="h-8 w-20 text-xs">
          <option value="all">All status</option>
          {statusValues.map((value) => <option key={value} value={String(value)}>{value}</option>)}
        </Select>
        <Select value={file} onChange={(event) => void load(event.target.value)} aria-label="Select log file" className="h-8 w-20 text-xs">
          {files.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </Select>
        <Button type="button" variant="outline" size="sm" loading={loading} onClick={() => void load()}>Refresh</Button>
      </div>

      {error && <p role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div
        ref={workspaceRef}
        className="relative grid h-[calc(100vh-12.5rem)] min-h-[390px] overflow-hidden rounded-lg border bg-card shadow-sm lg:grid-cols-[var(--log-pane-width)_minmax(0,1fr)]"
        style={{ '--log-pane-width': `${paneWidth}%` } as CSSProperties}
      >
        <div aria-label="API log entries list" className="min-h-0 overflow-auto border-b lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-[76px_42px_minmax(130px,1fr)_36px_48px] gap-1.5 border-b bg-muted/50 px-2 py-1.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Time</span><span>Verb</span><span>Endpoint</span><span>Code</span><span>Time</span>
          </div>
          <div role="table" aria-label="Concur API logs">
            {filtered.map((entry, index) => (
              <button key={`${entry.requestDateTime}-${index}`} type="button" onClick={() => setSelected(entry)} className={`grid w-full grid-cols-[76px_42px_minmax(130px,1fr)_36px_48px] gap-1.5 border-b px-2 py-1.5 text-left text-[10px] leading-tight last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected === entry ? 'bg-accent/50' : 'hover:bg-accent/30'}`}>
                <span>{formatLogDateTime(entry.requestDateTime)}</span>
                <span className="font-medium">{entry.method ?? '—'}</span>
                <span className="truncate">{endpoint(entry.url)}</span>
                <span className={entry.responseStatus && entry.responseStatus < 400 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}>{entry.responseStatus ?? '—'}</span>
                <span>{entry.responseTimeMs ?? '—'}{entry.responseTimeMs !== undefined && 'ms'}</span>
              </button>
            ))}
            {!loading && filtered.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No log entries match.</p>}
          </div>
        </div>

        <aside aria-label="Selected API log response" className="flex min-h-[280px] min-w-0 flex-col">
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
                <strong>API call details</strong>
                <span className="text-muted-foreground">{typeof selected.responseBody === 'string' && selected.responseBody.trimStart().startsWith('<') ? 'XML' : 'JSON'}</span>
                <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={copyPayload}>Copy</Button>
              </div>
              <div aria-label="API log request and response details" className="min-h-0 flex-1 space-y-2 overflow-auto bg-muted/30 p-2 text-xs leading-relaxed">
                <LogSection title="Request parameters" defaultOpen>
                  <pre className="whitespace-pre-wrap rounded-md bg-card p-3">{formatRequestParams(selected.url)}</pre>
                </LogSection>
                <LogSection title="Request payload" defaultOpen>
                  <pre className="whitespace-pre-wrap rounded-md bg-card p-3">{formatRequestPayload(selected.requestParams)}</pre>
                </LogSection>
                <LogSection title="Response payload" defaultOpen>
                  <pre className="whitespace-pre-wrap rounded-md bg-card p-3">{formatResponsePayload(selected.responseBody)}</pre>
                </LogSection>
              </div>
            </>
          ) : <p className="p-3 text-sm text-muted-foreground">Select a log entry to inspect its response payload.</p>}
        </aside>
        <button
          type="button"
          role="separator"
          aria-label="Resize log panes"
          aria-orientation="vertical"
          aria-valuemin={30}
          aria-valuemax={70}
          aria-valuenow={paneWidth}
          onPointerDown={startResize}
          className="absolute bottom-0 top-0 z-10 hidden w-3 -translate-x-1/2 cursor-col-resize items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
          style={{ left: `${paneWidth}%` }}
        >
          <span className="h-10 w-1 rounded-full bg-border transition-colors hover:bg-primary" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function LogSection({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className="overflow-hidden rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-3 bg-muted/50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{title}</span>
        <svg className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div id={contentId} className="border-t p-2">{children}</div>}
    </section>
  );
}
