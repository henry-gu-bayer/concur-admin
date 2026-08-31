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

import { fetchListItems, itemsFilePath, searchSavedListItems, validateListItemId } from './concurListItems';

let dataDirectory = '';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Concur list item snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
