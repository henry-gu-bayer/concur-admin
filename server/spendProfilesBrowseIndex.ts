import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { readShardedManifest } from './shardedIdentitySnapshot';
import type { SpendProfileRow, SpendProfilesQuery, SpendProfilesQueryResult } from './concurSpendProfiles';

const INTERNAL_FIELDS = new Set(['identityPresent']);

export type SpendProfilesBrowseState = 'missing' | 'running' | 'paused' | 'failed' | 'complete';
export type SpendProfilesBrowsePhase = 'rows' | 'sorting' | 'merging' | 'complete';

export interface SpendProfilesBrowseProgress {
  state: SpendProfilesBrowseState;
  sourceGeneration: string;
  browseGeneration?: string;
  phase?: SpendProfilesBrowsePhase;
  percent: number;
  currentField?: string;
  startedAt?: string;
  updatedAt?: string;
  lastCheckpointAt?: string | null;
  error?: string;
}

interface OrderManifest {
  pageCount: number;
  count: number;
  pageHashes: string[];
  presentCounts: number[];
}

interface BrowseManifest {
  format: 'spend-profiles-browse-v1';
  entityId: string;
  sourceGeneration: string;
  generation: string;
  createdAt: string;
  count: number;
  presentCount: number;
  pageSize: number;
  sortFields: string[];
  rows?: { bytes: number; sha256: string };
  orders?: Record<string, OrderManifest>;
}

interface BrowseJob extends SpendProfilesBrowseProgress {
  format: 'spend-profiles-browse-job-v1';
  runId: string;
}

interface IndexEntry { id: string; value: string }
type BrowsePointer = [number, number, number];

const activeWorkers = new Map<string, { worker: Worker; promise: Promise<BrowseManifest> }>();

function generationDirectory(baseDirectory: string, generation: string): string { return join(baseDirectory, 'generations', generation); }
function browseDirectory(baseDirectory: string, generation: string): string { return join(generationDirectory(baseDirectory, generation), 'browse'); }
function browseJobPath(baseDirectory: string, generation: string): string { return join(browseDirectory(baseDirectory, generation), 'job.json'); }
function browseCurrentPath(baseDirectory: string, generation: string): string { return join(browseDirectory(baseDirectory, generation), 'current.json'); }
function browseRunDirectory(baseDirectory: string, generation: string, runId: string): string { return join(browseDirectory(baseDirectory, generation), 'generations', runId); }
function workerKey(baseDirectory: string, generation: string): string { return `${baseDirectory}\0${generation}`; }

function sourceSortFields(baseDirectory: string, generation: string): string[] {
  const manifest = readShardedManifest(baseDirectory, generation);
  if (!manifest) return [];
  return manifest.fields.filter((field) => !INTERNAL_FIELDS.has(field));
}

function readBrowseManifest(baseDirectory: string, generation: string): BrowseManifest | null {
  const current = readJsonSnapshot<{ generation?: string }>(browseCurrentPath(baseDirectory, generation));
  if (!current?.generation) return null;
  const manifest = readJsonSnapshot<BrowseManifest>(join(browseRunDirectory(baseDirectory, generation, current.generation), 'manifest.json'));
  if (!manifest || manifest.format !== 'spend-profiles-browse-v1' || manifest.sourceGeneration !== generation
    || !manifest.rows?.sha256 || !manifest.orders || manifest.presentCount < 0 || manifest.presentCount > manifest.count
    || manifest.sortFields.some((field) => {
      const order = manifest.orders?.[field];
      return !order || order.count !== manifest.count
        || order.pageCount !== Math.ceil(manifest.count / manifest.pageSize)
        || order.pageHashes.length !== order.pageCount || order.presentCounts.length !== order.pageCount
        || order.presentCounts.reduce((sum, count) => sum + count, 0) !== manifest.presentCount;
    })) return null;
  return manifest;
}

function readJob(baseDirectory: string, generation: string): BrowseJob | null {
  return readJsonSnapshot<BrowseJob>(browseJobPath(baseDirectory, generation));
}

