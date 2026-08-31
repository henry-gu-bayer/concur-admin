import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeUsersCsv, fetchActiveUsersSnapshot, getActiveUsersProgress, queryActiveUsers, readActiveUsersSnapshot } from './concurUsers';

const { getServerAccessToken, upstreamFetch, logApiCall, logApiCallFailure } = vi.hoisted(() => ({
  getServerAccessToken: vi.fn(),
  upstreamFetch: vi.fn(),
  logApiCall: vi.fn(),
  logApiCallFailure: vi.fn(),
}));

vi.mock('./concurAuth', () => ({ getServerAccessToken }));
vi.mock('./upstreamFetch', () => ({ upstreamFetch }));
vi.mock('./logger', () => ({ logApiCall, logApiCallFailure }));
vi.mock('./entities', () => ({
  createEntityRegistry: () => ({ require: () => ({ baseUrl: 'https://us2.api.concursolutions.com' }) }),
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { forEach: (callback: (value: string, key: string) => void) => callback('application/json', 'content-type') },
  };
}

let dataDirectory: string;

beforeEach(() => {
  vi.clearAllMocks();
  dataDirectory = mkdtempSync(join(tmpdir(), 'concur-users-'));
  vi.stubEnv('DATA_DIR', dataDirectory);
  getServerAccessToken.mockResolvedValue('server-token');
});

afterEach(() => {
  rmSync(dataDirectory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('active Identity user snapshots', () => {
  it('follows nextCursor and atomically saves the complete result', async () => {
    upstreamFetch
      .mockResolvedValueOnce(jsonResponse({ Resources: [{ id: 'one', userName: 'one@example.com' }], nextCursor: 'cursor-2', totalResults: 2, startIndex: 1, itemsPerPage: 100 }))
      .mockResolvedValueOnce(jsonResponse({ Resources: [{ id: 'two', userName: 'two@example.com' }], totalResults: 2, startIndex: 2, itemsPerPage: 100 }));

    const snapshot = await fetchActiveUsersSnapshot('us-production');

    expect(snapshot).toMatchObject({ entityId: 'us-production', count: 2, pageCount: 2 });
    expect(logApiCall).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(upstreamFetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(upstreamFetch.mock.calls[1][1].body);
    expect(firstBody).toMatchObject({ filter: 'active eq true', count: 100 });
    expect(firstBody.attributes).toContain('name.formatted');
    expect(secondBody).toEqual(expect.objectContaining({ count: 100, cursor: 'cursor-2' }));
    expect(secondBody).not.toHaveProperty('filter');

    const file = join(dataDirectory, 'us-production', 'identity', 'active-users.json');
    expect(existsSync(file)).toBe(true);
    expect(existsSync(join(dataDirectory, 'us-production', 'identity', 'active-users-summary.json'))).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf-8')).profiles).toHaveLength(2);
    expect(readActiveUsersSnapshot('us-production')?.profiles).toHaveLength(2);
    expect(getActiveUsersProgress('us-production')).toMatchObject({
      state: 'complete', retrievedCount: 2, totalResults: 2, pageCount: 2,
      startIndex: 2, itemsPerPage: 100, percent: 100,
    });
  });

  it('logs a transport failure and does not create a partial snapshot', async () => {
    upstreamFetch.mockRejectedValue(new Error('proxy unavailable'));

    await expect(fetchActiveUsersSnapshot('us-production')).rejects.toThrow('proxy unavailable');
    expect(logApiCallFailure).toHaveBeenCalledWith('us-production', expect.objectContaining({ error: 'proxy unavailable' }));
    expect(readActiveUsersSnapshot('us-production')).toBeNull();
  });

  it('rejects a repeated cursor instead of looping forever', async () => {
    upstreamFetch
      .mockResolvedValueOnce(jsonResponse({ Resources: [{ id: 'one' }], nextCursor: 'repeat' }))
      .mockResolvedValueOnce(jsonResponse({ Resources: [{ id: 'two' }], nextCursor: 'repeat' }));

    await expect(fetchActiveUsersSnapshot('us-production')).rejects.toThrow('repeated a pagination cursor');
    expect(readActiveUsersSnapshot('us-production')).toBeNull();
  });

  it('queries, sorts, filters, and paginates the local snapshot without another upstream call', async () => {
    const enterprise = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
    upstreamFetch.mockResolvedValueOnce(jsonResponse({
      totalResults: 3,
      itemsPerPage: 100,
      Resources: [
        { id: 'three', displayName: 'Zoe Li', name: { givenName: 'Zoe', familyName: 'Li' }, userName: 'zoe@example.com', emails: [{ value: 'zoe@example.com', type: 'work' }], [enterprise]: { employeeNumber: '300' } },
        { id: 'one', displayName: 'Alice Chen', name: { givenName: 'Alice', familyName: 'Chen' }, userName: 'alice@example.com', emails: [{ value: 'alice@example.com', type: 'work' }], [enterprise]: { employeeNumber: '100' } },
        { id: 'two', displayName: 'Henry Gu', name: { givenName: 'Henry', familyName: 'Gu' }, userName: 'henry@example.com', emails: [{ value: 'henry@example.com', type: 'work' }], [enterprise]: { employeeNumber: '200' } },
      ],
    }));
    await fetchActiveUsersSnapshot('us-production');

    const firstPage = queryActiveUsers('us-production', { offset: 0, limit: 2, q: '', sortBy: 'name', sortDir: 'asc' });
    const byLastName = queryActiveUsers('us-production', { offset: 0, limit: 3, q: '', sortBy: 'lastName', sortDir: 'desc' });
    const filtered = queryActiveUsers('us-production', { offset: 0, limit: 200, q: 'henry@example', sortBy: 'login', sortDir: 'desc' });

    expect(firstPage).toMatchObject({ total: 3, snapshotCount: 3, hasMore: true });
    expect(firstPage?.users.map((user) => user.displayName)).toEqual(['Alice Chen', 'Henry Gu']);
    expect(byLastName?.users.map((user) => user.name?.familyName)).toEqual(['Li', 'Gu', 'Chen']);
    expect(filtered?.users.map((user) => user.id)).toEqual(['two']);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it('exports the complete filtered local result instead of a loaded UI page', async () => {
    upstreamFetch.mockResolvedValueOnce(jsonResponse({
      totalResults: 2,
      Resources: [
        { id: 'one', displayName: 'Alice Chen', name: { givenName: 'Alice', familyName: 'Chen' }, userName: 'alice@example.com' },
        { id: 'two', displayName: 'Henry Gu', name: { givenName: 'Henry', familyName: 'Gu' }, userName: 'henry@example.com' },
      ],
    }));
    await fetchActiveUsersSnapshot('us-production');

    const csv = activeUsersCsv('us-production', { q: 'henry', sortBy: 'name', sortDir: 'asc' });

    expect(csv.split('\n')[0].trimEnd()).toBe('"Login ID","Employee Number","Name","Preferred Name","First Name","Last Name","Email","Active"');
    expect(csv).toContain('"Henry Gu"');
    expect(csv).toContain('"Henry","Gu"');
    expect(csv).not.toContain('Cost Center');
    expect(csv).not.toContain('Start Date');
    expect(csv).not.toContain('"Alice Chen"');
  });

  it('returns only a 200-row local page from a 100,000-user snapshot', () => {
    const entityId = 'scale-entity';
    const file = join(dataDirectory, entityId, 'identity', 'active-users.json');
    mkdirSync(join(dataDirectory, entityId, 'identity'), { recursive: true });
    const profiles = Array.from({ length: 100000 }, (_, index) => {
      const id = String(index).padStart(6, '0');
      return { id, displayName: `User ${id}`, userName: `user-${id}@example.com` };
    });
    writeFileSync(file, JSON.stringify({
      entityId,
      retrievedAt: '2026-08-29T12:00:00.000Z',
      count: profiles.length,
      pageCount: 1000,
      profiles,
    }));

    const page = queryActiveUsers(entityId, { offset: 400, limit: 200, q: '', sortBy: 'login', sortDir: 'asc' });
    const filtered = queryActiveUsers(entityId, { offset: 0, limit: 200, q: 'user-099999@example.com', sortBy: 'login', sortDir: 'asc' });

    expect(page).toMatchObject({ total: 100000, snapshotCount: 100000, offset: 400, limit: 200, hasMore: true });
    expect(page?.users).toHaveLength(200);
    expect(filtered?.users.map((user) => user.id)).toEqual(['099999']);
  });

  it('evaluates nested User Profile filters locally', async () => {
    const enterprise = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
    upstreamFetch.mockResolvedValueOnce(jsonResponse({ totalResults: 3, Resources: [
      { id: 'one', userName: 'alice.pt@example.com', displayName: 'Alice', [enterprise]: { employeeNumber: '100', costCenter: 'PT' } },
      { id: 'two', userName: 'bruno.pt@example.com', displayName: 'Bruno', [enterprise]: { employeeNumber: '200', costCenter: 'PT' } },
      { id: 'three', userName: 'carla.de@example.com', displayName: 'Carla', [enterprise]: { employeeNumber: '300', costCenter: 'DE' } },
    ] }));
    await fetchActiveUsersSnapshot('us-production');

    const result = queryActiveUsers('us-production', {
      offset: 0, limit: 200, sortBy: 'login', sortDir: 'asc',
      filters: { id: 'root', kind: 'group', logic: 'and', items: [
        { id: 'country', kind: 'condition', field: 'costCenter', operator: 'eq', value: 'PT' },
        { id: 'employees', kind: 'group', logic: 'or', items: [
          { id: 'one', kind: 'condition', field: 'employee', operator: 'eq', value: '100' },
          { id: 'two', kind: 'condition', field: 'employee', operator: 'eq', value: '200' },
        ] },
      ] },
    });

    expect(result?.users.map((user) => user.id)).toEqual(['one', 'two']);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });
});
