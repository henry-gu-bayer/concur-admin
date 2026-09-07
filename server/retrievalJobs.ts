import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';

export type RetrievalJobState = 'running' | 'retrying' | 'paused' | 'finalizing' | 'restart-required' | 'complete';
export type RetrievalJobPhase = 'downloading' | 'indexing' | 'validating' | 'committing' | 'complete';

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
  phase: RetrievalJobPhase;
  phasePercent: number;
  viewableCount: number;
  materializedPageCount: number;
  finalizedPageCount: number;
  finalizedRecordCount: number;
  stagingGeneration?: string;
  materializationOffsets?: Record<string, number>;
  lastRequestStartedAt: string | null;
  lastCheckpointAt: string | null;
  lastHeartbeatAt: string | null;
  spendFields?: string[];
  customFields?: string[];
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
  job.phase ??= job.state === 'complete' ? 'complete' : job.state === 'finalizing' ? 'indexing' : 'downloading';
  job.phasePercent ??= job.state === 'complete' ? 100 : 0;
  job.viewableCount ??= job.retrievedCount;
  job.materializedPageCount ??= job.pageCount;
  job.finalizedPageCount ??= 0;
  job.finalizedRecordCount ??= 0;
  job.lastRequestStartedAt ??= null;
  job.lastCheckpointAt ??= job.updatedAt;
  job.lastHeartbeatAt ??= job.updatedAt;
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
    retryAttempt: 0, phase: 'downloading', phasePercent: 0, viewableCount: 0, materializedPageCount: 0, finalizedPageCount: 0, finalizedRecordCount: 0,
    lastRequestStartedAt: null, lastCheckpointAt: now, lastHeartbeatAt: now, ...options,
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

export function readRetrievalPage<T>(job: RetrievalJob, sequence: number): SavedPage<T> | null {
  if (sequence < 1 || sequence > job.pageCount) return null;
  const page = readJsonSnapshot<SavedPage<T>>(pagePath(job.entityId, job.domain, job.id, sequence));
  return page?.sequence === sequence ? page : null;
}

/** Iterate one committed page at a time so callers never retain the full crawl. */
export function *iterateRetrievalPages<T>(job: RetrievalJob, startSequence = 1, endSequence = job.pageCount): Generator<SavedPage<T>> {
  const end = Math.min(job.pageCount, endSequence);
  for (let sequence = Math.max(1, startSequence); sequence <= end; sequence += 1) {
    const page = readRetrievalPage<T>(job, sequence);
    if (!page) throw new Error(`Retrieval page ${sequence} is missing or invalid.`);
    yield page;
  }
}

export function deleteRetrievalPages(job: RetrievalJob): void { rmSync(join(domainDirectory(job.entityId, job.domain), 'runs', job.id), { recursive: true, force: true }); }

async function waitWithHeartbeat(job: RetrievalJob, milliseconds: number): Promise<void> {
  if (process.env.VITEST) return;
  let remaining = milliseconds;
  while (remaining > 0) {
    const interval = Math.min(30_000, remaining);
    await new Promise((resolve) => setTimeout(resolve, interval));
    remaining -= interval;
    job.lastHeartbeatAt = new Date().toISOString();
    writeRetrievalJob(job);
  }
}

export const RETRIEVAL_STALL_MS = 180_000;

export function profilePageSignal(timeoutMs = 120_000): AbortSignal { return AbortSignal.timeout(timeoutMs); }

export function retrievalIsStalled(job: RetrievalJob, now = Date.now()): boolean {
  if (job.state !== 'running' && job.state !== 'retrying' && job.state !== 'finalizing') return false;
  const heartbeat = Date.parse(job.lastHeartbeatAt ?? job.updatedAt);
  return Number.isFinite(heartbeat) && now - heartbeat >= RETRIEVAL_STALL_MS;
}

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
      job.lastRequestStartedAt = new Date().toISOString();
      job.lastHeartbeatAt = job.lastRequestStartedAt;
      if (attempt) job.state = 'retrying';
      writeRetrievalJob(job);
      const result = await request(attempt);
      job.retryAttempt = 0;
      job.state = 'running';
      job.lastError = undefined;
      job.lastHeartbeatAt = new Date().toISOString();
      return result;
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === 4) break;
      const retryAfter = error instanceof UpstreamPageError ? error.retryAfterMs : undefined;
      const backoff = Math.min(30_000, 1_000 * 2 ** attempt) + Math.floor(Math.random() * 250);
      job.state = 'retrying';
      job.retryAttempt = attempt + 1;
      job.lastError = error instanceof Error ? error.message : String(error);
      job.lastHeartbeatAt = new Date().toISOString();
      writeRetrievalJob(job);
      await waitWithHeartbeat(job, retryAfter ?? backoff);
    }
  }
  throw lastError;
}