function toPublicProgress(job: BrowseJob): SpendProfilesBrowseProgress {
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

function publicProgress(baseDirectory: string, generation: string): SpendProfilesBrowseProgress {
  const manifest = readBrowseManifest(baseDirectory, generation);
  if (manifest) return { state: 'complete', sourceGeneration: generation, browseGeneration: manifest.generation, phase: 'complete', percent: 100, updatedAt: manifest.createdAt };
  const job = readJob(baseDirectory, generation);
  if (!job) return { state: 'missing', sourceGeneration: generation, percent: 0 };
  if (job.state === 'complete') return { state: 'missing', sourceGeneration: generation, percent: 0 };
  if (job.state === 'running' && !activeWorkers.has(workerKey(baseDirectory, generation))) {
    const paused = { ...job, state: 'paused' as const, error: 'Local Spend Profile browse indexing was interrupted when the server stopped. Resume to continue.' };
    writeJsonSnapshot(browseJobPath(baseDirectory, generation), paused);
    return toPublicProgress(paused);
  }
  return toPublicProgress(job);
}

function startWorker(baseDirectory: string, entityId: string, generation: string, onProgress?: (progress: SpendProfilesBrowseProgress) => void): Promise<BrowseManifest> {
  const key = workerKey(baseDirectory, generation);
  const pending = activeWorkers.get(key);
  if (pending) return pending.promise;
  const sortFields = sourceSortFields(baseDirectory, generation);
  if (!sortFields.length) return Promise.reject(new Error('The Spend Profiles snapshot has no fields available for browsing.'));
  const existing = readJob(baseDirectory, generation);
  const runId = existing && existing.state !== 'complete' ? existing.runId : `${Date.now()}-${randomUUID()}`;
  const worker = new Worker(join(process.cwd(), 'server', 'spendProfilesBrowseWorker.mjs'), {
    workerData: { baseDirectory, entityId, generation, runId, sortFields },
  });
  const promise = new Promise<BrowseManifest>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    worker.on('message', (message: { type?: string; job?: SpendProfilesBrowseProgress; manifest?: BrowseManifest; error?: string }) => {
      if (message.type === 'progress' && message.job) onProgress?.(message.job);
      if (message.type === 'done' && message.manifest) finish(() => resolve(message.manifest!));
      if (message.type === 'error') finish(() => reject(new Error(message.error ?? 'Local Spend Profile browse indexing failed.')));
    });
    worker.on('error', (error) => finish(() => reject(error)));
    worker.on('exit', (code) => {
      activeWorkers.delete(key);
      if (code !== 0) finish(() => reject(new Error(`Local Spend Profile browse index worker exited with code ${code}.`)));
    });
  });
  activeWorkers.set(key, { worker, promise });
  return promise;
}

export function ensureSpendProfilesBrowseIndex(baseDirectory: string, entityId: string, generation: string): SpendProfilesBrowseProgress {
  const current = publicProgress(baseDirectory, generation);
  if (current.state !== 'missing') return current;
  void startWorker(baseDirectory, entityId, generation).catch(() => undefined);
  const started = readJob(baseDirectory, generation);
  return started && started.state !== 'complete' ? toPublicProgress(started) : { state: 'running', sourceGeneration: generation, percent: 0, phase: 'rows' };
}

export function getSpendProfilesBrowseProgress(baseDirectory: string, generation: string): SpendProfilesBrowseProgress {
  return publicProgress(baseDirectory, generation);
}

export function resumeSpendProfilesBrowseIndex(baseDirectory: string, entityId: string, generation: string): SpendProfilesBrowseProgress {
  const manifest = readBrowseManifest(baseDirectory, generation);
  if (manifest) return publicProgress(baseDirectory, generation);
  void startWorker(baseDirectory, entityId, generation).catch(() => undefined);
  const started = readJob(baseDirectory, generation);
  return started && started.state !== 'complete' ? toPublicProgress(started) : { state: 'running', sourceGeneration: generation, percent: 0, phase: 'rows' };
}

export async function buildSpendProfilesBrowseIndex(
  baseDirectory: string,
  entityId: string,
  generation: string,
  onProgress?: (progress: SpendProfilesBrowseProgress) => void,
): Promise<BrowseManifest> {
  const manifest = readBrowseManifest(baseDirectory, generation);
  if (manifest) return manifest;
  return startWorker(baseDirectory, entityId, generation, onProgress);
}

export async function stopSupersededSpendProfilesBrowseWorkers(baseDirectory: string, keepGeneration: string): Promise<void> {
  const prefix = `${baseDirectory}\0`;
  const stops: Promise<number>[] = [];
  for (const [key, active] of activeWorkers) {
    if (!key.startsWith(prefix) || key === workerKey(baseDirectory, keepGeneration)) continue;
    activeWorkers.delete(key);
    stops.push(active.worker.terminate());
  }
  await Promise.all(stops);
}

