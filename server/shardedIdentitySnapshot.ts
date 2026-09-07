import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, truncateSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';

export const IDENTITY_SHARD_COUNT = 256;

/**
 * A generation without a manifest is either debris from a crashed retrieval or
 * an in-flight write by another process, and the two are indistinguishable from
 * the outside. Leaving such a directory alone for a day keeps pruning from ever
 * destroying a long-running crawl.
 */
const ORPHAN_GENERATION_GRACE_MS = 24 * 60 * 60 * 1000;

export interface ShardedSnapshotManifest {
  format: 'concur-sharded-identity-v1';
  entityId: string;
  generation: string;
  retrievedAt: string;
  count: number;
  pageCount: number;
  shardCount: number;
  fields: string[];
  identityGeneration?: string;
  spendFields?: string[];
  customFields?: string[];
}

interface CurrentGeneration { generation: string }
interface IndexEntry { id: string; value: string }

function shardFor(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 2);
}

function rootDirectory(baseDirectory: string): string { return baseDirectory; }
function generationDirectory(baseDirectory: string, generation: string): string { return join(rootDirectory(baseDirectory), 'generations', generation); }
function currentPath(baseDirectory: string): string { return join(rootDirectory(baseDirectory), 'current.json'); }
function manifestPath(baseDirectory: string, generation: string): string { return join(generationDirectory(baseDirectory, generation), 'manifest.json'); }
function shardPath(baseDirectory: string, generation: string, shard: string): string { return join(generationDirectory(baseDirectory, generation), 'shards', `${shard}.ndjson`); }
function indexPath(baseDirectory: string, generation: string, field: string): string { return join(generationDirectory(baseDirectory, generation), 'indexes', `${encodeURIComponent(field)}.ndjson`); }

function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);
  } catch (error) {
    throw new CorruptSnapshotError(file, error);
  }
}

/**
 * A writer keeps records and column indexes on disk while pages arrive, writing
 * them straight into their final generation directory. That is safe because
 * `current.json` is the only commit point: a generation no pointer references is
 * invisible to every reader. An earlier design staged the records under a
 * sibling directory and renamed it into place on finalize, but Windows refuses
 * to rename a directory while any process holds a handle on it or on a
 * descendant, so a file watcher or virus scanner inspecting the just-written
 * files made the last step of a long retrieval fail with EPERM and threw the
 * whole crawl away.
 */
export class ShardedSnapshotWriter<T extends { id: string }> {
  readonly generation: string;
  private readonly directory: string;
  private count = 0;

  constructor(private readonly baseDirectory: string, private readonly entityId: string, private readonly fields: string[], private readonly valuesFor: (record: T) => Record<string, string>, resume?: { generation: string; count: number }) {
    this.generation = resume?.generation ?? `${Date.now()}-${randomUUID()}`;
    this.count = resume?.count ?? 0;
    this.directory = generationDirectory(baseDirectory, this.generation);
    mkdirSync(join(this.directory, 'shards'), { recursive: true });
    mkdirSync(join(this.directory, 'indexes'), { recursive: true });
  }

  /**
   * The job checkpoint is the commit record for a materialization batch. On
   * Resume, bytes written after that checkpoint are truncated before the batch
   * is replayed. Files first touched by the interrupted batch are removed.
   */
  restoreOffsets(offsets: Record<string, number>): void {
    for (const folder of ['shards', 'indexes']) {
      const directory = join(this.directory, folder);
      for (const name of readdirSync(directory)) {
        const file = join(directory, name);
        const key = `${folder}/${name}`;
        const committedSize = offsets[key];
        if (committedSize === undefined) rmSync(file, { force: true });
        else {
          if (statSync(file).size < committedSize) throw new Error(`Staging file ${key} is shorter than its retrieval checkpoint.`);
          truncateSync(file, committedSize);
        }
      }
    }
    for (const [key, committedSize] of Object.entries(offsets)) {
      if (committedSize > 0 && !existsSync(join(this.directory, key))) throw new Error(`Staging file ${key} is missing from its retrieval checkpoint.`);
    }
  }

