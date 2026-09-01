import { statSync } from 'node:fs';
import { readJsonSnapshot } from './snapshotFiles';
import { compareSiblings } from './listItemOrder';
import type { ConcurListItem, ListItemsFileData } from './concurListItems';

/**
 * In-memory cache of parsed list-item snapshots, indexed by parent.
 *
 * Why this exists: the tree UI asks the backend for one node's children at a
 * time. Serving that from disk meant re-reading and re-parsing the entire
 * snapshot (~77 ms for a real 7.2 MB / 23,570-item list) and then scanning
 * every item to find the ~20 that belong to the node. Both costs were paid on
 * every single expansion. Here the parse happens once and each lookup is a map
 * hit.
 *
 * Freshness: entries are validated against the file's mtime and size, so a
 * snapshot rewritten by any other code path is picked up automatically. An
 * entry may also be `dirty`, meaning the in-memory copy is ahead of the file
 * because a write was coalesced; a dirty entry is always authoritative and is
 * flushed before it can be evicted.
 */

/** Enough for the list being browsed plus the one before it. Each parsed entry is large. */
const MAX_CACHED_LISTS = 3;

/** Bucket key for level-1 items, which have no parent. */
export const ROOT_BUCKET = '';

export interface CachedListSnapshot {
  entityId: string;
  listId: string;
  filePath: string;
  data: ListItemsFileData;
  /** parentId (or ROOT_BUCKET for level-1) -> that node's direct children, in sibling order. */
  childrenByParent: Map<string, ConcurListItem[]>;
  mtimeMs: number;
  size: number;
  /** The in-memory copy is ahead of the file because a write was coalesced. */
  dirty: boolean;
}

/** Insertion order doubles as LRU order: the oldest live at the front. */
const entries = new Map<string, CachedListSnapshot>();

let flushDirtyEntry: (entry: CachedListSnapshot) => void = () => {};

/**
 * Registered by the snapshot writer so a dirty entry is never dropped without
 * reaching disk first. Kept as a seam to avoid a runtime import cycle.
 */
export function setDirtyFlushHandler(handler: (entry: CachedListSnapshot) => void): void {
  flushDirtyEntry = handler;
}

function fileStamp(filePath: string): { mtimeMs: number; size: number } | null {
  try {
    const stats = statSync(filePath);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return null;
  }
}

/** Group items by parent so a node's children are one lookup away. */
function indexChildren(data: ListItemsFileData): Map<string, ConcurListItem[]> {
  const byParent = new Map<string, ConcurListItem[]>();
  for (const item of data.items) {
    // Level-1 items are identified by level rather than by a null parentId so
    // the index matches exactly what the previous filter-based lookup returned.
    const key = item.level === 1 ? ROOT_BUCKET : item.parentId ?? ROOT_BUCKET;
    const bucket = byParent.get(key);
    if (bucket) bucket.push(item);
    else byParent.set(key, [item]);
  }
  for (const bucket of byParent.values()) bucket.sort(compareSiblings);
  return byParent;
}

function touch(key: string, entry: CachedListSnapshot): void {
  entries.delete(key);
  entries.set(key, entry);
}

function evictOverflow(): void {
  while (entries.size > MAX_CACHED_LISTS) {
    const oldest = entries.entries().next();
    if (oldest.done) return;
    const [key, entry] = oldest.value;
    if (entry.dirty) flushDirtyEntry(entry);
    entries.delete(key);
  }
}

/** The cached entry for a snapshot, without touching the filesystem. */
export function peekSnapshot(filePath: string): CachedListSnapshot | null {
  return entries.get(filePath) ?? null;
}

/**
 * The parsed snapshot for a list, from cache when it is still valid, otherwise
 * read and indexed from disk. Returns null when no snapshot exists yet.
 */
export function loadSnapshot(entityId: string, listId: string, filePath: string): CachedListSnapshot | null {
  const cached = entries.get(filePath);
  if (cached) {
    if (cached.dirty) {
      touch(filePath, cached);
      return cached;
    }
    const stamp = fileStamp(filePath);
    if (!stamp) {
      entries.delete(filePath);
      return null;
    }
    if (stamp.mtimeMs === cached.mtimeMs && stamp.size === cached.size) {
      touch(filePath, cached);
      return cached;
    }
  }

  const data = readJsonSnapshot<ListItemsFileData>(filePath);
  if (!data) {
    entries.delete(filePath);
    return null;
  }
  return storeSnapshot(entityId, listId, filePath, data, false);
}

/** Cache a snapshot the caller already has in hand, e.g. straight after a write. */
export function storeSnapshot(
  entityId: string,
  listId: string,
  filePath: string,
  data: ListItemsFileData,
  dirty: boolean
): CachedListSnapshot {
  const stamp = fileStamp(filePath) ?? { mtimeMs: 0, size: 0 };
  const entry: CachedListSnapshot = {
    entityId,
    listId,
    filePath,
    data,
    childrenByParent: indexChildren(data),
    mtimeMs: stamp.mtimeMs,
    size: stamp.size,
    dirty,
  };
  touch(filePath, entry);
  evictOverflow();
  return entry;
}

/**
 * Add one node's freshly fetched children to a cached snapshot.
 * Only the affected bucket is sorted, so merging a level into a large list
 * costs the size of that level rather than a full re-sort of every item.
 */
export function applyChildren(entry: CachedListSnapshot, parentKey: string, children: ConcurListItem[]): void {
  const known = new Set(entry.data.items.map((item) => item.id));
  const added: ConcurListItem[] = [];
  for (const child of children) {
    if (known.has(child.id)) continue;
    known.add(child.id);
    added.push(child);
    if (child.level > entry.data.maxLevel) entry.data.maxLevel = child.level;
  }

  if (added.length) {
    entry.data.items.push(...added);
    entry.data.count = entry.data.items.length;
  }

  // The bucket is rebuilt from the full child set even when nothing was added,
  // so a re-fetch that reorders or re-labels children is reflected.
  const bucket = entry.data.items.filter((item) =>
    parentKey === ROOT_BUCKET ? item.level === 1 : item.parentId === parentKey
  );
  bucket.sort(compareSiblings);
  entry.childrenByParent.set(parentKey, bucket);
  entry.dirty = true;
}

/** The children of one node, or null when that level has not been indexed. */
export function childrenOf(entry: CachedListSnapshot, parentKey: string): ConcurListItem[] {
  return entry.childrenByParent.get(parentKey) ?? [];
}

/** Record that a dirty entry reached disk, re-reading the file stamp. */
export function markFlushed(entry: CachedListSnapshot): void {
  const stamp = fileStamp(entry.filePath);
  if (stamp) {
    entry.mtimeMs = stamp.mtimeMs;
    entry.size = stamp.size;
  }
  entry.dirty = false;
}

export function invalidateSnapshot(filePath: string): void {
  entries.delete(filePath);
}

export function dirtySnapshots(): CachedListSnapshot[] {
  return [...entries.values()].filter((entry) => entry.dirty);
}

/** Test seam: drop everything without flushing. */
export function clearSnapshotCache(): void {
  entries.clear();
}
