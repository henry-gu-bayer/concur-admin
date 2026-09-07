import { existsSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import type { ActiveUserProfile, ActiveUserSortKey, ActiveUsersLocalQuery, ActiveUsersLocalResult } from './concurUsers';

const BROWSE_SORT_FIELDS: ActiveUserSortKey[] = ['id', 'name', 'preferredName', 'firstName', 'lastName', 'login', 'employee', 'email', 'active', 'costCenter', 'startDate'];

export type ActiveUsersBrowseState = 'missing' | 'running' | 'paused' | 'failed' | 'complete';

export interface ActiveUsersBrowseProgress {
  state: ActiveUsersBrowseState;
  sourceGeneration: string;
  browseGeneration?: string;
  phase?: 'rows' | 'sorting' | 'merging' | 'complete';
  percent: number;
  currentField?: string;
  startedAt?: string;
  updatedAt?: string;
  lastCheckpointAt?: string | null;
  error?: string;
}

interface BrowseManifest {
  format: 'active-users-browse-v1';
  entityId: string;
  sourceGeneration: string;
  generation: string;
  createdAt: string;
  count: number;
  pageSize: number;
  sortFields: ActiveUserSortKey[];
  rows?: { bytes: number; sha256: string };
  orders?: Partial<Record<ActiveUserSortKey, { pageCount: number; count: number; pageHashes: string[] }>>;
}

interface BrowseJob extends ActiveUsersBrowseProgress {
  format: 'active-users-browse-job-v1';
  runId: string;
}

const activeWorkers = new Map<string, { worker: Worker; promise: Promise<BrowseManifest> }>();

function generationDirectory(baseDirectory: string, generation: string): string { return join(baseDirectory, 'generations', generation); }
function browseDirectory(baseDirectory: string, generation: string): string { return join(generationDirectory(baseDirectory, generation), 'browse'); }
function browseJobPath(baseDirectory: string, generation: string): string { return join(browseDirectory(baseDirectory, generation), 'job.json'); }
function browseCurrentPath(baseDirectory: string, generation: string): string { return join(browseDirectory(baseDirectory, generation), 'current.json'); }
function browseRunDirectory(baseDirectory: string, generation: string, runId: string): string { return join(browseDirectory(baseDirectory, generation), 'generations', runId); }

function readBrowseManifest(baseDirectory: string, generation: string): BrowseManifest | null {
  const current = readJsonSnapshot<{ generation?: string }>(browseCurrentPath(baseDirectory, generation));
  if (!current?.generation) return null;
  const manifest = readJsonSnapshot<BrowseManifest>(join(browseRunDirectory(baseDirectory, generation, current.generation), 'manifest.json'));
  if (!manifest || manifest.format !== 'active-users-browse-v1' || manifest.sourceGeneration !== generation
    || !manifest.rows?.sha256 || !manifest.orders
    || manifest.sortFields.some((field) => {
      const order = manifest.orders?.[field];
      return !order || order.count !== manifest.count || order.pageCount !== Math.ceil(manifest.count / manifest.pageSize) || order.pageHashes.length !== order.pageCount;
    })) return null;
  return manifest;
}

function workerKey(baseDirectory: string, generation: string): string { return `${baseDirectory}\0${generation}`; }

function readJob(baseDirectory: string, generation: string): BrowseJob | null {
  return readJsonSnapshot<BrowseJob>(browseJobPath(baseDirectory, generation));
}

function toPublicProgress(job: BrowseJob): ActiveUsersBrowseProgress {
  return {
    state: job.state,
    sourceGeneration: job.sourceGeneration,
    browseGeneration: job.browseGeneration,
    phase: job.phase,
    percent: job.percent,
    currentField: job.currentField,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    lastCheckpointAt: job.lastCheckpointAt,
    error: job.error,
  };
}

function publicProgress(baseDirectory: string, generation: string): ActiveUsersBrowseProgress {
  const manifest = readBrowseManifest(baseDirectory, generation);
  if (manifest) return { state: 'complete', sourceGeneration: generation, browseGeneration: manifest.generation, phase: 'complete', percent: 100, updatedAt: manifest.createdAt };
  const job = readJob(baseDirectory, generation);
  if (!job) return { state: 'missing', sourceGeneration: generation, percent: 0 };
  if (job.state === 'complete') return { state: 'missing', sourceGeneration: generation, percent: 0 };
  const key = workerKey(baseDirectory, generation);
  if (job.state === 'running' && !activeWorkers.has(key)) {
    const paused = { ...job, state: 'paused' as const, error: 'Local browse indexing was interrupted when the server stopped. Resume to continue.' };
    writeJsonSnapshot(browseJobPath(baseDirectory, generation), paused);
    return toPublicProgress(paused);
  }
  return toPublicProgress(job);
}

function startWorker(baseDirectory: string, entityId: string, generation: string, onProgress?: (progress: ActiveUsersBrowseProgress) => void): Promise<BrowseManifest> {
  const key = workerKey(baseDirectory, generation);
  const pending = activeWorkers.get(key);
  if (pending) return pending.promise;
  const existing = readJob(baseDirectory, generation);
  const runId = existing && existing.state !== 'complete' ? existing.runId : `${Date.now()}-${randomUUID()}`;
  const worker = new Worker(join(process.cwd(), 'server', 'activeUsersBrowseWorker.mjs'), {
    workerData: { baseDirectory, entityId, generation, runId, sortFields: BROWSE_SORT_FIELDS },
  });
  const promise = new Promise<BrowseManifest>((resolve, reject) => {
    worker.on('message', (message: { type?: string; job?: ActiveUsersBrowseProgress; manifest?: BrowseManifest; error?: string }) => {
      if (message.type === 'progress' && message.job) onProgress?.(message.job);
      if (message.type === 'done' && message.manifest) resolve(message.manifest);
      if (message.type === 'error') reject(new Error(message.error ?? 'Local browse indexing failed.'));
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      activeWorkers.delete(key);
      if (code !== 0) reject(new Error(`Local browse index worker exited with code ${code}.`));
    });
  });
  activeWorkers.set(key, { worker, promise });
  return promise;
}

export function ensureActiveUsersBrowseIndex(baseDirectory: string, entityId: string, generation: string): ActiveUsersBrowseProgress {
  const current = publicProgress(baseDirectory, generation);
  if (current.state === 'complete' || current.state === 'running' || current.state === 'paused' || current.state === 'failed') return current;
  void startWorker(baseDirectory, entityId, generation).catch(() => undefined);
  const started = readJob(baseDirectory, generation);
  return started && started.state !== 'complete' ? toPublicProgress(started) : { state: 'running', sourceGeneration: generation, percent: 0, phase: 'rows' };
}

export function getActiveUsersBrowseProgress(baseDirectory: string, generation: string): ActiveUsersBrowseProgress {
  return publicProgress(baseDirectory, generation);
}

export function resumeActiveUsersBrowseIndex(baseDirectory: string, entityId: string, generation: string): ActiveUsersBrowseProgress {
  const manifest = readBrowseManifest(baseDirectory, generation);
  if (manifest) return publicProgress(baseDirectory, generation);
  void startWorker(baseDirectory, entityId, generation).catch(() => undefined);
  const started = readJob(baseDirectory, generation);
  return started && started.state !== 'complete' ? toPublicProgress(started) : { state: 'running', sourceGeneration: generation, percent: 0 };
}

export async function buildActiveUsersBrowseIndex(
  baseDirectory: string,
  entityId: string,
  generation: string,
  onProgress?: (progress: ActiveUsersBrowseProgress) => void,
): Promise<BrowseManifest> {
  const manifest = readBrowseManifest(baseDirectory, generation);
  if (manifest) return manifest;
  return startWorker(baseDirectory, entityId, generation, onProgress);
}

function readPointers(baseDirectory: string, generation: string, manifest: BrowseManifest, query: ActiveUsersLocalQuery): Array<[number, number]> {
  const count = manifest.count;
  const offset = Math.min(query.offset, count);
  const end = Math.min(count, offset + query.limit);
  if (offset >= end) return [];
  const ascendingStart = query.sortDir === 'asc' ? offset : count - end;
  const ascendingEnd = query.sortDir === 'asc' ? end : count - offset;
  const pointers: Array<[number, number]> = [];
  const orderDirectory = join(browseRunDirectory(baseDirectory, generation, manifest.generation), 'orders', encodeURIComponent(query.sortBy));
  const firstPage = Math.floor(ascendingStart / manifest.pageSize);
  const lastPage = Math.floor((ascendingEnd - 1) / manifest.pageSize);
  for (let page = firstPage; page <= lastPage; page += 1) {
    const file = join(orderDirectory, `${String(page).padStart(6, '0')}.json`);
    const values = readJsonSnapshot<Array<[number, number]>>(file);
    if (!values) throw new Error(`The local User Profiles browse index is incomplete: ${file}.`);
    const expectedHash = manifest.orders?.[query.sortBy]?.pageHashes[page];
    if (expectedHash && createHash('sha256').update(JSON.stringify(values)).digest('hex') !== expectedHash) throw new Error(`The local User Profiles browse index checksum failed: ${file}.`);
    const pageStart = page * manifest.pageSize;
    const from = Math.max(0, ascendingStart - pageStart);
    const to = Math.min(values.length, ascendingEnd - pageStart);
    pointers.push(...values.slice(from, to));
  }
  if (pointers.length !== ascendingEnd - ascendingStart) throw new Error(`The local User Profiles browse index returned ${pointers.length} row pointers; expected ${ascendingEnd - ascendingStart}.`);
  return query.sortDir === 'asc' ? pointers : pointers.reverse();
}

function readRows(file: string, pointers: Array<[number, number]>): ActiveUserProfile[] {
  if (!pointers.length) return [];
  const size = statSync(file).size;
  const descriptor = openSync(file, 'r');
  try {
    return pointers.map(([offset, length]) => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || offset + length > size) throw new Error('The local User Profiles browse index contains an invalid row pointer.');
      const buffer = Buffer.allocUnsafe(length);
      const bytes = readSync(descriptor, buffer, 0, length, offset);
      if (bytes !== length) throw new Error('The local User Profiles browse row could not be read completely.');
      return JSON.parse(buffer.subarray(0, bytes).toString('utf8').trim()) as ActiveUserProfile;
    });
  } finally {
    closeSync(descriptor);
  }
}

