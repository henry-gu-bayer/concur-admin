import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { getServerAccessToken } from './concurAuth';
import { logApiCall, logApiCallFailure } from './logger';
import { createEntityRegistry } from './entities';
import { upstreamFetch } from './upstreamFetch';

/**
 * Server-side repository for Expense Forms & Form Fields (Expense Form v1.1).
 *
 * Retrieval strategy — a three-level crawl (these v1.1 endpoints speak XML only):
 *   GET /api/expense/expensereport/v1.1/report/Forms                → form types
 *   GET .../report/Forms/{FormCode}                                 → forms of one type
 *   GET .../report/Form/{FormId}/Fields                             → fields of one form
 * Form IDs contain characters like `$`, so every path segment is URL-encoded.
 *
 * Storage — one snapshot per entity: data/<entity>/forms.json. The UI always
 * reads the local snapshot; Concur is only re-crawled via the explicit refresh
 * endpoint (SSE progress), never implicitly by viewing the page.
 *
 * Error tolerance: a failing form/type is recorded on its entry (`error`) and
 * the crawl continues — a partial snapshot is more useful than none.
 */

export interface FormFieldEntry {
  id?: string;
  label?: string;
  controlType?: string;
  dataType?: string;
  maxLength?: number;
  required?: boolean;
  cols?: number;
  access?: string;
  width?: number;
  custom?: boolean;
  sequence?: number;
}

export interface FormEntry {
  name: string;
  formId: string;
  fields: FormFieldEntry[];
  error?: string;
}

export interface FormTypeEntry {
  name: string;
  formCode: string;
  forms: FormEntry[];
  error?: string;
}

export interface FormsSnapshot {
  retrievedAt: string;
  formTypes: FormTypeEntry[];
}

export interface FormsProgress {
  phase: 'types' | 'form' | 'done-form' | 'type-error';
  types?: number;
  formsFetched?: number;
  formsTotal?: number;
  formName?: string;
  formCode?: string;
  error?: string;
}

export interface FormsRefreshSummary {
  types: number;
  forms: number;
  fields: number;
  failed: number;
  error?: string;
}

/* ── XML parsing ────────────────────────────────────────────────────── */

const xmlParser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false, // keep every value a string; convert explicitly below
  isArray: (tagName) => tagName === 'FormType' || tagName === 'FormData' || tagName === 'FormField',
});

