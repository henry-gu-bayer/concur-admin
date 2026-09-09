import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { getServerAccessToken, refreshServerAccessToken, upstreamFetch, logApiCall, logApiCallFailure } = vi.hoisted(() => ({
  getServerAccessToken: vi.fn(), refreshServerAccessToken: vi.fn(), upstreamFetch: vi.fn(), logApiCall: vi.fn(), logApiCallFailure: vi.fn(),
}));

vi.mock('./concurAuth', () => ({ getServerAccessToken, refreshServerAccessToken }));
vi.mock('./upstreamFetch', () => ({ upstreamFetch }));
vi.mock('./logger', () => ({ logApiCall, logApiCallFailure }));

import { queryTravelProfiles, getTravelProfileDetail, readTravelProfilesSummary } from './concurTravelProfiles';
import { writeJsonSnapshot } from './snapshotFiles';

const enterpriseSchema = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const travelSchema = 'urn:ietf:params:scim:schemas:extension:travel:2.0:User';
let dataDirectory = '';

beforeEach(() => {
  dataDirectory = mkdtempSync(join(tmpdir(), 'concur-travel-profiles-'));
  process.env.DATA_DIR = dataDirectory;
  process.env.CONCUR_ENTITIES = 'us-uat';
  process.env.CONCUR_US_UAT_BASE_URL = 'https://us-uat.example.test';
  process.env.CONCUR_US_UAT_CLIENT_ID = 'client-id';
  process.env.CONCUR_US_UAT_CLIENT_SECRET = 'client-secret';
  process.env.CONCUR_US_UAT_REFRESH_TOKEN = 'refresh-token';
  getServerAccessToken.mockReset(); getServerAccessToken.mockResolvedValue('server-token');
  refreshServerAccessToken.mockReset(); refreshServerAccessToken.mockResolvedValue('refreshed-token');
  upstreamFetch.mockReset(); logApiCall.mockReset(); logApiCallFailure.mockReset();
  writeJsonSnapshot(join(dataDirectory, 'us-uat', 'identity', 'active-users.json'), {
    entityId: 'us-uat', retrievedAt: '2026-09-08T00:00:00.000Z', count: 2, pageCount: 1,
    profiles: [
      { id: 'user-one', userName: 'sofia@example.com', preferredName: 'Sofia Martins', emails: [{ type: 'work', value: 'sofia@example.com' }], [enterpriseSchema]: { employeeNumber: '10001' } },
      { id: 'user-two', userName: 'alex@example.com', preferredName: 'Alex Chen', emails: [{ type: 'work', value: 'alex@example.com' }], [enterpriseSchema]: { employeeNumber: '10002' } },
    ],
  });
  writeJsonSnapshot(join(dataDirectory, 'us-uat', 'identity', 'travel-profiles.json'), {
    entityId: 'us-uat', retrievedAt: '2026-09-08T01:00:00.000Z', count: 2, pageCount: 1,
    profiles: [
      { id: 'USER-ONE', [travelSchema]: { eReceiptOptIn: true, ruleClass: { id: 'RULE-EXEC', name: 'Executive' }, manager: { value: 'user-two' }, name: { givenName: 'Sofia', middleName: 'Marie', familyName: 'Martins' }, customFields: [{ name: 'Travel Region', value: 'EMEA' }] } },
      { id: 'USER-TWO', [travelSchema]: { eReceiptOptIn: false, ruleClass: { name: 'Standard' }, customFields: [{ name: 'Travel Region', value: 'APAC' }] } },
    ],
  });
});

afterEach(() => { rmSync(dataDirectory, { recursive: true, force: true }); });

describe('Travel Profiles local snapshot', () => {
  it('joins Travel Profiles with the saved User Profiles and filters them locally', async () => {
    const result = await queryTravelProfiles('us-uat', {
      offset: 0, limit: 200, sortBy: 'loginId', sortDir: 'asc', includeOrphans: false,
      filters: { id: 'root', kind: 'group', logic: 'and', items: [{ id: 'region', kind: 'condition', field: 'Travel Region', operator: 'eq', value: 'EMEA' }] },
    });

    expect(result).toMatchObject({ total: 1, snapshotCount: 2 });
    expect(result?.rows[0]).toMatchObject({ id: 'USER-ONE', loginId: 'sofia@example.com', employeeNumber: '10001' });
    expect(result?.rows[0].values).toMatchObject({
      eReceiptOptIn: 'true', 'Travel Region': 'EMEA', ruleClassName: 'Executive', ruleClassId: 'RULE-EXEC',
      managerLoginId: 'alex@example.com', givenName: 'Sofia', middleName: 'Marie', familyName: 'Martins',
    });
  });

  it('derives the summary fields and returns a matching local detail', () => {
    writeJsonSnapshot(join(dataDirectory, 'us-uat', 'identity', 'travel-profiles-summary.json'), {
      entityId: 'us-uat', retrievedAt: '2026-09-08T01:00:00.000Z', count: 2, pageCount: 1, identityCount: 2,
      travelFields: ['ruleClass', 'manager', 'name'], customFields: [],
    });
    const summary = readTravelProfilesSummary('us-uat');
    expect(summary).toMatchObject({ count: 2, travelFields: expect.arrayContaining(['eReceiptOptIn', 'ruleClassName', 'ruleClassId', 'managerLoginId', 'givenName', 'middleName', 'familyName']), customFields: ['Travel Region'] });
    expect(summary?.travelFields).not.toEqual(expect.arrayContaining(['ruleClass', 'manager', 'name']));
    expect(existsSync(join(dataDirectory, 'us-uat', 'identity', 'travel-profiles-summary.json'))).toBe(true);
    expect(getTravelProfileDetail('us-uat', 'USER-ONE')).toMatchObject({ identity: { userName: 'sofia@example.com' }, travel: { id: 'USER-ONE' } });
  });

  it('uses Identity v4.1 for a manager whose saved User Profile has no login ID', async () => {
    writeJsonSnapshot(join(dataDirectory, 'us-uat', 'identity', 'travel-profiles.json'), {
      entityId: 'us-uat', retrievedAt: '2026-09-08T02:00:00.000Z', count: 1, pageCount: 1,
      profiles: [{ id: 'USER-ONE', [travelSchema]: { manager: { value: 'missing-manager' } } }],
    });
    upstreamFetch.mockResolvedValue({
      status: 200, ok: true, text: () => Promise.resolve(JSON.stringify({ id: 'missing-manager', userName: 'manager@example.com' })),
      headers: { forEach: (callback: (value: string, key: string) => void) => callback('application/json', 'content-type') },
    });

    const result = await queryTravelProfiles('us-uat', {
      offset: 0, limit: 200, sortBy: 'loginId', sortDir: 'asc', includeOrphans: false,
      filters: { id: 'root', kind: 'group', logic: 'and', items: [] },
    });

    expect(result?.rows[0].values.managerLoginId).toBe('manager@example.com');
    expect(upstreamFetch).toHaveBeenCalledWith(
      'https://us-uat.example.test/profile/identity/v4.1/Users/missing-manager',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
