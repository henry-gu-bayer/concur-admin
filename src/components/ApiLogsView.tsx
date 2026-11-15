import { ReactNode, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ApiLogEntry, ApiLogFile, getLogEntries, getLogFiles } from '../api/apiLogsApi';
import { WorkspaceVisible } from '../state/workspaceVisibility';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';

const SENSITIVE_QUERY_KEYS = new Set([
  'access_token', 'authorization', 'client_id', 'client_secret', 'id_token',
  'geolocation', 'password', 'refresh_token', 'secret', 'token',
]);

const logColumns = 'grid min-w-[25rem] grid-cols-[84px_44px_minmax(0,1fr)_44px_36px_56px] items-center gap-2 px-3';

function isSensitiveQueryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_QUERY_KEYS.has(normalized)
    || normalized.includes('secret')
    || normalized.includes('token')
    || normalized.includes('password');
}

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
    const safeValue = isSensitiveQueryKey(key) ? '***' : value;
    const current = out[key];
    if (current === undefined) out[key] = safeValue;
    else if (Array.isArray(current)) current.push(safeValue);
    else out[key] = [current, safeValue];
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

export function isTokenExchange(entry: ApiLogEntry): boolean {
  return entry.method?.toUpperCase() === 'POST' && /\/oauth2\/v0\/token\/?$/i.test(endpoint(entry.url));
}

/**
 * Format a UNIX timestamp as UTC. Concur returns `refresh_expires_in` as an
 * absolute epoch-seconds instant (unlike `expires_in`, which is a duration);
 * millisecond values are accepted too so a differently-shaped field still
 * renders a sensible date instead of one in 1970.
 */
