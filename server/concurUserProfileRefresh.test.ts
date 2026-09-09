import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshUserProfile } from './concurUserProfileRefresh';

const { getServerAccessToken, refreshServerAccessToken, upstreamFetch, logApiCall, logApiCallFailure } = vi.hoisted(() => ({
  getServerAccessToken: vi.fn(),
  refreshServerAccessToken: vi.fn(),
  upstreamFetch: vi.fn(),
  logApiCall: vi.fn(),
  logApiCallFailure: vi.fn(),
}));

vi.mock('./concurAuth', () => ({ getServerAccessToken, refreshServerAccessToken }));
vi.mock('./upstreamFetch', () => ({ upstreamFetch }));
vi.mock('./logger', () => ({ logApiCall, logApiCallFailure }));
vi.mock('./entities', () => ({ createEntityRegistry: () => ({ require: () => ({ baseUrl: 'https://us2.api.concursolutions.com' }) }) }));

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { forEach: (callback: (value: string, key: string) => void) => callback('application/json', 'content-type') },
  };
}

let dataDirectory: string;
const userId = '55b626dd-66a4-4722-af6d-d855ca8ded6c';

beforeEach(() => {
  vi.clearAllMocks();
  dataDirectory = mkdtempSync(join(tmpdir(), 'concur-user-profile-refresh-'));
  vi.stubEnv('DATA_DIR', dataDirectory);
  getServerAccessToken.mockResolvedValue('server-token');
  refreshServerAccessToken.mockResolvedValue('refreshed-token');
});

afterEach(() => {
  rmSync(dataDirectory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('refreshUserProfile', () => {
  it('refreshes all three resources in parallel and only rewrites the detail snapshot when values change', async () => {
    const identity = { id: userId, userName: 'henry@example.com', meta: { lastModified: '2026-09-08T08:30:00Z' } };
    const spend = { id: userId, 'urn:ietf:params:scim:schemas:extension:spend:2.0:User': { country: 'CN' } };
    const travel = { id: userId, 'urn:ietf:params:scim:schemas:extension:travel:2.0:User': { eReceiptOptIn: true } };
    upstreamFetch.mockResolvedValueOnce(jsonResponse(identity)).mockResolvedValueOnce(jsonResponse(spend)).mockResolvedValueOnce(jsonResponse(travel));

    await expect(refreshUserProfile('us-uat', userId)).resolves.toMatchObject({ identity, spend, travel, errors: {}, snapshotUpdated: true });
    expect(upstreamFetch.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
      expect.stringContaining(`/profile/identity/v4.1/Users/${userId}`),
      expect.stringContaining(`/profile/spend/v4.1/Users/${userId}`),
      expect.stringContaining(`/travel/v4/Users/${userId}`),
    ]));

    upstreamFetch.mockResolvedValueOnce(jsonResponse(identity)).mockResolvedValueOnce(jsonResponse(spend)).mockResolvedValueOnce(jsonResponse(travel));
    await expect(refreshUserProfile('us-uat', userId)).resolves.toMatchObject({ snapshotUpdated: false });

    const changedIdentity = { ...identity, displayName: 'Henry Gu' };
    upstreamFetch.mockResolvedValueOnce(jsonResponse(changedIdentity)).mockResolvedValueOnce(jsonResponse(spend)).mockResolvedValueOnce(jsonResponse(travel));
    await expect(refreshUserProfile('us-uat', userId)).resolves.toMatchObject({ snapshotUpdated: true });
    const saved = JSON.parse(readFileSync(join(dataDirectory, 'us-uat', 'identity', 'refreshed-user-profiles.json'), 'utf-8'));
    expect(saved.profiles[userId].identity).toEqual(changedIdentity);
  });
});