export function queryActiveUsersBrowse(baseDirectory: string, generation: string, query: ActiveUsersLocalQuery): ActiveUsersLocalResult | null {
  if ((query.q ?? '').trim() || query.filters?.items.length) return null;
  const manifest = readBrowseManifest(baseDirectory, generation);
  if (!manifest || !manifest.sortFields.includes(query.sortBy)) return null;
  const offset = Math.min(query.offset, manifest.count);
  const pointers = readPointers(baseDirectory, generation, manifest, query);
  const rows = readRows(join(browseRunDirectory(baseDirectory, generation, manifest.generation), 'rows.ndjson'), pointers);
  const source = readJsonSnapshot<{ retrievedAt?: string }>(join(generationDirectory(baseDirectory, generation), 'manifest.json'));
  return {
    users: rows, total: manifest.count, snapshotCount: manifest.count, retrievedAt: source?.retrievedAt ?? manifest.createdAt,
    offset, limit: query.limit, hasMore: offset + query.limit < manifest.count, complete: true,
    sourceGeneration: generation, provisional: false, orderingReady: true,
  };
}

export function readProvisionalActiveUsers(baseDirectory: string, generation: string, offset: number, limit: number): ActiveUserProfile[] {
  const rows: ActiveUserProfile[] = [];
  let skipped = 0;
  const shardDirectory = join(generationDirectory(baseDirectory, generation), 'shards');
  const names = readdirSync(shardDirectory).filter((name) => name.endsWith('.ndjson')).sort();
  for (const name of names) {
    const lines = readFileSync(join(shardDirectory, name), 'utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      if (skipped < offset) { skipped += 1; continue; }
      rows.push(JSON.parse(line) as ActiveUserProfile);
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}

export function canUseProvisionalActiveUsers(query: ActiveUsersLocalQuery): boolean {
  return query.offset === 0 && !(query.q ?? '').trim() && !query.filters?.items.length && query.sortBy === 'name' && query.sortDir === 'asc';
}

export function activeUsersBrowseIndexExists(baseDirectory: string, generation: string): boolean {
  return existsSync(browseCurrentPath(baseDirectory, generation)) && Boolean(readBrowseManifest(baseDirectory, generation));
}

export function activeUsersBrowseGenerationsInProgress(baseDirectory: string): string[] {
  const directory = join(baseDirectory, 'generations');
  let generations: string[];
  try { generations = readdirSync(directory); } catch { return []; }
  return generations.filter((generation) => {
    const job = readJob(baseDirectory, generation);
    return Boolean(job && job.state !== 'complete');
  });
}