export function formatUnixTimeUtc(value: unknown): string | null {
  const raw = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  const date = new Date(raw > 1e12 ? raw : raw * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function tokenExpiryRows(entry: ApiLogEntry): { label: string; raw: string; utc: string }[] {
  const rows: { label: string; raw: string; utc: string }[] = [];
  const body = parseObject(entry.responseBody);
  for (const key of ['refresh_expires_in', 'refresh_token_expires_in']) {
    const utc = formatUnixTimeUtc(body?.[key]);
    if (utc) rows.push({ label: `Refresh token expires (${key})`, raw: String(body?.[key]), utc });
  }
  for (const [name, decoded] of Object.entries(entry.tokenClaims ?? {})) {
    const exp = parseObject(decoded.payload)?.exp;
    const utc = formatUnixTimeUtc(exp);
    if (utc) rows.push({ label: `${name === 'id_token' ? 'ID' : 'Access'} token expires (exp)`, raw: String(exp), utc });
  }
  return rows;
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
  const visible = useContext(WorkspaceVisible);
  const [files, setFiles] = useState<ApiLogFile[]>([]);
  const [file, setFile] = useState('');
  const [entries, setEntries] = useState<ApiLogEntry[]>([]);
  const [selected, setSelected] = useState<ApiLogEntry | null>(null);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paneWidth, setPaneWidth] = useState(47);
  const loadingRef = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const load = async (requestedFile?: string) => {
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const available = await getLogFiles();
      setFiles(available);
      const preferredFile = requestedFile ?? file;
      const nextFile = available.find(({ name }) => name === preferredFile)?.name ?? available[0]?.name ?? '';
      setFile(nextFile);
      const nextEntries = nextFile ? await getLogEntries(nextFile) : [];
      setEntries(nextEntries);
      setSelected(nextEntries[0] ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    // Leaving this view may generate new log entries. Reload on return unless
    // an earlier load is still running.
    if (visible && !loadingRef.current) void load();
  }, [visible]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) =>
      (!needle || [entry.url, entry.method, entry.level, entry.responseStatus, entry.correlationId].some((value) => String(value ?? '').toLowerCase().includes(needle))) &&
      (level === 'all' || entry.level === level) &&
      (status === 'all' || String(entry.responseStatus) === status)
    );
  }, [entries, level, query, status]);

  const levelValues = ['info', 'warn', 'error'].filter((value) => entries.some((entry) => entry.level === value));
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
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter API logs" placeholder="Filter URL, method, status, or correlation ID" className="!h-9 min-w-0 text-xs sm:w-0 sm:min-w-56 sm:flex-1" />
        <Select value={level} onChange={(event) => setLevel(event.target.value)} aria-label="Filter by level" className="!h-9 !w-auto min-w-24 text-xs">
          <option value="all">All levels</option>
          {levelValues.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status" className="!h-9 !w-auto min-w-24 text-xs">
          <option value="all">All status</option>
          {statusValues.map((value) => <option key={value} value={String(value)}>{value}</option>)}
        </Select>
        <Select value={file} onChange={(event) => void load(event.target.value)} aria-label="Select log file" className="!h-9 !w-auto min-w-24 max-w-full text-xs">
          {files.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </Select>
        <Button type="button" variant="outline" size="sm" className="!h-9" loading={loading} onClick={() => void load()}>Refresh</Button>
      </div>

      {error && <p role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div
        ref={workspaceRef}
        className="relative grid overflow-hidden rounded-lg border bg-card lg:h-[calc(100vh-12.5rem)] lg:min-h-[390px] lg:grid-cols-[var(--log-pane-width)_minmax(0,1fr)]"
        style={{ '--log-pane-width': `${paneWidth}%` } as CSSProperties}
      >
        <div aria-label="API log entries list" className="max-h-80 min-h-0 min-w-0 overflow-auto border-b lg:max-h-none lg:border-b-0 lg:border-r">
          <div className={`${logColumns} sticky top-0 border-b bg-muted py-2 text-xs font-medium text-muted-foreground`}>
            <span>Time</span><span>Verb</span><span>Endpoint</span><span>Level</span><span className="text-right">Code</span><span className="text-right">Duration</span>
          </div>
          <div role="table" aria-label="Concur API logs">
            {filtered.map((entry, index) => (
              <button key={`${entry.requestDateTime}-${index}`} type="button" onClick={() => setSelected(entry)} aria-pressed={selected === entry} className={`${logColumns} w-full border-b py-2 text-left text-xs leading-tight last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected === entry ? 'bg-primary/5 shadow-[inset_2px_0_0_hsl(var(--primary))]' : 'hover:bg-accent/30'}`}>
                <span className="text-[11px] tabular-nums text-muted-foreground">{formatLogDateTime(entry.requestDateTime)}</span>
                <span className="font-medium">{entry.method ?? '—'}</span>
                <span className="truncate font-mono text-[11px]" title={endpoint(entry.url)}>{endpoint(entry.url)}</span>
                <span className={entry.level === 'error' ? 'text-destructive' : entry.level === 'warn' ? 'text-warning' : 'text-muted-foreground'}>{entry.level ?? '—'}</span>
                <span className={`text-right tabular-nums ${entry.responseStatus && entry.responseStatus >= 400 ? 'text-destructive' : 'text-muted-foreground'}`}>{entry.responseStatus ?? '—'}</span>
                <span className="text-right text-[11px] tabular-nums text-muted-foreground">{entry.responseTimeMs ?? '—'}{entry.responseTimeMs !== undefined && 'ms'}</span>
              </button>
            ))}
            {!loading && filtered.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No log entries match.</p>}
          </div>
        </div>

        <aside aria-label="Selected API log response" className="flex min-h-[280px] min-w-0 flex-col lg:min-h-0">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
                <strong>API call details</strong>
                {selected.level && <span className={selected.level === 'error' ? 'text-destructive' : selected.level === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400'}>{selected.level.toUpperCase()}</span>}
                <span className="text-muted-foreground">{typeof selected.responseBody === 'string' && selected.responseBody.trimStart().startsWith('<') ? 'XML' : 'JSON'}</span>
                <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={copyPayload}>Copy</Button>
              </div>
              <div aria-label="API log request and response details" className="min-h-0 flex-1 space-y-2 overflow-auto bg-muted/30 p-2 text-xs leading-relaxed">
                <LogSection title="Request parameters" defaultOpen>
                  <pre className="overflow-x-auto whitespace-pre rounded-md bg-card p-3">{formatRequestParams(selected.url)}</pre>
                </LogSection>
                <LogSection title="Request payload" defaultOpen>
                  <pre className="overflow-x-auto whitespace-pre rounded-md bg-card p-3">{formatRequestPayload(selected.requestParams)}</pre>
                </LogSection>
                <LogSection title="Response payload" defaultOpen>
                  <pre className="overflow-x-auto whitespace-pre rounded-md bg-card p-3">{formatResponsePayload(selected.responseBody)}</pre>
                </LogSection>
                {isTokenExchange(selected) && <TokenDetails entry={selected} />}
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

function TokenDetails({ entry }: { entry: ApiLogEntry }) {
  const expiries = tokenExpiryRows(entry);
  const claims = Object.entries(entry.tokenClaims ?? {});
  return (
    <>
      <LogSection title="Token expiry (UTC)" defaultOpen>
        {expiries.length > 0 ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-md bg-card p-3">
            {expiries.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd><span className="font-medium">{row.utc}</span> <span className="text-muted-foreground">({row.raw})</span></dd>
              </div>
            ))}
          </dl>
        ) : <p className="p-3 text-muted-foreground">No token expiry in this response.</p>}
      </LogSection>
      <LogSection title="Decoded JWT tokens" defaultOpen>
        {claims.length > 0 ? (
          <div className="space-y-2">
            {claims.map(([name, decoded]) => (
              <div key={name}>
                <p className="mb-1 font-medium">{name}</p>
                <pre className="overflow-x-auto whitespace-pre rounded-md bg-card p-3">{JSON.stringify(decoded, null, 2)}</pre>
              </div>
            ))}
          </div>
        ) : <p className="p-3 text-muted-foreground">No decoded JWT claims were logged for this response (entries written before decoding was added only contain masked tokens).</p>}
      </LogSection>
    </>
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
        className="flex w-full items-center justify-between gap-3 bg-muted/40 px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
      >
        <span>{title}</span>
        <CaretRightIcon size={16} aria-hidden="true" className={`shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div id={contentId} className="border-t p-2">{children}</div>}
    </section>
  );
}
