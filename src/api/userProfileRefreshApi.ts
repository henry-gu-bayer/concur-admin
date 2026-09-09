import type { UserProfileRefreshResult } from '../types';
import { entityRequestHeaders } from '../entities/entityStore';

/** Re-fetches one user's Identity, Spend, and Travel profiles, then updates its local detail snapshot. */
export async function refreshUserProfile(userId: string): Promise<UserProfileRefreshResult> {
  const id = userId.trim();
  if (!id) throw new Error('User ID is required');
  const response = await fetch(`/api/local/users/${encodeURIComponent(id)}/profile-refresh`, {
    method: 'POST',
    headers: entityRequestHeaders(),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({})) as UserProfileRefreshResult & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Profile refresh failed: HTTP ${response.status}`);
  return body;
}
