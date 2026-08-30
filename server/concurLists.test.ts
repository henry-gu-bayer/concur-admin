import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerAccessToken, upstreamFetch } = vi.hoisted(() => ({
  getServerAccessToken: vi.fn(),
  upstreamFetch: vi.fn(),
}));

vi.mock('./concurAuth', () => ({ getServerAccessToken }));
vi.mock('./upstreamFetch', () => ({ upstreamFetch }));
vi.mock('./logger', () => ({ logApiCall: vi.fn() }));
vi.mock('./entities', () => ({ createEntityRegistry: () => ({ require: () => ({ baseUrl: 'https://api.example.test' }) }) }));

import { ensureListsData, fetchAllLists, listsFilePath } from './concurLists';

let dataDirectory = '';

beforeEach(() => {
  vi.clearAllMocks();
  dataDirectory = mkdtempSync(join(tmpdir(), 'concur-lists-'));
  process.env.DATA_DIR = dataDirectory;
  getServerAccessToken.mockResolvedValue('token');
});

afterEach(() => {
  rmSync(dataDirectory, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('list snapshots', () => {
  it('shares one in-flight refresh for the same entity', async () => {
    let resolve!: (response: Response) => void;
    upstreamFetch.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    const first = fetchAllLists('us-uat');
    const second = fetchAllLists('us-uat');
    resolve(new Response(JSON.stringify({ content: [{ id: 'one', value: 'One' }], links: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it('does not treat a corrupt snapshot as a cache miss', async () => {
    mkdirSync(join(dataDirectory, 'us-uat'), { recursive: true });
    writeFileSync(listsFilePath('us-uat'), '{partial');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(ensureListsData('us-uat')).rejects.toThrow('Local snapshot is corrupt');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
