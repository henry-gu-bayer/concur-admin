import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerAccessToken, refreshServerAccessToken, upstreamFetch } = vi.hoisted(() => ({
  getServerAccessToken: vi.fn(),
  refreshServerAccessToken: vi.fn(),
  upstreamFetch: vi.fn(),
}));

vi.mock('./concurAuth', () => ({ getServerAccessToken, refreshServerAccessToken }));
vi.mock('./upstreamFetch', () => ({ upstreamFetch }));
vi.mock('./logger', () => ({ logApiCall: vi.fn() }));
vi.mock('./entities', () => ({ createEntityRegistry: () => ({ require: () => ({ baseUrl: 'https://api.example.test' }) }) }));

import {
  fetchListItems,
  flushPendingListItemWrites,
  getChildrenLevel,
  handleBulkListItems,
  itemsFilePath,
  ItemsProgress,
  readListItems,
  searchSavedListItems,
  validateListItemId,
} from './concurListItems';
import { clearSnapshotCache } from './listItemsCache';

let dataDirectory = '';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** One page of a paged children collection, including the metadata progress relies on. */
function pageResponse(
  content: unknown[],
  { number = 1, totalPages = 1, next }: { number?: number; totalPages?: number; next?: string } = {}
): Response {
  return jsonResponse({
    content,
    links: next ? [{ rel: 'next', href: next }] : [],
    page: { number, size: 100, totalElements: content.length, totalPages },
  });
}