function readOrderPage(baseDirectory: string, generation: string, manifest: BrowseManifest, field: string, page: number): BrowsePointer[] {
  const file = join(browseRunDirectory(baseDirectory, generation, manifest.generation), 'orders', encodeURIComponent(field), `${String(page).padStart(6, '0')}.json`);
  const values = readJsonSnapshot<BrowsePointer[]>(file);
  if (!values) throw new Error(`The local Spend Profiles browse index is incomplete: ${file}.`);
  const expectedHash = manifest.orders?.[field]?.pageHashes[page];
  if (!expectedHash || createHash('sha256').update(JSON.stringify(values)).digest('hex') !== expectedHash) throw new Error(`The local Spend Profiles browse index checksum failed: ${file}.`);
  return values;
}

function readPointers(baseDirectory: string, generation: string, manifest: BrowseManifest, query: SpendProfilesQuery): { pointers: Array<[number, number]>; total: number; offset: number } {
  const order = manifest.orders?.[query.sortBy];
  if (!order) return { pointers: [], total: 0, offset: 0 };
  const total = query.includeOrphans ? manifest.count : manifest.presentCount;
  const offset = Math.min(query.offset, total);
  const end = Math.min(total, offset + query.limit);
  if (offset >= end) return { pointers: [], total, offset };
  const ascendingStart = query.sortDir === 'asc' ? offset : total - end;
  const ascendingEnd = query.sortDir === 'asc' ? end : total - offset;
  const pointers: Array<[number, number]> = [];
  let logicalStart = 0;
  for (let page = 0; page < order.pageCount && logicalStart < ascendingEnd; page += 1) {
    const pageCount = query.includeOrphans ? Math.min(manifest.pageSize, manifest.count - page * manifest.pageSize) : order.presentCounts[page];
    const logicalEnd = logicalStart + pageCount;
    if (logicalEnd > ascendingStart && logicalStart < ascendingEnd) {
      const values = readOrderPage(baseDirectory, generation, manifest, query.sortBy, page);
      const eligible = query.includeOrphans ? values : values.filter((pointer) => pointer[2] === 1);
      const from = Math.max(0, ascendingStart - logicalStart);
      const to = Math.min(eligible.length, ascendingEnd - logicalStart);
      pointers.push(...eligible.slice(from, to).map(([rowOffset, length]) => [rowOffset, length] as [number, number]));
    }
    logicalStart = logicalEnd;
  }
  if (pointers.length !== ascendingEnd - ascendingStart) throw new Error(`The local Spend Profiles browse index returned ${pointers.length} row pointers; expected ${ascendingEnd - ascendingStart}.`);
  return { pointers: query.sortDir === 'asc' ? pointers : pointers.reverse(), total, offset };
}

function readRows(file: string, pointers: Array<[number, number]>): SpendProfileRow[] {
  if (!pointers.length) return [];
  const size = statSync(file).size;
  const descriptor = openSync(file, 'r');
  try {
    return pointers.map(([offset, length]) => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || offset + length > size) throw new Error('The local Spend Profiles browse index contains an invalid row pointer.');
      const buffer = Buffer.allocUnsafe(length);
      const bytes = readSync(descriptor, buffer, 0, length, offset);
      if (bytes !== length) throw new Error('The local Spend Profiles browse row could not be read completely.');
      return JSON.parse(buffer.subarray(0, bytes).toString('utf8').trim()) as SpendProfileRow;
    });
  } finally {
    closeSync(descriptor);
  }
}

export function querySpendProfilesBrowse(baseDirectory: string, generation: string, query: SpendProfilesQuery): SpendProfilesQueryResult | null {
  if (query.filters.items.length) return null;
  const manifest = readBrowseManifest(baseDirectory, generation);
  if (!manifest || !manifest.sortFields.includes(query.sortBy)) return null;
  const selection = readPointers(baseDirectory, generation, manifest, query);
  const rows = readRows(join(browseRunDirectory(baseDirectory, generation, manifest.generation), 'rows.ndjson'), selection.pointers);
  const source = readJsonSnapshot<{ retrievedAt?: string }>(join(generationDirectory(baseDirectory, generation), 'manifest.json'));
  return {
    rows, total: selection.total, snapshotCount: manifest.count, retrievedAt: source?.retrievedAt ?? manifest.createdAt,
    offset: selection.offset, limit: query.limit, hasMore: selection.offset + query.limit < selection.total, complete: true,
    sourceGeneration: generation, provisional: false, orderingReady: true,
  };
}

