import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeJsonSnapshot } from './snapshotFiles';
import {
  applyChildren,
  childrenOf,
  clearSnapshotCache,
  dirtySnapshots,
  loadSnapshot,
  markFlushed,
  ROOT_BUCKET,
  setDirtyFlushHandler,
  storeSnapshot,
} from './listItemsCache';
import type { ConcurListItem, ListItemsFileData } from './concurListItems';

let directory = '';
let filePath = '';

function item(id: string, level: number, parentId: string | null, code?: string): ConcurListItem {
  return { id, level, parentId, code, value: `value-${id}` };
}

function snapshot(items: ConcurListItem[]): ListItemsFileData {
  return {
    listId: 'list-1',
    retrievedAt: '2026-08-04T00:00:00.000Z',
    count: items.length,
    truncated: false,
    maxLevel: items.reduce((max, it) => Math.max(max, it.level), 0),
    items,
    rootsFetched: true,
    fetchedChildren: [],
    complete: true,
    failedChildren: [],
  };
}

describe('list item snapshot cache', () => {
  beforeEach(() => {
    clearSnapshotCache();
    setDirtyFlushHandler(() => {});
    directory = mkdtempSync(join(tmpdir(), 'concur-items-cache-'));
    filePath = join(directory, 'list-1.json');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('indexes children by parent, with level-1 items under the root bucket', () => {
    writeJsonSnapshot(filePath, snapshot([
      item('root-b', 1, null, 'B'),
      item('root-a', 1, null, 'A'),
      item('child-2', 2, 'root-a', 'A-2'),
      item('child-1', 2, 'root-a', 'A-1'),
    ]));

    const entry = loadSnapshot('us-uat', 'list-1', filePath);

    expect(entry).not.toBeNull();
    expect(childrenOf(entry!, ROOT_BUCKET).map((i) => i.id)).toEqual(['root-a', 'root-b']);
    expect(childrenOf(entry!, 'root-a').map((i) => i.id)).toEqual(['child-1', 'child-2']);
    expect(childrenOf(entry!, 'missing-parent')).toEqual([]);
  });

  it('reuses the parsed snapshot until the file actually changes', () => {
    writeJsonSnapshot(filePath, snapshot([item('root-a', 1, null, 'A')]));
    const first = loadSnapshot('us-uat', 'list-1', filePath);
    const second = loadSnapshot('us-uat', 'list-1', filePath);
    expect(second).toBe(first);

    writeJsonSnapshot(filePath, snapshot([item('root-a', 1, null, 'A'), item('root-b', 1, null, 'B')]));
    const third = loadSnapshot('us-uat', 'list-1', filePath);
    expect(third).not.toBe(first);
    expect(childrenOf(third!, ROOT_BUCKET).map((i) => i.id)).toEqual(['root-a', 'root-b']);
  });

  it('returns null when no snapshot exists and forgets a deleted one', () => {
    expect(loadSnapshot('us-uat', 'list-1', filePath)).toBeNull();

    writeJsonSnapshot(filePath, snapshot([item('root-a', 1, null, 'A')]));
    expect(loadSnapshot('us-uat', 'list-1', filePath)).not.toBeNull();

    rmSync(filePath);
    expect(loadSnapshot('us-uat', 'list-1', filePath)).toBeNull();
  });

  it('merges one level without disturbing the rest of the snapshot', () => {
    writeJsonSnapshot(filePath, snapshot([item('root-a', 1, null, 'A'), item('root-b', 1, null, 'B')]));
    const entry = loadSnapshot('us-uat', 'list-1', filePath)!;

    applyChildren(entry, 'root-a', [item('child-2', 2, 'root-a', 'A-2'), item('child-1', 2, 'root-a', 'A-1')]);

    expect(childrenOf(entry, 'root-a').map((i) => i.id)).toEqual(['child-1', 'child-2']);
    expect(childrenOf(entry, ROOT_BUCKET).map((i) => i.id)).toEqual(['root-a', 'root-b']);
    expect(entry.data.count).toBe(4);
    expect(entry.data.maxLevel).toBe(2);
    expect(entry.dirty).toBe(true);
  });

  it('does not duplicate items when a level is fetched twice', () => {
    writeJsonSnapshot(filePath, snapshot([item('root-a', 1, null, 'A')]));
    const entry = loadSnapshot('us-uat', 'list-1', filePath)!;

    applyChildren(entry, 'root-a', [item('child-1', 2, 'root-a', 'A-1')]);
    applyChildren(entry, 'root-a', [item('child-1', 2, 'root-a', 'A-1')]);

    expect(entry.data.count).toBe(2);
    expect(childrenOf(entry, 'root-a')).toHaveLength(1);
  });

  it('keeps serving a dirty entry that is ahead of the file', () => {
    writeJsonSnapshot(filePath, snapshot([item('root-a', 1, null, 'A')]));
    const entry = loadSnapshot('us-uat', 'list-1', filePath)!;
    applyChildren(entry, 'root-a', [item('child-1', 2, 'root-a', 'A-1')]);

    expect(dirtySnapshots()).toHaveLength(1);
    expect(loadSnapshot('us-uat', 'list-1', filePath)).toBe(entry);

    markFlushed(entry);
    expect(entry.dirty).toBe(false);
    expect(dirtySnapshots()).toHaveLength(0);
  });

  it('flushes a dirty entry before evicting it', () => {
    const flush = vi.fn();
    setDirtyFlushHandler(flush);

    const evicted = storeSnapshot('us-uat', 'list-0', join(directory, 'list-0.json'), snapshot([]), true);
    for (const id of ['list-1', 'list-2', 'list-3']) {
      storeSnapshot('us-uat', id, join(directory, `${id}.json`), snapshot([]), false);
    }

    expect(flush).toHaveBeenCalledWith(evicted);
  });
});
