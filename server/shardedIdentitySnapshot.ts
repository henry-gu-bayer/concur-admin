import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';

export const IDENTITY_SHARD_COUNT = 256;

export interface ShardedSnapshotManifest {
  format: 'concur-sharded-identity-v1';
  entityId: string;
  generation: string;
  retrievedAt: string;
  count: number;
  pageCount: number;
  shardCount: number;
  fields: string[];
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

/** A staging writer keeps records and column indexes on disk while pages arrive. */
export class ShardedSnapshotWriter<T extends { id: string }> {
  readonly generation = `${Date.now()}-${randomUUID()}`;
  private readonly stagingDirectory: string;
  private count = 0;

  constructor(private readonly baseDirectory: string, private readonly entityId: string, private readonly fields: string[], private readonly valuesFor: (record: T) => Record<string, string>) {
    this.stagingDirectory = join(rootDirectory(baseDirectory), `.staging-${this.generation}`);
    mkdirSync(join(this.stagingDirectory, 'shards'), { recursive: true });
    mkdirSync(join(this.stagingDirectory, 'indexes'), { recursive: true });
  }

  append(records: T[]): void {
    for (const record of records) {
      if (!record.id) continue;
      appendFileSync(join(this.stagingDirectory, 'shards', `${shardFor(record.id)}.ndjson`), `${JSON.stringify(record)}\n`, 'utf-8');
      const values = this.valuesFor(record);
      for (const field of this.fields) {
        appendFileSync(join(this.stagingDirectory, 'indexes', `${encodeURIComponent(field)}.ndjson`), `${JSON.stringify({ id: record.id, value: values[field] ?? '' })}\n`, 'utf-8');
      }
      this.count += 1;
    }
  }

  finalize(retrievedAt: string, pageCount: number): ShardedSnapshotManifest {
    const manifest: ShardedSnapshotManifest = {
      format: 'concur-sharded-identity-v1', entityId: this.entityId, generation: this.generation,
      retrievedAt, count: this.count, pageCount, shardCount: IDENTITY_SHARD_COUNT, fields: this.fields,
    };
    writeJsonSnapshot(join(this.stagingDirectory, 'manifest.json'), manifest);
    const target = generationDirectory(this.baseDirectory, this.generation);
    mkdirSync(join(rootDirectory(this.baseDirectory), 'generations'), { recursive: true });
    renameSync(this.stagingDirectory, target);
    writeJsonSnapshot(currentPath(this.baseDirectory), { generation: this.generation } satisfies CurrentGeneration);
    return manifest;
  }

  discard(): void { rmSync(this.stagingDirectory, { recursive: true, force: true }); }
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
