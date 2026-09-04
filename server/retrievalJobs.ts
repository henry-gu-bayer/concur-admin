import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';

export type RetrievalJobState = 'running' | 'retrying' | 'paused' | 'finalizing' | 'restart-required' | 'complete';

export interface RetrievalJob {
  version: 1;
  id: string;
  domain: 'active-users' | 'spend-profiles';
  entityId: string;
  state: RetrievalJobState;
  startedAt: string;
  updatedAt: string;
  pageCount: number;
  retrievedCount: number;
  totalResults: number | null;
  itemsPerPage: number;
  startIndex: number | null;
  nextCursor: string | null;
  nextOffset: number | null;
  identityGeneration?: string;
  retryAttempt: number;
  lastError?: string;
  lastPageHash?: string;
}

export interface SavedPage<T> {
  sequence: number;
  request: { cursor?: string | null; startIndex?: number | null };
  resources: T[];
  totalResults: number | null;
  startIndex: number | null;
  itemsPerPage: number;
  nextCursor: string | null;
  hash: string;
}

function domainDirectory(entityId: string, domain: RetrievalJob['domain']): string {
  const root = process.env.DATA_DIR ?? 'data';
  return join(root, entityId.toLowerCase(), 'identity', 'retrieval-jobs', domain);
}

function jobPath(entityId: string, domain: RetrievalJob['domain']): string { return join(domainDirectory(entityId, domain), 'job.json'); }
function pagesDirectory(entityId: string, domain: RetrievalJob['domain'], id: string): string { return join(domainDirectory(entityId, domain), 'runs', id, 'pages'); }
function pagePath(entityId: string, domain: RetrievalJob['domain'], id: string, sequence: number): string { return join(pagesDirectory(entityId, domain, id), `${String(sequence).padStart(8, '0')}.json`); }

export function readRetrievalJob(entityId: string, domain: RetrievalJob['domain']): RetrievalJob | null {
  const job = readJsonSnapshot<RetrievalJob>(jobPath(entityId, domain));
  if (!job || job.version !== 1 || job.entityId !== entityId || job.domain !== domain) return null;
  return job;
}

export function writeRetrievalJob(job: RetrievalJob): RetrievalJob {
  job.updatedAt = new Date().toISOString();
  writeJsonSnapshot(jobPath(job.entityId, job.domain), job);
  return job;
}

export function createRetrievalJob(entityId: string, domain: RetrievalJob['domain'], options: Pick<RetrievalJob, 'identityGeneration'> = {}): RetrievalJob {
  const now = new Date().toISOString();
  const job: RetrievalJob = {
    version: 1, id: `${Date.now()}-${randomUUID()}`, domain, entityId, state: 'running', startedAt: now, updatedAt: now,
    pageCount: 0, retrievedCount: 0, totalResults: null, itemsPerPage: 100, startIndex: null, nextCursor: null, nextOffset: domain === 'spend-profiles' ? 1 : null,
    retryAttempt: 0, ...options,
  };
  writeRetrievalJob(job);
  return job;
}

export function discardRetrievalJob(entityId: string, domain: RetrievalJob['domain']): void {
  const existing = readRetrievalJob(entityId, domain);
  if (existing) rmSync(join(domainDirectory(entityId, domain), 'runs', existing.id), { recursive: true, force: true });
  rmSync(jobPath(entityId, domain), { force: true });
}

export function retrievalPageHash(resources: unknown[]): string { return createHash('sha256').update(JSON.stringify(resources)).digest('hex'); }

/** Retry-After permits either seconds or an HTTP date. */
export function retryAfterMilliseconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** The page is committed first; its checkpoint is written only after this returns. */
export function saveRetrievalPage<T>(job: RetrievalJob, page: Omit<SavedPage<T>, 'sequence' | 'hash'>): SavedPage<T> {
  const saved: SavedPage<T> = { sequence: job.pageCount + 1, hash: retrievalPageHash(page.resources), ...page };
  writeJsonSnapshot(pagePath(job.entityId, job.domain, job.id, saved.sequence), saved);
  return saved;
}

export function readRetrievalPages<T>(job: RetrievalJob): SavedPage<T>[] {
  const directory = pagesDirectory(job.entityId, job.domain, job.id);
  if (!existsSync(directory)) return [];
  // A page is intentionally written before its checkpoint. If the process dies
  // between those two operations, the extra page is uncommitted and must not
  // influence cursors, counts, or materialization on Resume.
  return readdirSync(directory).filter((name) => name.endsWith('.json')).sort()
    .map((name) => readJsonSnapshot<SavedPage<T>>(join(directory, name)))
    .filter((page): page is SavedPage<T> => Boolean(page) && page.sequence >= 1 && page.sequence <= job.pageCount);
}

export function deleteRetrievalPages(job: RetrievalJob): void { rmSync(join(domainDirectory(job.entityId, job.domain), 'runs', job.id), { recursive: true, force: true }); }

function wait(milliseconds: number): Promise<void> { return process.env.VITEST ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, milliseconds)); }

export class UpstreamPageError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterMs?: number) { super(message); this.name = 'UpstreamPageError'; }
}

function retryable(error: unknown): boolean {
  if (!(error instanceof UpstreamPageError)) return true;
  return error.status === undefined || error.status === 408 || error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504;
}

/** Retries only transient upstream failures. The callback is responsible for refreshing a 401 once. */
export async function retryPage<T>(job: RetrievalJob, request: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      job.retryAttempt = attempt;
      if (attempt) { job.state = 'retrying'; writeRetrievalJob(job); }
      const result = await request(attempt);
      job.retryAttempt = 0;
      job.state = 'running';
      return result;
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === 4) break;
      const retryAfter = error instanceof UpstreamPageError ? error.retryAfterMs : undefined;
      const backoff = Math.min(30_000, 1_000 * 2 ** attempt) + Math.floor(Math.random() * 250);
      await wait(retryAfter ?? backoff);
    }
  }
  throw lastError;
}
