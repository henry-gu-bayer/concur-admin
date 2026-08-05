import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * API call logger — one rolling log file + one concise terminal line.
 *
 * Every request/response through the backend (token exchange + Concur API
 * proxy) is recorded with: request datetime, URL, headers, params, response
 * time, status, response body, and the `concur-correlationid` response header.
 * Response headers are NOT logged — only the correlation id is kept.
 * Sensitive values (client_id, client_secret, tokens, Authorization, JWTs) are
 * masked before anything is written.
 *
 * Storage:
 *  - all entries appended as JSONL to a single file: logs/api.log
 *  - when the file exceeds MAX_LOG_BYTES (10 MB) it is rolled over:
 *    api.log → api.1.log, api.1.log → api.2.log, … up to MAX_LOG_FILES.
 *  - the terminal gets one concise line per call.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

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

function maskHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '***' : v;
  }
  return out;
}

function maskBody(body: string, contentType: string): unknown {
  if (!body) return undefined;
  if (contentType.includes('application/json')) {
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
  requestDateTime: string;
  method: string;
  url: string;
  requestHeaders: Record<string, unknown>;
  requestParams: string;
  responseTimeMs: number;
  responseStatus: number;
  correlationId: string | null;
  responseBody?: unknown;
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
function persist(entityId: string, kind: 'auth' | 'api', entry: ApiCallLog, rootDirectory?: string): void {
  const logDirectory = entityLogDirectory(entityId, rootDirectory);
  try {
    ensureDir(logDirectory);
    rolloverIfNeeded(logDirectory);
    appendFileSync(join(logDirectory, 'api.log'), JSON.stringify({ entityId, kind, ...entry }) + '\n', 'utf-8');
  } catch (err) {
    console.warn('[concur:log] failed to write log:', err instanceof Error ? err.message : err);
  }
}

function terminalLine(kind: 'auth' | 'api', entry: ApiCallLog): string {
  const corr = entry.correlationId ? ` corr=${entry.correlationId}` : '';
  return `[concur:${kind}] ${entry.method} ${entry.url} → ${entry.responseStatus} ${entry.responseTimeMs}ms${corr}`;
}

/* ── Public API ─────────────────────────────────────────────────────── */

export interface ExchangeRecord {
  requestHeaders: Record<string, unknown>;
  requestBody: string;
  response: { status: number; headers: Record<string, string>; body: string };
  responseTimeMs: number;
}

export function logTokenExchange(entityId: string, url: string, rec: ExchangeRecord): void {
  const entry: ApiCallLog = {
    requestDateTime: new Date().toISOString(),
    method: 'POST',
    url,
    requestHeaders: maskHeaders(rec.requestHeaders),
    requestParams: maskParams(rec.requestBody),
    responseTimeMs: rec.responseTimeMs,
    responseStatus: rec.response.status,
    correlationId: rec.response.headers['concur-correlationid'] ?? null,
    responseBody: maskBody(rec.response.body, rec.response.headers['content-type'] ?? 'application/json'),
  };
  persist(entityId, 'auth', entry);
  if (!enabled('info')) return;
  console.log(terminalLine('auth', entry));
  if (enabled('debug')) console.log(JSON.stringify(entry, null, 2));
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
  const entry: ApiCallLog = {
    requestDateTime: new Date().toISOString(),
    method: rec.method,
    url: rec.url,
    requestHeaders: maskHeaders(rec.requestHeaders),
    requestParams: maskParams(rec.requestBody),
    responseTimeMs: rec.responseTimeMs,
    responseStatus: rec.response.status,
    correlationId: rec.response.headers['concur-correlationid'] ?? null,
    responseBody: rec.response.body,
  };
  persist(entityId, 'api', entry, rootDirectory);
  if (!enabled('info')) return;
  console.log(terminalLine('api', entry));
  if (enabled('debug')) console.log(JSON.stringify(entry, null, 2));
}
