import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CorruptSnapshotError, readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'concur-snapshot-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('snapshot files', () => {
  it('returns null only when the snapshot is absent', () => {
    expect(readJsonSnapshot(join(temporaryDirectory(), 'missing.json'))).toBeNull();
  });

  it('reports malformed JSON instead of treating it as a cache miss', () => {
    const file = join(temporaryDirectory(), 'broken.json');
    writeFileSync(file, '{partial');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => readJsonSnapshot(file)).toThrow(CorruptSnapshotError);
  });

  it('atomically replaces a snapshot and leaves no temporary file', () => {
    const directory = temporaryDirectory();
    const file = join(directory, 'nested', 'snapshot.json');
    writeJsonSnapshot(file, { count: 2 }, true);
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ count: 2 });
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});