function str(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

function num(value: unknown): number | undefined {
  const s = str(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

function ynBool(value: unknown): boolean | undefined {
  const s = str(value);
  if (s === 'Y') return true;
  if (s === 'N') return false;
  return undefined;
}

export function parseFormTypes(xml: string): { name: string; formCode: string }[] {
  const doc = xmlParser.parse(xml);
  const items = doc?.FormTypesList?.FormType ?? [];
  return items
    .map((t: Record<string, unknown>) => ({ name: str(t.Name) ?? '', formCode: str(t.FormCode) ?? '' }))
    .filter((t: { formCode: string }) => t.formCode !== '');
}

export function parseForms(xml: string): { name: string; formId: string }[] {
  const doc = xmlParser.parse(xml);
  const items = doc?.FormDataList?.FormData ?? [];
  return items
    .map((f: Record<string, unknown>) => ({ name: str(f.Name) ?? '', formId: str(f.FormId) ?? '' }))
    .filter((f: { formId: string }) => f.formId !== '');
}

export function parseFormFields(xml: string): FormFieldEntry[] {
  const doc = xmlParser.parse(xml);
  const items = doc?.FormFieldsList?.FormField ?? [];
  return items.map((f: Record<string, unknown>) => ({
    id: str(f.Id),
    label: str(f.Label),
    controlType: str(f.ControlType),
    dataType: str(f.DataType),
    maxLength: num(f.MaxLength),
    required: ynBool(f.Required),
    cols: num(f.Cols),
    access: str(f.Access),
    width: num(f.Width),
    custom: ynBool(f.Custom),
    sequence: num(f.Sequence),
  }));
}

/* ── Fetch helpers ──────────────────────────────────────────────────── */

function baseUrl(entityId: string): string {
  return createEntityRegistry().require(entityId).baseUrl;
}

function headerMap(headers: { forEach: (cb: (v: string, k: string) => void) => void }): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

async function fetchXml(entityId: string, url: string, token: string): Promise<string> {
  const requestHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/xml' };
  const start = Date.now();
  let res;
  try {
    res = await upstreamFetch(url, { method: 'GET', headers: requestHeaders });
  } catch (err) {
    logApiCallFailure(entityId, {
      method: 'GET',
      url,
      requestHeaders,
      requestBody: '',
      error: err instanceof Error ? err.message : String(err),
      responseTimeMs: Date.now() - start,
    });
    throw err;
  }
  const responseTimeMs = Date.now() - start;
  const text = await res.text();
  logApiCall(entityId, {
    method: 'GET',
    url,
    requestHeaders,
    requestBody: '',
    response: { status: res.status, headers: headerMap(res.headers), body: text },
    responseTimeMs,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 160)}`);
  }
  return text;
}

/* ── Local snapshot ─────────────────────────────────────────────────── */

function formsFilePath(entityId: string): string {
  return join(process.env.DATA_DIR ?? 'data', entityId, 'forms.json');
}

export function readFormsSnapshot(entityId: string): FormsSnapshot | null {
  const file = formsFilePath(entityId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as FormsSnapshot;
  } catch {
    return null;
  }
}

function writeFormsSnapshot(entityId: string, snapshot: FormsSnapshot): void {
  mkdirSync(dirname(formsFilePath(entityId)), { recursive: true });
  writeFileSync(formsFilePath(entityId), JSON.stringify(snapshot), 'utf-8');
}

/* ── Full crawl ─────────────────────────────────────────────────────── */

/** Parallel fields requests — entities can hold thousands of forms. */
const FIELDS_CONCURRENCY = 6;

/**
 * Crawl form types → forms → fields and persist the snapshot.
 * Phase 1 walks the types sequentially (a handful of requests) to discover
 * every form; phase 2 fetches all forms' fields through a bounded worker
 * pool. Per-type and per-form failures are recorded on the entries; the
 * crawl continues. Throws only when the form-types request itself fails.
 */
export async function fetchForms(
  entityId: string,
  opts: { onProgress?: (p: FormsProgress) => void } = {}
): Promise<FormsSnapshot> {
  const onProgress = opts.onProgress ?? (() => {});
  const token = await getServerAccessToken(entityId);
  const base = baseUrl(entityId);
  const root = `${base}/api/expense/expensereport/v1.1/report`;

  const types = parseFormTypes(await fetchXml(entityId, `${root}/Forms`, token));
  onProgress({ phase: 'types', types: types.length, formsFetched: 0, formsTotal: 0 });

  // Phase 1: discover the forms of every type.
  const formTypes: FormTypeEntry[] = [];
  const queue: { typeEntry: FormTypeEntry; formEntry: FormEntry }[] = [];
  for (const t of types) {
    const typeEntry: FormTypeEntry = { name: t.name, formCode: t.formCode, forms: [] };
    try {
      const forms = parseForms(await fetchXml(entityId, `${root}/Forms/${encodeURIComponent(t.formCode)}`, token));
      for (const f of forms) {
        const formEntry: FormEntry = { name: f.name, formId: f.formId, fields: [] };
        typeEntry.forms.push(formEntry);
        queue.push({ typeEntry, formEntry });
      }
    } catch (err) {
      typeEntry.error = err instanceof Error ? err.message : String(err);
      onProgress({ phase: 'type-error', formCode: t.formCode, error: typeEntry.error, types: types.length, formsFetched: 0, formsTotal: 0 });
    }
    formTypes.push(typeEntry);
  }

  // Phase 2: bounded-concurrency worker pool over all discovered forms.
  let formsFetched = 0;
  const formsTotal = queue.length;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      const { typeEntry, formEntry } = queue[cursor++];
      onProgress({ phase: 'form', formName: formEntry.name, formCode: typeEntry.formCode, formsFetched, formsTotal, types: types.length });
      try {
        formEntry.fields = parseFormFields(await fetchXml(entityId, `${root}/Form/${encodeURIComponent(formEntry.formId)}/Fields`, token));
      } catch (err) {
        formEntry.error = err instanceof Error ? err.message : String(err);
      }
      formsFetched += 1;
      onProgress({ phase: 'done-form', formName: formEntry.name, formCode: typeEntry.formCode, formsFetched, formsTotal, types: types.length, error: formEntry.error });
    }
  };
  await Promise.all(Array.from({ length: Math.min(FIELDS_CONCURRENCY, Math.max(queue.length, 1)) }, worker));

  const snapshot: FormsSnapshot = { retrievedAt: new Date().toISOString(), formTypes };
  writeFormsSnapshot(entityId, snapshot);
  return snapshot;
}

/* ── HTTP handlers (wired into the dev-server middleware) ───────────── */

interface ServerResponse {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
  write?: (chunk: string) => void;
  flushHeaders?: () => void;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** GET /api/local/forms — the cached snapshot only; never calls Concur. */
export function handleGetForms(res: ServerResponse, entityId: string): void {
  const snapshot = readFormsSnapshot(entityId);
  if (!snapshot) {
    return sendJson(res, 404, { error: 'No forms snapshot yet — use Refresh to fetch from Concur.' });
  }
  sendJson(res, 200, snapshot);
}

/**
 * POST /api/local/forms/refresh — full re-crawl, streaming progress as
 * Server-Sent Events on the same connection, ending with a `done` summary.
 */
export function handleRefreshForms(res: ServerResponse, entityId: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write?.(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  void (async () => {
    try {
      const snapshot = await fetchForms(entityId, { onProgress: (p) => send('progress', p) });
      let forms = 0;
      let fields = 0;
      let failed = 0;
      for (const t of snapshot.formTypes) {
        if (t.error) failed += 1;
        for (const f of t.forms) {
          forms += 1;
          fields += f.fields.length;
          if (f.error) failed += 1;
        }
      }
      send('done', { types: snapshot.formTypes.length, forms, fields, failed } satisfies FormsRefreshSummary);
    } catch (err) {
      send('done', { types: 0, forms: 0, fields: 0, failed: 1, error: err instanceof Error ? err.message : String(err) } satisfies FormsRefreshSummary);
    }
    res.end();
  })();
}