describe('Concur list item snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSnapshotCache();
    dataDirectory = mkdtempSync(join(tmpdir(), 'concur-list-items-'));
    process.env.DATA_DIR = dataDirectory;
    getServerAccessToken.mockResolvedValue('old-token');
    refreshServerAccessToken.mockResolvedValue('fresh-token');
  });

  afterEach(() => {
    rmSync(dataDirectory, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('rejects IDs that could escape the snapshot directory', () => {
    expect(() => validateListItemId('../../outside')).toThrow('Invalid list ID');
    expect(() => itemsFilePath('us-uat', '..%2Foutside')).toThrow('Invalid list ID');
  });

  it('normalizes the entity portion of snapshot paths to lowercase', () => {
    expect(itemsFilePath('US-UAT', 'list-1')).toBe(join(dataDirectory, 'us-uat', 'list-items', 'list-1.json'));
  });

  it('refreshes the token once after a 401 and reuses it', async () => {
    upstreamFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ content: [], links: [] }));

    const snapshot = await fetchListItems('us-uat', 'list-1');

    expect(snapshot.complete).toBe(true);
    expect(refreshServerAccessToken).toHaveBeenCalledWith('us-uat');
    expect(upstreamFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token');
  });

  it('records a failed child branch instead of marking it as cached', async () => {
    upstreamFetch
      .mockResolvedValueOnce(jsonResponse({ content: [{ id: 'parent-1', level: 1, parentId: null, hasChildren: true }], links: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary failure' }, 503));

    const snapshot = await fetchListItems('us-uat', 'list-1');

    expect(snapshot.complete).toBe(false);
    expect(snapshot.fetchedChildren).not.toContain('parent-1');
    expect(snapshot.failedChildren).toEqual([{ parentId: 'parent-1', error: expect.stringContaining('503') }]);
  });

  it('searches saved item values and codes without another upstream request', async () => {
    upstreamFetch.mockResolvedValueOnce(jsonResponse({
      content: [{ id: 'item-1', value: 'North America', code: 'NA-01', shortCode: 'NA', level: 1, parentId: null }],
      links: [],
    }));
    await fetchListItems('us-uat', 'list-1');
    const upstreamCallsAfterSave = upstreamFetch.mock.calls.length;

    expect(searchSavedListItems('us-uat', 'value', 'america').matches).toEqual([
      expect.objectContaining({ listId: 'list-1', itemId: 'item-1', value: 'North America' }),
    ]);
    expect(searchSavedListItems('us-uat', 'code', 'na-').matches).toEqual([
      expect.objectContaining({ listId: 'list-1', itemId: 'item-1', code: 'NA-01' }),
    ]);
    expect(upstreamFetch).toHaveBeenCalledTimes(upstreamCallsAfterSave);
  });

  it('retrieves every page instead of stopping at a built-in ceiling', async () => {
    const pageOne = Array.from({ length: 3 }, (_, i) => ({ id: `a-${i}`, level: 1, parentId: null }));
    const pageTwo = Array.from({ length: 2 }, (_, i) => ({ id: `b-${i}`, level: 1, parentId: null }));
    upstreamFetch
      .mockResolvedValueOnce(pageResponse(pageOne, { number: 1, totalPages: 2, next: 'https://api.example.test/next' }))
      .mockResolvedValueOnce(pageResponse(pageTwo, { number: 2, totalPages: 2 }));

    const snapshot = await fetchListItems('us-uat', 'list-1');

    expect(snapshot.count).toBe(5);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.pageCount).toBe(2);
  });

  it('reports a non-decreasing page-based percentage that ends at 100', async () => {
    upstreamFetch
      .mockResolvedValueOnce(pageResponse([{ id: 'parent-1', level: 1, parentId: null, hasChildren: true }]))
      .mockResolvedValueOnce(pageResponse(
        [{ id: 'child-1', level: 2, parentId: 'parent-1' }],
        { number: 1, totalPages: 2, next: 'https://api.example.test/child-page-2' }
      ))
      .mockResolvedValueOnce(pageResponse([{ id: 'child-2', level: 2, parentId: 'parent-1' }], { number: 2, totalPages: 2 }));

    const events: ItemsProgress[] = [];
    const snapshot = await fetchListItems('us-uat', 'list-1', { onProgress: (p) => events.push(p) });

    const percents = events.map((e) => e.percent).filter((p): p is number => p !== undefined);
    expect(percents.length).toBeGreaterThan(0);
    expect([...percents]).toEqual([...percents].sort((a, b) => a - b));
    expect(Math.max(...percents)).toBeLessThanOrEqual(99);

    // The estimate must cover the branch discovered while traversing, not just
    // the pages already fetched.
    const last = events[events.length - 1];
    expect(last.pagesDone).toBe(3);
    expect(last.pagesTotal).toBe(3);
    expect(last.branchesTotal).toBe(2);
    expect(snapshot.complete).toBe(true);
  });

  it('serves an already-cached level without calling Concur again', async () => {
    upstreamFetch
      .mockResolvedValueOnce(pageResponse([{ id: 'parent-1', level: 1, parentId: null, hasChildren: true }]))
      .mockResolvedValueOnce(pageResponse([
        { id: 'child-b', level: 2, parentId: 'parent-1', code: 'B' },
        { id: 'child-a', level: 2, parentId: 'parent-1', code: 'A' },
      ]));
    await fetchListItems('us-uat', 'list-1');
    const callsAfterRetrieval = upstreamFetch.mock.calls.length;

    const roots = await getChildrenLevel('us-uat', 'list-1', null);
    const children = await getChildrenLevel('us-uat', 'list-1', 'parent-1');

    expect(roots.fromCache).toBe(true);
    expect(children.fromCache).toBe(true);
    expect(children.items.map((i) => i.id)).toEqual(['child-a', 'child-b']);
    expect(upstreamFetch).toHaveBeenCalledTimes(callsAfterRetrieval);
  });

  it('lazily fetches an uncached level and merges it into the snapshot', async () => {
    upstreamFetch.mockResolvedValueOnce(pageResponse([
      { id: 'root-b', level: 1, parentId: null, code: 'B' },
      { id: 'root-a', level: 1, parentId: null, code: 'A' },
    ]));

    const first = await getChildrenLevel('us-uat', 'list-1', null);
    expect(first.fromCache).toBe(false);
    expect(first.items.map((i) => i.id)).toEqual(['root-a', 'root-b']);

    // The write is coalesced, so the in-memory snapshot answers immediately and
    // the file catches up on flush.
    expect(readListItems('us-uat', 'list-1')?.count).toBe(2);
    flushPendingListItemWrites();
    clearSnapshotCache();
    expect(readListItems('us-uat', 'list-1')?.count).toBe(2);

    const second = await getChildrenLevel('us-uat', 'list-1', null);
    expect(second.fromCache).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it('skips lists that already hold a complete tree unless forced', async () => {
    upstreamFetch.mockResolvedValue(pageResponse([{ id: 'item-1', level: 1, parentId: null }]));
    await fetchListItems('us-uat', 'list-1');
    const callsAfterRetrieval = upstreamFetch.mock.calls.length;

    const skipped = await runBulkJob('us-uat', ['list-1']);
    expect(skipped.summary?.skipped).toBe(1);
    expect(skipped.events.some((e) => e.phase === 'list-skipped')).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(callsAfterRetrieval);

    const forced = await runBulkJob('us-uat', ['list-1'], true);
    expect(forced.summary?.skipped).toBe(0);
    expect(upstreamFetch.mock.calls.length).toBeGreaterThan(callsAfterRetrieval);
  });

  it('streams an overall percentage across the lists in a job', async () => {
    upstreamFetch.mockResolvedValue(pageResponse([{ id: 'item-1', level: 1, parentId: null }]));

    const { events } = await runBulkJob('us-uat', ['list-1', 'list-2']);

    const overall = events.map((e) => e.overallPercent).filter((p): p is number => p !== undefined);
    expect(overall[0]).toBe(0);
    expect(overall[overall.length - 1]).toBe(100);
    expect([...overall]).toEqual([...overall].sort((a, b) => a - b));
  });
});

interface BulkJobResult {
  events: ItemsProgress[];
  summary: { total: number; succeeded: number; failed: number; truncated: number; skipped: number } | null;
}

/**
 * Drive a bulk job through the same SSE handler the dev server mounts, so the
 * test exercises the real emit-and-stream path rather than job internals.
 */
function runBulkJob(entityId: string, listIds: string[], force = false): Promise<BulkJobResult> {
  return new Promise<BulkJobResult>((resolve) => {
    const events: ItemsProgress[] = [];
    let summary: BulkJobResult['summary'] = null;
    handleBulkListItems(
      {
        writeHead: () => {},
        flushHeaders: () => {},
        write: (chunk: string) => {
          const eventName = chunk.match(/^event: (.+)$/m)?.[1];
          const data = chunk.match(/^data: (.+)$/m)?.[1];
          if (!data) return;
          if (eventName === 'done') summary = JSON.parse(data);
          else events.push(JSON.parse(data) as ItemsProgress);
        },
        end: () => resolve({ events, summary }),
      },
      entityId,
      { listIds, force }
    );
  });
}

