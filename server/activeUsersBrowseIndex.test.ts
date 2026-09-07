import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeUserValues, type ActiveUserProfile, type ActiveUsersLocalQuery } from './concurUsers';
import { buildActiveUsersBrowseIndex, queryActiveUsersBrowse, readProvisionalActiveUsers } from './activeUsersBrowseIndex';
import { ShardedSnapshotWriter } from './shardedIdentitySnapshot';

const FIELDS = ['id', 'name', 'preferredName', 'firstName', 'lastName', 'login', 'employee', 'email', 'active', 'costCenter', 'startDate', 'loginId', 'employeeNumber'];
const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

let directory: string;
let generation: string;

function query(overrides: Partial<ActiveUsersLocalQuery> = {}): ActiveUsersLocalQuery {
  return {
    offset: 0, limit: 2, q: '', filters: { id: 'root', kind: 'group', logic: 'and', items: [] },
    sortBy: 'name', sortDir: 'asc', source: 'complete', ...overrides,
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'active-users-browse-'));
  const profiles: ActiveUserProfile[] = [
    { id: 'three', displayName: 'Zoë', userName: 'zoe@example.com', [ENTERPRISE]: { employeeNumber: '30' } },
    { id: 'one', displayName: 'Alice 2', userName: 'alice2@example.com', [ENTERPRISE]: { employeeNumber: '10' } },
    { id: 'two', displayName: 'Alice 10', userName: 'alice10@example.com', [ENTERPRISE]: { employeeNumber: '20' } },
  ];
  const writer = new ShardedSnapshotWriter<ActiveUserProfile>(directory, 'us-production', FIELDS, activeUserValues);
  writer.append(profiles);
  generation = writer.finalize('2026-09-05T00:00:00.000Z', 1).generation;
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('Active Users browse index', () => {
  it('serves sorted pages and reverse pages through compact row offsets', async () => {
    const manifest = await buildActiveUsersBrowseIndex(directory, 'us-production', generation);
    expect(manifest).toMatchObject({ count: 3, pageSize: 2048, sourceGeneration: generation });

    expect(queryActiveUsersBrowse(directory, generation, query())?.users.map((user) => user.id)).toEqual(['one', 'two']);
    expect(queryActiveUsersBrowse(directory, generation, query({ offset: 2, limit: 1 }))?.users.map((user) => user.id)).toEqual(['three']);
    expect(queryActiveUsersBrowse(directory, generation, query({ sortDir: 'desc' }))?.users.map((user) => user.id)).toEqual(['three', 'two']);
    expect(queryActiveUsersBrowse(directory, generation, query({ sortBy: 'employee' }))?.users.map((user) => user.id)).toEqual(['one', 'two']);
  });

  it('does not need the full field indexes after the browse generation is committed', async () => {
    await buildActiveUsersBrowseIndex(directory, 'us-production', generation);
    const nameIndex = join(directory, 'generations', generation, 'indexes', 'name.ndjson');
    expect(existsSync(nameIndex)).toBe(true);
    unlinkSync(nameIndex);

    const result = queryActiveUsersBrowse(directory, generation, query({ limit: 3 }));
    expect(result).toMatchObject({ total: 3, provisional: false, orderingReady: true });
    expect(result?.users.map((user) => user.displayName)).toEqual(['Alice 2', 'Alice 10', 'Zoë']);
  });

  it('returns a bounded provisional page before any browse index exists', () => {
    const rows = readProvisionalActiveUsers(directory, generation, 0, 2);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => Boolean(row.id))).toBe(true);
    expect(readFileSync(join(directory, 'generations', generation, 'manifest.json'), 'utf8')).toContain(generation);
  });

  it('fails closed when a committed order page is missing', async () => {
    const manifest = await buildActiveUsersBrowseIndex(directory, 'us-production', generation);
    unlinkSync(join(directory, 'generations', generation, 'browse', 'generations', manifest.generation, 'orders', 'name', '000000.json'));

    expect(() => queryActiveUsersBrowse(directory, generation, query())).toThrow(/browse index is incomplete/);
  });

  it('rejects an order page that no longer matches its committed checksum', async () => {
    const manifest = await buildActiveUsersBrowseIndex(directory, 'us-production', generation);
    const page = join(directory, 'generations', generation, 'browse', 'generations', manifest.generation, 'orders', 'name', '000000.json');
    writeFileSync(page, JSON.stringify([[0, 1], [1, 1], [2, 1]]));

    expect(() => queryActiveUsersBrowse(directory, generation, query())).toThrow(/checksum failed/);
  });
});