  captureOffsets(): Record<string, number> {
    const offsets: Record<string, number> = {};
    for (const folder of ['shards', 'indexes']) {
      const directory = join(this.directory, folder);
      for (const name of readdirSync(directory)) offsets[`${folder}/${name}`] = statSync(join(directory, name)).size;
    }
    return offsets;
  }

  append(records: T[]): void {
    const chunks = this.chunksFor(records);
    for (const [file, chunk] of chunks) appendFileSync(file, chunk, 'utf-8');
  }

  /** Write one bounded batch with limited parallel file I/O and yield the event loop. */
  async appendAsync(records: T[], concurrency = 8): Promise<void> {
    const entries = [...this.chunksFor(records)];
    for (let index = 0; index < entries.length; index += concurrency) {
      await Promise.all(entries.slice(index, index + concurrency).map(([file, chunk]) => appendFile(file, chunk, 'utf-8')));
    }
  }

  private chunksFor(records: T[]): Map<string, string> {
    const chunks = new Map<string, string[]>();
    const push = (file: string, line: string) => {
      const lines = chunks.get(file);
      if (lines) lines.push(line); else chunks.set(file, [line]);
    };
    for (const record of records) {
      if (!record.id) continue;
      push(shardPath(this.baseDirectory, this.generation, shardFor(record.id)), `${JSON.stringify(record)}\n`);
      const values = this.valuesFor(record);
      for (const field of this.fields) {
        push(indexPath(this.baseDirectory, this.generation, field), `${JSON.stringify({ id: record.id, value: values[field] ?? '' })}\n`);
      }
      this.count += 1;
    }
    return new Map([...chunks].map(([file, lines]) => [file, lines.join('')]));
  }

  prepare(retrievedAt: string, pageCount: number, metadata: Pick<ShardedSnapshotManifest, 'identityGeneration' | 'spendFields' | 'customFields'> = {}): ShardedSnapshotManifest {
    const manifest: ShardedSnapshotManifest = {
      format: 'concur-sharded-identity-v1', entityId: this.entityId, generation: this.generation,
      retrievedAt, count: this.count, pageCount, shardCount: IDENTITY_SHARD_COUNT, fields: this.fields, ...metadata,
    };
    // The manifest has to land before the pointer: readShardedManifest reports a
    // pointer to a generation without a manifest as a corrupt snapshot.
    writeJsonSnapshot(manifestPath(this.baseDirectory, this.generation), manifest);
    return manifest;
  }

  commit(): void {
    writeJsonSnapshot(currentPath(this.baseDirectory), { generation: this.generation } satisfies CurrentGeneration);
  }

  finalize(retrievedAt: string, pageCount: number, metadata: Pick<ShardedSnapshotManifest, 'identityGeneration' | 'spendFields' | 'customFields'> = {}): ShardedSnapshotManifest {
    const manifest = this.prepare(retrievedAt, pageCount, metadata);
    this.commit();
    return manifest;
  }

  discard(): void { rmSync(this.directory, { recursive: true, force: true }); }
}

export function discardShardedGeneration(baseDirectory: string, generation: string | undefined): void {
  if (generation) rmSync(generationDirectory(baseDirectory, generation), { recursive: true, force: true });
}

async function lineCount(file: string): Promise<number> {
  if (!existsSync(file)) return 0;
  let count = 0;
  for await (const chunk of createReadStream(file)) {
    const bytes = chunk as Buffer;
    for (let index = 0; index < bytes.length; index += 1) if (bytes[index] === 10) count += 1;
  }
  return count;
}