function readIndexPrefix(file: string, limit: number): IndexEntry[] {
  if (!existsSync(file) || limit <= 0) return [];
  const descriptor = openSync(file, 'r');
  const entries: IndexEntry[] = [];
  let remainder = '';
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (entries.length < limit) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytes) break;
      const text = remainder + buffer.subarray(0, bytes).toString('utf8');
      const lines = text.split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        entries.push(JSON.parse(line) as IndexEntry);
        if (entries.length >= limit) break;
      }
    }
    if (entries.length < limit && remainder) entries.push(JSON.parse(remainder) as IndexEntry);
  } finally {
    closeSync(descriptor);
  }
  return entries.slice(0, limit);
}

function provisionalSourceCount(identityFile: string, limit: number, includeOrphans: boolean): { identity: IndexEntry[]; sourceCount: number; selected: number[] } {
  let target = Math.max(limit, 256);
  for (;;) {
    const identity = readIndexPrefix(identityFile, target);
    const selected: number[] = [];
    for (let index = 0; index < identity.length && selected.length < limit; index += 1) {
      if (includeOrphans || identity[index].value === 'true') selected.push(index);
    }
    if (selected.length >= limit || identity.length < target) return { identity, sourceCount: identity.length, selected };
    target *= 2;
  }
}

export function readProvisionalSpendProfiles(baseDirectory: string, generation: string, query: SpendProfilesQuery): SpendProfilesQueryResult {
  const manifest = readShardedManifest(baseDirectory, generation);
  if (!manifest) throw new Error('No Spend Profiles snapshot is available.');
  const indexes = join(generationDirectory(baseDirectory, generation), 'indexes');
  const { identity, sourceCount, selected } = provisionalSourceCount(join(indexes, `${encodeURIComponent('identityPresent')}.ndjson`), query.limit, query.includeOrphans);
  const valuesByField = new Map<string, IndexEntry[]>();
  for (const field of manifest.fields) {
    const entries = field === 'identityPresent' ? identity : readIndexPrefix(join(indexes, `${encodeURIComponent(field)}.ndjson`), sourceCount);
    if (entries.length !== sourceCount) throw new Error(`The local Spend Profiles index ${field} ended before the provisional page.`);
    valuesByField.set(field, entries);
  }
  const rows = selected.map((index) => {
    const id = valuesByField.get('id')?.[index]?.id ?? identity[index]?.id;
    const values = Object.fromEntries(manifest.fields.map((field) => {
      const entry = valuesByField.get(field)?.[index];
      if (!entry || entry.id !== id) throw new Error(`The local Spend Profiles index ${field} is not aligned with the provisional page.`);
      return [field, entry.value];
    }));
    return { id, loginId: values.loginId ?? '', employeeNumber: values.employeeNumber ?? '', email: values.email ?? '', preferredName: values.preferredName ?? '', values };
  });
  return {
    rows, total: manifest.count, snapshotCount: manifest.count, retrievedAt: manifest.retrievedAt,
    offset: 0, limit: query.limit, hasMore: false,
    complete: true, sourceGeneration: generation, provisional: true, orderingReady: false,
  };
}

export function canUseProvisionalSpendProfiles(query: SpendProfilesQuery): boolean {
  return query.offset === 0 && !query.filters.items.length && query.sortBy === 'loginId' && query.sortDir === 'asc';
}

export function spendProfilesBrowseIndexExists(baseDirectory: string, generation: string): boolean {
  return existsSync(browseCurrentPath(baseDirectory, generation)) && Boolean(readBrowseManifest(baseDirectory, generation));
}

export function spendProfilesBrowseGenerationsInProgress(baseDirectory: string): string[] {
  const directory = join(baseDirectory, 'generations');
  let generations: string[];
  try { generations = readdirSync(directory); } catch { return []; }
  return generations.filter((generation) => {
    const job = readJob(baseDirectory, generation);
    return Boolean(job && job.state !== 'complete');
  });
}
