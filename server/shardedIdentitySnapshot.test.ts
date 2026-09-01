import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pruneGenerations,
  readShardedIndex,
  readShardedManifest,
  readShardedRecord,
  ShardedSnapshotWriter,
} from './shardedIdentitySnapshot';

interface Person { id: string; login: string }

let baseDirectory: string;

function newWriter() {
  return new ShardedSnapshotWriter<Person>(baseDirectory, 'us-uat', ['login'], (record) => ({ login: record.login }));
}

function generationNames(): string[] {
  const directory = join(baseDirectory, 'generations');
  return existsSync(directory) ? readdirSync(directory).sort() : [];
}

function stagingEntries(): string[] {
  return readdirSync(baseDirectory).filter((entry) => entry.startsWith('.staging'));
}

beforeEach(() => {
  baseDirectory = mkdtempSync(join(tmpdir(), 'concur-sharded-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(baseDirectory, { recursive: true, force: true });
});

describe('ShardedSnapshotWriter', () => {
  it('streams records straight into the generation directory without staging', () => {
    const writer = newWriter();
    expect(stagingEntries()).toEqual([]);
    expect(generationNames()).toEqual([writer.generation]);

    writer.append([{ id: 'a', login: 'alice' }]);
    expect(stagingEntries()).toEqual([]);

    writer.finalize('2026-09-01T00:00:00Z', 1);
    expect(stagingEntries()).toEqual([]);
  });

  it('commits the generation through current.json and serves the records back', () => {
    const writer = newWriter();
    writer.append([{ id: 'a', login: 'alice' }, { id: 'b', login: 'bruno' }]);
    const manifest = writer.finalize('2026-09-01T00:00:00Z', 2);

    expect(manifest).toMatchObject({ count: 2, pageCount: 2, generation: writer.generation });
    expect(JSON.parse(readFileSync(join(baseDirectory, 'current.json'), 'utf-8'))).toEqual({ generation: writer.generation });
    expect(readShardedManifest(baseDirectory)?.generation).toBe(writer.generation);
    expect(readShardedRecord<Person>(baseDirectory, 'b')?.login).toBe('bruno');
    expect(readShardedIndex(baseDirectory, 'login')).toEqual([
      { id: 'a', value: 'alice' },
      { id: 'b', value: 'bruno' },
    ]);
  });

  it('leaves the previous snapshot resolvable when a retrieval is discarded', () => {
    const committed = newWriter();
    committed.append([{ id: 'a', login: 'alice' }]);
    committed.finalize('2026-09-01T00:00:00Z', 1);

    const abandoned = newWriter();
    abandoned.append([{ id: 'b', login: 'bruno' }]);
    abandoned.discard();

    expect(generationNames()).toEqual([committed.generation]);
    expect(readShardedManifest(baseDirectory)?.generation).toBe(committed.generation);
    expect(readShardedRecord<Person>(baseDirectory, 'a')?.login).toBe('alice');
    expect(readShardedRecord<Person>(baseDirectory, 'b')).toBeNull();
  });
});

describe('pruneGenerations', () => {
  function backdate(generation: string): void {
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(join(baseDirectory, 'generations', generation), longAgo, longAgo);
  }

  it('removes a superseded generation and leaves the retained one readable', () => {
    const first = newWriter();
    first.append([{ id: 'a', login: 'alice' }]);
    first.finalize('2026-09-01T00:00:00Z', 1);

    const second = newWriter();
    second.append([{ id: 'b', login: 'bruno' }]);
    second.finalize('2026-09-01T01:00:00Z', 1);

    pruneGenerations(baseDirectory, [second.generation]);

    expect(generationNames()).toEqual([second.generation]);
    expect(readShardedRecord<Person>(baseDirectory, 'b')?.login).toBe('bruno');
  });

  it('keeps every generation the caller still needs', () => {
    const pinned = newWriter();
    pinned.append([{ id: 'a', login: 'alice' }]);
    pinned.finalize('2026-09-01T00:00:00Z', 1);

    const current = newWriter();
    current.append([{ id: 'b', login: 'bruno' }]);
    current.finalize('2026-09-01T01:00:00Z', 1);

    pruneGenerations(baseDirectory, [current.generation, pinned.generation]);

    expect(generationNames()).toEqual([pinned.generation, current.generation].sort());
    expect(readShardedRecord<Person>(baseDirectory, 'a', pinned.generation)?.login).toBe('alice');
  });

  it('keeps a manifest-less generation another process may still be writing', () => {
    const inFlight = newWriter();
    inFlight.append([{ id: 'a', login: 'alice' }]);

    const committed = newWriter();
    committed.append([{ id: 'b', login: 'bruno' }]);
    committed.finalize('2026-09-01T00:00:00Z', 1);

    pruneGenerations(baseDirectory, [committed.generation]);

    expect(generationNames()).toEqual([committed.generation, inFlight.generation].sort());
  });

  it('collects manifest-less debris once it is older than the grace window', () => {
    const orphan = newWriter();
    orphan.append([{ id: 'a', login: 'alice' }]);
    backdate(orphan.generation);

    const superseded = newWriter();
    superseded.append([{ id: 'b', login: 'bruno' }]);
    superseded.finalize('2026-09-01T00:00:00Z', 1);

    const committed = newWriter();
    committed.append([{ id: 'c', login: 'carla' }]);
    committed.finalize('2026-09-01T01:00:00Z', 1);

    pruneGenerations(baseDirectory, [committed.generation]);

    expect(generationNames()).toEqual([committed.generation]);
    expect(readShardedManifest(baseDirectory)?.generation).toBe(committed.generation);
  });

  it('ignores a base directory that has no generations yet', () => {
    expect(() => pruneGenerations(baseDirectory, ['anything'])).not.toThrow();
  });
});