/** Validate output cardinality without loading a shard or field index into memory. */
export async function validateShardedGeneration(baseDirectory: string, generation: string, fields: string[], expectedCount: number, progress?: (completed: number, total: number) => void): Promise<void> {
  const totalFiles = IDENTITY_SHARD_COUNT + fields.length;
  let completed = 0;
  let shardRecords = 0;
  for (let index = 0; index < IDENTITY_SHARD_COUNT; index += 1) {
    const shard = index.toString(16).padStart(2, '0');
    shardRecords += await lineCount(shardPath(baseDirectory, generation, shard));
    completed += 1;
    progress?.(completed, totalFiles);
  }
  if (shardRecords !== expectedCount) throw new Error(`Staging shards contain ${shardRecords} records; expected ${expectedCount}.`);
  for (const field of fields) {
    const entries = await lineCount(indexPath(baseDirectory, generation, field));
    if (entries !== expectedCount) throw new Error(`Staging index ${field} contains ${entries} entries; expected ${expectedCount}.`);
    completed += 1;
    progress?.(completed, totalFiles);
  }
}

/**
 * A superseded generation is dead weight: 256 shard files plus its indexes. Only
 * the caller can decide what is superseded, because a generation stays live for
 * as long as some other snapshot pins it, so the retention set is passed in.
 */
export function pruneGenerations(baseDirectory: string, keepGenerations: Iterable<string>): void {
  const keep = new Set(keepGenerations);
  const directory = join(rootDirectory(baseDirectory), 'generations');
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (keep.has(entry)) continue;
    const candidate = join(directory, entry);
    try {
      if (!existsSync(join(candidate, 'manifest.json')) && Date.now() - statSync(candidate).mtimeMs < ORPHAN_GENERATION_GRACE_MS) continue;
      rmSync(candidate, { recursive: true, force: true });
    } catch (error) {
      // A directory a watcher still holds open must never fail the commit; the
      // next successful retrieval collects it.
      console.warn(`[concur:snapshot] could not remove superseded generation ${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function readShardedManifest(baseDirectory: string, generation?: string): ShardedSnapshotManifest | null {
  const current = generation ? { generation } : readJsonSnapshot<CurrentGeneration>(currentPath(baseDirectory));
  if (!current?.generation) return null;
  const file = manifestPath(baseDirectory, current.generation);
  const manifest = readJsonSnapshot<ShardedSnapshotManifest>(file);
  if (!manifest || manifest.format !== 'concur-sharded-identity-v1' || manifest.generation !== current.generation || manifest.shardCount !== IDENTITY_SHARD_COUNT) {
    throw new CorruptSnapshotError(file, new Error('Snapshot manifest is invalid'));
  }
  return manifest;
}

export function readShardedRecord<T extends { id: string }>(baseDirectory: string, id: string, generation?: string): T | null {
  const manifest = readShardedManifest(baseDirectory, generation);
  if (!manifest) return null;
  return readLines<T>(shardPath(baseDirectory, manifest.generation, shardFor(id))).find((record) => record.id === id) ?? null;
}

export function readShardedRecords<T extends { id: string }>(baseDirectory: string, ids: string[], generation?: string): Map<string, T> {
  const manifest = readShardedManifest(baseDirectory, generation);
  const result = new Map<string, T>();
  if (!manifest || !ids.length) return result;
  const wanted = new Set(ids);
  const shards = new Set(ids.map(shardFor));
  for (const shard of shards) for (const record of readLines<T>(shardPath(baseDirectory, manifest.generation, shard))) if (wanted.has(record.id)) result.set(record.id, record);
  return result;
}

export function readShardedIndex(baseDirectory: string, field: string, generation?: string): IndexEntry[] {
  const manifest = readShardedManifest(baseDirectory, generation);
  if (!manifest) return [];
  if (!manifest.fields.includes(field)) return [];
  return readLines<IndexEntry>(indexPath(baseDirectory, manifest.generation, field));
}

export function readAllShardedRecords<T extends { id: string }>(baseDirectory: string, generation?: string): T[] {
  const manifest = readShardedManifest(baseDirectory, generation);
  if (!manifest) return [];
  const result: T[] = [];
  for (let index = 0; index < IDENTITY_SHARD_COUNT; index += 1) result.push(...readLines<T>(shardPath(baseDirectory, manifest.generation, index.toString(16).padStart(2, '0'))));
  return result;
}
