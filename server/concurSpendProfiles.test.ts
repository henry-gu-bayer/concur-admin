import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSpendProfilesSnapshot,
  getSpendProfileDetail,
  getSpendProfilesProgress,
  querySpendProfiles,
  readSpendProfilesSummary,
  type SpendFilterGroup,
} from './concurSpendProfiles';
import { activeUserValues, type ActiveUserProfile } from './concurUsers';
import { ShardedSnapshotWriter } from './shardedIdentitySnapshot';

const { getServerAccessToken, upstreamFetch, logApiCall, logApiCallFailure } = vi.hoisted(() => ({
  getServerAccessToken: vi.fn(),
  upstreamFetch: vi.fn(),
  logApiCall: vi.fn(),
  logApiCallFailure: vi.fn(),
}));

vi.mock('./concurAuth', () => ({ getServerAccessToken }));
vi.mock('./upstreamFetch', () => ({ upstreamFetch }));
vi.mock('./logger', () => ({ logApiCall, logApiCallFailure }));
vi.mock('./entities', () => ({ createEntityRegistry: () => ({ require: () => ({ baseUrl: 'https://us2.api.concursolutions.com' }) }) }));

const spendSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const enterpriseSchema = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
let dataDirectory: string;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)), headers: { forEach: (callback: (value: string, key: string) => void) => callback('application/json', 'content-type') } };
}

function writeIdentitySnapshot(entityId = 'us-production') {
  const directory = join(dataDirectory, entityId, 'identity');
  mkdirSync(directory, { recursive: true });
  const profiles = [
    { id: 'one', userName: 'alice@example.com', preferredName: 'Alice', emails: [{ value: 'alice@example.com', type: 'work' }], [enterpriseSchema]: { employeeNumber: '100' } },
    { id: 'two', userName: 'bruno@example.com', preferredName: 'Bruno', emails: [{ value: 'bruno@example.com', type: 'work' }], [enterpriseSchema]: { employeeNumber: '200' } },
    { id: 'three', userName: 'carla@example.com', preferredName: 'Carla', emails: [{ value: 'carla@example.com', type: 'work' }], [enterpriseSchema]: { employeeNumber: '300' } },
  ];
  writeFileSync(join(directory, 'active-users.json'), JSON.stringify({ entityId, retrievedAt: '2026-08-30T00:00:00Z', count: 3, pageCount: 1, profiles }));
}

function writeShardedIdentitySnapshot(entityId = 'us-production') {
  const profiles: ActiveUserProfile[] = [{ id: 'one', userName: 'alice@example.com', preferredName: 'Alice', emails: [{ value: 'alice@example.com', type: 'work' }], [enterpriseSchema]: { employeeNumber: '100' } }];
  const writer = new ShardedSnapshotWriter(join(dataDirectory, entityId, 'identity', 'active-users'), entityId, ['id', 'login', 'employee', 'email', 'preferredName'], activeUserValues);
  writer.append(profiles);
  return writer.finalize(new Date().toISOString(), 1).generation;
}

beforeEach(() => {
  vi.clearAllMocks();
  dataDirectory = mkdtempSync(join(tmpdir(), 'concur-spend-profiles-'));
  vi.stubEnv('DATA_DIR', dataDirectory);
  getServerAccessToken.mockResolvedValue('server-token');
});

