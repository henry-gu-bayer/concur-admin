import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOG_FILE_NAME = /^api(?:\.([1-9]\d*))?\.log$/;
const MAX_ENTRIES = 1000;

export interface ApiLogFile {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface ApiLogEntry {
  requestDateTime?: string;
  method?: string;
  url?: string;
  responseStatus?: number;
  responseTimeMs?: number;
  correlationId?: string | null;
  responseBody?: unknown;
  [key: string]: unknown;
}

function isLogFile(name: string): boolean {
  return LOG_FILE_NAME.test(name);
}

function logFileRank(name: string): number {
  const match = LOG_FILE_NAME.exec(name);
  return match?.[1] ? Number(match[1]) : 0;
}

export function listLogFiles(logDirectory: string): ApiLogFile[] {
  if (!existsSync(logDirectory)) return [];

  return readdirSync(logDirectory)
    .filter(isLogFile)
    .map((name) => {
      const stat = statSync(join(logDirectory, name));
      return { name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => logFileRank(a.name) - logFileRank(b.name));
}

export function readLogEntries(logDirectory: string, name: string, limit = MAX_ENTRIES): ApiLogEntry[] {
  if (!isLogFile(name)) return [];
  const filePath = join(logDirectory, name);
  if (!existsSync(filePath)) return [];

  const entries: ApiLogEntry[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as ApiLogEntry);
    } catch {
      // Ignore incomplete or malformed JSONL records.
    }
  }

  return entries
    .sort((a, b) => String(b.requestDateTime ?? '').localeCompare(String(a.requestDateTime ?? '')))
    .slice(0, limit);
}

type Response = {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
};

function logDirectory(entityId: string): string {
  return join(process.env.LOG_DIR ?? 'logs', entityId);
}

export function handleListApiLogs(res: Response, entityId: string): void {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ files: listLogFiles(logDirectory(entityId)) }));
}

export function handleGetApiLogEntries(res: Response, entityId: string, name: string): void {
  if (!isLogFile(name)) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Invalid log filename.' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ entries: readLogEntries(logDirectory(entityId), name) }));
}
