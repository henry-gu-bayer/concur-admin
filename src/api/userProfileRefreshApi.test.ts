import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshUserProfile } from './userProfileRefreshApi';

afterEach(() => vi.restoreAllMocks());

describe('refreshUserProfile', () => {
  it('uses the local refresh endpoint for one encoded user ID', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      identity: { id: 'user-1' }, spend: null, travel: null, errors: {}, snapshotUpdated: true, retrievedAt: '2026-09-08T08:30:00Z',
    })));

    await expect(refreshUserProfile(' user-1 ')).resolves.toMatchObject({ identity: { id: 'user-1' }, snapshotUpdated: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/local/users/user-1/profile-refresh', expect.objectContaining({ method: 'POST' }));
  });
});