afterEach(() => {
  rmSync(dataDirectory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('Spend Profile snapshots', () => {
  it('requires the complete local active-user snapshot', async () => {
    await expect(fetchSpendProfilesSnapshot('us-production')).rejects.toThrow('User Profiles snapshot');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('retrieves every page, stores the snapshot, and reports elapsed progress', async () => {
    writeIdentitySnapshot();
    upstreamFetch
      .mockResolvedValueOnce(jsonResponse({ totalResults: 3, startIndex: 1, itemsPerPage: 2, Resources: [
        { id: 'one', [spendSchema]: { country: 'PT', reimbursementCurrency: 'EUR', customData: [{ id: 'custom19', value: '1344' }] } },
        { id: 'two', [spendSchema]: { country: 'PT', reimbursementCurrency: 'EUR', customData: [{ id: 'custom19', value: '0913' }] } },
      ] }))
      .mockResolvedValueOnce(jsonResponse({ totalResults: 3, startIndex: 3, itemsPerPage: 2, Resources: [
        { id: 'three', [spendSchema]: { country: 'DE', reimbursementCurrency: 'EUR', customData: [{ id: 'custom21', value: 'Bayer Germany' }] } },
      ] }));

    const snapshot = await fetchSpendProfilesSnapshot('us-production');

    expect(snapshot).toMatchObject({ count: 3, pageCount: 2 });
    expect(upstreamFetch.mock.calls[0][0]).toContain('startIndex=1');
    expect(upstreamFetch.mock.calls[0][0]).toContain('count=100');
    expect(upstreamFetch.mock.calls[1][0]).toContain('startIndex=3');
    expect(logApiCall).toHaveBeenCalledTimes(2);
    expect(existsSync(join(dataDirectory, 'us-production', 'identity', 'spend-profiles.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dataDirectory, 'us-production', 'identity', 'spend-profiles.json'), 'utf-8')).profiles).toHaveLength(3);
    expect(readSpendProfilesSummary('us-production')).toMatchObject({ count: 3, identityCount: 3, customFields: ['custom19', 'custom21'] });
    expect(getSpendProfilesProgress('us-production')).toMatchObject({ state: 'complete', retrievedCount: 3, percent: 100 });
  });

  it('joins Identity values and evaluates nested AND/OR filters locally', async () => {
    writeIdentitySnapshot();
    upstreamFetch.mockResolvedValueOnce(jsonResponse({ totalResults: 3, startIndex: 1, itemsPerPage: 100, Resources: [
      { id: 'one', [spendSchema]: { country: 'PT', customData: [{ id: 'custom19', value: '1344' }] } },
      { id: 'two', [spendSchema]: { country: 'PT', customData: [{ id: 'custom19', value: '0913' }] } },
      { id: 'three', [spendSchema]: { country: 'DE', customData: [{ id: 'custom19', value: '1344' }] } },
      { id: 'orphan', [spendSchema]: { country: 'PT', customData: [{ id: 'custom19', value: '1344' }] } },
    ] }));
    await fetchSpendProfilesSnapshot('us-production');
    const filters: SpendFilterGroup = {
      id: 'root', kind: 'group', logic: 'and', items: [
        { id: 'country', kind: 'condition', field: 'country', operator: 'eq', value: 'PT' },
        { id: 'custom-values', kind: 'group', logic: 'or', items: [
          { id: 'custom-a', kind: 'condition', field: 'custom19', operator: 'eq', value: '1344' },
          { id: 'custom-b', kind: 'condition', field: 'custom19', operator: 'eq', value: '0913' },
        ] },
      ],
    };

    const result = querySpendProfiles('us-production', { offset: 0, limit: 200, filters, sortBy: 'loginId', sortDir: 'asc' });

    expect(result?.total).toBe(2);
    expect(result?.rows.map((row) => row.loginId)).toEqual(['alice@example.com', 'bruno@example.com']);
    expect(result?.rows[0]).toMatchObject({ employeeNumber: '100', preferredName: 'Alice', values: { country: 'PT', custom19: '1344' } });
    expect(querySpendProfiles('us-production', { offset: 0, limit: 200, filters: { id: 'root', kind: 'group', logic: 'and', items: [] }, sortBy: 'loginId', sortDir: 'asc', includeOrphans: true })?.total).toBe(4);
    expect(getSpendProfileDetail('us-production', 'one')).toMatchObject({ identity: { userName: 'alice@example.com' }, spend: { id: 'one' } });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it('pins Spend Profiles to the Identity generation used during retrieval and reports a newer Identity snapshot', async () => {
    const firstGeneration = writeShardedIdentitySnapshot();
    upstreamFetch.mockResolvedValueOnce(jsonResponse({ totalResults: 1, Resources: [{ id: 'one', [spendSchema]: { country: 'PT' } }] }));

    await fetchSpendProfilesSnapshot('us-production');
    expect(readSpendProfilesSummary('us-production')).toMatchObject({ identityGeneration: firstGeneration, identityStale: false });

    writeShardedIdentitySnapshot();
    expect(readSpendProfilesSummary('us-production')).toMatchObject({ identityGeneration: firstGeneration, identityStale: true });
    expect(getSpendProfileDetail('us-production', 'one')?.identity?.userName).toBe('alice@example.com');
  });
});
