import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientInfo, LocalOperatorInfo } from './localOperator';

/**
 * API call logger — rolling log files + concise terminal lines.
 *
 * Every request/response through the backend (token exchange + Concur API
 * proxy) is classified by severity and, when it meets LOG_LEVEL, recorded with
 * request datetime, URL, headers, params, response
 * time, status, response body, and the `concur-correlationid` response header.
 * Upstream calls that fail before any HTTP response (DNS/TLS/proxy/timeout)
 * are recorded too, with responseStatus 0 and the transport error as the body.
 * Response headers are NOT logged — only the correlation id is kept.
 * Sensitive values (client_id, client_secret, tokens, Authorization, JWTs) are
 * masked before anything is written.
 *
 * Also records non-API audit events:
 *  - startup operator identity → logs/app.log (`kind: 'startup'`)
 *  - first browser client per entity → logs/<entity>/api.log (`kind: 'client'`)
 *
 * Storage:
 *  - matching entries appended as JSONL to a single file: logs/<entity>/api.log
 *  - when the file exceeds MAX_LOG_BYTES (10 MB) it is rolled over:
 *    api.log → api.1.log, api.1.log → api.2.log, … up to MAX_LOG_FILES.
 *  - the terminal gets one concise line per call.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LoggedLevel = Exclude<LogLevel, 'debug' | 'silent'>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES = 5; // keep api.log + api.1.log … api.5.log

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (Object.keys(LEVEL_ORDER) as LogLevel[]).includes(raw as LogLevel) ? (raw as LogLevel) : 'info';
}
function enabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel()];
}

/** Classify completed HTTP calls by the action an operator should take. */
function responseLogLevel(status: number): LoggedLevel {
  if (status === 0 || status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

/* ── Sensitive-data masking ─────────────────────────────────────────── */

const SENSITIVE_KEYS = new Set([
  'client_id', 'client_secret', 'secret', 'access_token', 'refresh_token',
  'id_token', 'token', 'password', 'authorization', 'geolocation',
]);
const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key']);
const SAFE_KEYS = new Set(['token_type', 'expires_in', 'refresh_expires_in', 'refresh_token_expires_in', 'scope']);
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export function maskValue(value: unknown): string {
  const s = String(value ?? '');
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}…***(${s.length})`;
}

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SAFE_KEYS.has(k)) return false;
  if (SENSITIVE_KEYS.has(k)) return true;
  return k.includes('secret') || k.includes('token') || k.includes('password');
}

function maskDeep(value: unknown, keyHint = ''): unknown {
  if (typeof value === 'string') {
    if (isSensitiveKey(keyHint)) return maskValue(value);
    // Image v1 returns a signed receipt URL whose path and query grant access
    // to the attachment. Treat it like a credential even though the key is
    // simply named `Url`.
    if (keyHint.toLowerCase() === 'url' && /\/imaging\/web\/file\//i.test(value)) return maskValue(value);
    return value.replace(JWT_RE, (m) => maskValue(m));
  }
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, keyHint));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? maskValue(typeof v === 'object' ? JSON.stringify(v) : v) : maskDeep(v, k);
    }
    return out;
  }
  return value;
}

function maskParams(raw: string): string {
  if (!raw) return raw;
  return raw
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      const val = pair.slice(eq + 1);
      return isSensitiveKey(decodeURIComponent(key)) ? `${key}=***` : `${key}=${val}`;
    })
    .join('&');
}

function maskUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const safeParams = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      safeParams.append(key, isSensitiveKey(key) ? '***' : value);
    }
    url.search = safeParams.toString();
    return url.toString();
  } catch {
    return raw;
  }
}

function maskHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '***' : v;
  }
  return out;
}

function maskBody(body: string, contentType: string): unknown {
  if (!body) return undefined;
  const trimmed = body.trim();
  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return maskDeep(JSON.parse(body));
    } catch {
      /* fall through */
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) return maskParams(body);
  return body.replace(JWT_RE, (m) => maskValue(m));
}

/* ── Log entry + rolling-file persistence ───────────────────────────── */

export interface ApiCallLog {
  level: LoggedLevel;
  requestDateTime: string;
  method: string;
  url: string;
  requestHeaders: Record<string, unknown>;
  requestParams: unknown;
  responseTimeMs: number;
  responseStatus: number;
  correlationId: string | null;
  responseBody?: unknown;
}

function headerValue(headers: Record<string, unknown>, name: string): string {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof entry?.[1] === 'string' ? entry[1] : '';
}

/** Defense-in-depth for legacy JSONL entries written before body masking was enforced. */
export function maskStoredLogValue(value: unknown): unknown {
  if (typeof value !== 'string') return maskDeep(value);
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return maskDeep(JSON.parse(value));
    } catch {
      /* Fall through to JWT masking for malformed JSON. */
    }
  }
  return value.replace(JWT_RE, (match) => maskValue(match));
}

export function entityLogDirectory(entityId: string, rootDirectory = process.env.LOG_DIR ?? 'logs'): string {
  return join(rootDirectory, entityId);
}

function ensureDir(logDirectory: string): void {
  mkdirSync(logDirectory, { recursive: true });
}

/** Roll api.log → api.1.log → … when it exceeds MAX_LOG_BYTES. */
function rolloverIfNeeded(logDirectory: string): void {
  const logFile = join(logDirectory, 'api.log');
  try {
    if (!existsSync(logFile)) return;
    if (statSync(logFile).size < MAX_LOG_BYTES) return;
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const src = join(logDirectory, `api.${i}.log`);
      const dst = join(logDirectory, `api.${i + 1}.log`);
      if (existsSync(src)) renameSync(src, dst);
    }
    renameSync(logFile, join(logDirectory, 'api.1.log'));
    console.log(`[concur:log] rolled over ${logFile} (> ${MAX_LOG_BYTES / 1024 / 1024} MB)`);
  } catch (err) {
    console.warn('[concur:log] rollover failed:', err instanceof Error ? err.message : err);
  }
}

/** Append one JSONL entry to the single rolling log file. */
function persist(entityId: string, kind: 'auth' | 'api' | 'client', entry: ApiCallLog, rootDirectory?: string): boolean {
  if (!enabled(entry.level)) return false;
  const logDirectory = entityLogDirectory(entityId, rootDirectory);
  try {
    ensureDir(logDirectory);
    rolloverIfNeeded(logDirectory);
    appendFileSync(join(logDirectory, 'api.log'), JSON.stringify({ entityId, kind, ...entry }) + '\n', 'utf-8');
    return true;
  } catch (err) {
    console.warn('[concur:log] failed to write log:', err instanceof Error ? err.message : err);
    return false;
  }
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':');
}

function persistAppLog(record: Record<string, unknown>, rootDirectory?: string): boolean {
  const level = (record.level as LogLevel | undefined) ?? 'info';
  if (!enabled(level)) return false;
  const directory = rootDirectory ?? process.env.LOG_DIR ?? 'logs';
  try {
    ensureDir(directory);
    appendFileSync(join(directory, 'app.log'), JSON.stringify(record) + '\n', 'utf-8');
    return true;
  } catch (err) {
    console.warn('[concur:log] failed to write app log:', err instanceof Error ? err.message : err);
    return false;
  }
}

function terminalLine(entityId: string, entry: ApiCallLog): string {
  const corr = entry.correlationId ? ` corr=${entry.correlationId}` : '';
  const time = formatClock(entry.requestDateTime);
  return `[${entityId}] ${time} ${entry.level.toUpperCase()} ${entry.method} ${entry.url} → ${entry.responseStatus} ${entry.responseTimeMs}ms${corr}`;
}

/** Mirror persisted severity in the terminal and reserve full payloads for debug mode. */
function writeTerminal(entityId: string, entry: ApiCallLog): void {
  if (!enabled(entry.level)) return;
  const line = terminalLine(entityId, entry);
  if (entry.level === 'error') console.error(line);
  else if (entry.level === 'warn') console.warn(line);
  else console.log(line);
  if (currentLevel() === 'debug') console.debug(JSON.stringify(entry, null, 2));
}

/* ── Public API ─────────────────────────────────────────────────────── */

export interface ExchangeRecord {
  requestHeaders: Record<string, unknown>;
  requestBody: string;
  response: { status: number; headers: Record<string, string>; body: string };
  responseTimeMs: number;
}

export function logTokenExchange(entityId: string, url: string, rec: ExchangeRecord, rootDirectory?: string): void {
  const entry: ApiCallLog = {
    level: responseLogLevel(rec.response.status),
    requestDateTime: new Date().toISOString(),
    method: 'POST',
    url: maskUrl(url),
    requestHeaders: maskHeaders(rec.requestHeaders),
    requestParams: maskParams(rec.requestBody),
    responseTimeMs: rec.responseTimeMs,
    responseStatus: rec.response.status,
    correlationId: rec.response.headers['concur-correlationid'] ?? null,
    responseBody: maskBody(rec.response.body, rec.response.headers['content-type'] ?? 'application/json'),
  };
  persist(entityId, 'auth', entry, rootDirectory);
  writeTerminal(entityId, entry);
}

export interface ExchangeFailureRecord {
  requestHeaders: Record<string, unknown>;
  requestBody: string;
  error: string;
  responseTimeMs: number;
}

/** Record a token exchange that never got an HTTP response (DNS/TLS/proxy/timeout). */
export function logTokenExchangeFailure(entityId: string, url: string, rec: ExchangeFailureRecord, rootDirectory?: string): void {
  const entry: ApiCallLog = {
    level: 'error',
    requestDateTime: new Date().toISOString(),
    method: 'POST',
    url: maskUrl(url),
    requestHeaders: maskHeaders(rec.requestHeaders),
    requestParams: maskParams(rec.requestBody),
    responseTimeMs: rec.responseTimeMs,
    responseStatus: 0,
    correlationId: null,
    responseBody: maskDeep({ error: rec.error }),
  };
  persist(entityId, 'auth', entry, rootDirectory);
  writeTerminal(entityId, entry);
}

export interface ProxyCallRecord {
  method: string;
  url: string;
  requestHeaders: Record<string, unknown>;
  requestBody: string;
  response: { status: number; headers: Record<string, string>; body: string };
  responseTimeMs: number;
}

export function logApiCall(entityId: string, rec: ProxyCallRecord, rootDirectory?: string): void {
  const requestContentType = headerValue(rec.requestHeaders, 'content-type');
  const responseContentType = rec.response.headers['content-type'] ?? '';
  const entry: ApiCallLog = {
    level: responseLogLevel(rec.response.status),
    requestDateTime: new Date().toISOString(),
    method: rec.method,
    url: maskUrl(rec.url),
    requestHeaders: maskHeaders(rec.requestHeaders),
    requestParams: maskBody(rec.requestBody, requestContentType),
    responseTimeMs: rec.responseTimeMs,
    responseStatus: rec.response.status,
    correlationId: rec.response.headers['concur-correlationid'] ?? null,
    responseBody: maskBody(rec.response.body, responseContentType),
  };
  persist(entityId, 'api', entry, rootDirectory);
  writeTerminal(entityId, entry);
}

export interface ProxyCallFailureRecord {
  method: string;
  url: string;
  requestHeaders: Record<string, unknown>;
  requestBody: string;
  error: string;
  responseTimeMs: number;
}

/** Record a proxied API call that never got an HTTP response (DNS/TLS/proxy/timeout). */
export function logApiCallFailure(entityId: string, rec: ProxyCallFailureRecord, rootDirectory?: string): void {
  const entry: ApiCallLog = {
    level: 'error',
    requestDateTime: new Date().toISOString(),
    method: rec.method,
    url: maskUrl(rec.url),
    requestHeaders: maskHeaders(rec.requestHeaders),
    requestParams: maskBody(rec.requestBody, headerValue(rec.requestHeaders, 'content-type')),
    responseTimeMs: rec.responseTimeMs,
    responseStatus: 0,
    correlationId: null,
    responseBody: maskDeep({ error: rec.error }),
  };
  persist(entityId, 'api', entry, rootDirectory);
  writeTerminal(entityId, entry);
}

/** Record the local OS operator once when the Vite backend starts. */
export function logAppStartup(operator: LocalOperatorInfo, rootDirectory?: string): void {
  const requestDateTime = new Date().toISOString();
  const record = {
    kind: 'startup' as const,
    level: 'info' as const,
    requestDateTime,
    operator,
  };
  persistAppLog(record, rootDirectory);
  if (!enabled('info')) return;
  const domain = operator.userDomain ? ` domain=${operator.userDomain}` : '';
  const user = operator.username ?? '(unknown)';
  console.log(
    `[app] ${formatClock(requestDateTime)} INFO startup user=${user}${domain} host=${operator.hostname} platform=${operator.platform} ${operator.release} ${operator.arch}`,
  );
  if (currentLevel() === 'debug') console.debug(JSON.stringify(record, null, 2));
}

/** Record browser client metadata for an entity (once per process, caller-enforced). */
export function logClientInfo(entityId: string, client: ClientInfo, rootDirectory?: string): void {
  const requestDateTime = new Date().toISOString();
  if (!enabled('info')) return;
  const logDirectory = entityLogDirectory(entityId, rootDirectory);
  const record = { entityId, kind: 'client' as const, level: 'info' as const, requestDateTime, client };
  try {
    ensureDir(logDirectory);
    rolloverIfNeeded(logDirectory);
    appendFileSync(join(logDirectory, 'api.log'), JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.warn('[concur:log] failed to write log:', err instanceof Error ? err.message : err);
  }
  const platform = client.platform ?? '(unknown)';
  const lang = client.language ?? '(unknown)';
  const ua = client.userAgent ?? '(unknown)';
  console.log(`[${entityId}] ${formatClock(requestDateTime)} INFO client platform=${platform} lang=${lang} ua=${ua}`);
  if (currentLevel() === 'debug') console.debug(JSON.stringify(record, null, 2));
}
