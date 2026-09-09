import { join } from 'node:path';
import { getServerAccessToken, refreshServerAccessToken } from './concurAuth';
import { createEntityRegistry } from './entities';
import { entityDataDirectory } from './entityDataDirectory';
import { logApiCall, logApiCallFailure } from './logger';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { upstreamFetch } from './upstreamFetch';

type ProfileKind = 'identity' | 'spend' | 'travel';
type ProfileValue = Record<string, unknown>;

export interface RefreshedUserProfile {
  identity: ProfileValue | null;
  spend: ProfileValue | null;
  travel: ProfileValue | null;
  retrievedAt: string;
}

export interface UserProfileRefreshResult extends RefreshedUserProfile {
  errors: Partial<Record<ProfileKind, string>>;
  snapshotUpdated: boolean;
}

interface RefreshedUserProfilesSnapshot {
  entityId: string;
  profiles: Record<string, RefreshedUserProfile>;
}

interface ServerResponse {
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
}

const PROFILE_PATHS: Record<ProfileKind, string> = {
  identity: '/profile/identity/v4.1/Users',
  spend: '/profile/spend/v4.1/Users',
  travel: '/travel/v4/Users',
};

function snapshotPath(entityId: string): string {
  return join(entityDataDirectory(entityId), 'identity', 'refreshed-user-profiles.json');
}

function headerMap(headers: { forEach: (callback: (value: string, key: string) => void) => void }): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key.toLowerCase()] = value; });
  return result;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function validUserId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error('Invalid user ID');
  return id;
}

function readRefreshedProfiles(entityId: string): RefreshedUserProfilesSnapshot {
  const saved = readJsonSnapshot<RefreshedUserProfilesSnapshot>(snapshotPath(entityId));
  return saved?.entityId === entityId && saved.profiles && typeof saved.profiles === 'object'
    ? saved
    : { entityId, profiles: {} };
}

/** Latest detail-level refresh, intentionally separate from immutable full-snapshot generations. */
export function getRefreshedUserProfile(entityId: string, userId: string): RefreshedUserProfile | null {
  return readRefreshedProfiles(entityId).profiles[userId] ?? null;
}

async function fetchProfile(entityId: string, kind: ProfileKind, userId: string, token: string, retried = false): Promise<ProfileValue> {
  const url = `${createEntityRegistry().require(entityId).baseUrl}${PROFILE_PATHS[kind]}/${encodeURIComponent(userId)}`;
  const requestHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const startedAt = Date.now();
  let response: Awaited<ReturnType<typeof upstreamFetch>>;
  try {
    response = await upstreamFetch(url, { method: 'GET', headers: requestHeaders });
  } catch (error) {
    logApiCallFailure(entityId, {
      method: 'GET', url, requestHeaders, requestBody: '',
      error: error instanceof Error ? error.message : String(error), responseTimeMs: Date.now() - startedAt,
    });
    throw error;
  }
  const text = await response.text();
  logApiCall(entityId, {
    method: 'GET', url, requestHeaders, requestBody: '',
    response: { status: response.status, headers: headerMap(response.headers), body: text },
    responseTimeMs: Date.now() - startedAt,
  });
  if (response.status === 401 && !retried) return fetchProfile(entityId, kind, userId, await refreshServerAccessToken(entityId), true);
  if (!response.ok) throw new Error(`${kind} profile refresh failed: HTTP ${response.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('response was not a profile object');
    return parsed as ProfileValue;
  } catch (error) {
    throw new Error(`${kind} profile refresh returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function refreshUserProfile(entityId: string, rawUserId: string): Promise<UserProfileRefreshResult> {
  const userId = validUserId(rawUserId);
  const token = await getServerAccessToken(entityId);
  const requests = (Object.keys(PROFILE_PATHS) as ProfileKind[]).map(async (kind) => [kind, await fetchProfile(entityId, kind, userId, token)] as const);
  const settled = await Promise.allSettled(requests);
  const errors: UserProfileRefreshResult['errors'] = {};
  const values: Partial<Record<ProfileKind, ProfileValue>> = {};
  settled.forEach((result, index) => {
    const kind = (Object.keys(PROFILE_PATHS) as ProfileKind[])[index];
    if (result.status === 'fulfilled') values[result.value[0]] = result.value[1];
    else errors[kind] = result.reason instanceof Error ? result.reason.message : String(result.reason);
  });
  if (!Object.keys(values).length) throw new Error('No profile resource could be refreshed.');

  const retrievedAt = new Date().toISOString();
  const snapshot = readRefreshedProfiles(entityId);
  const current = snapshot.profiles[userId];
  const refreshed: RefreshedUserProfile = {
    // Keep a previously refreshed resource when another API returns an error;
    // a partial refresh must never erase the last usable local detail.
    identity: values.identity ?? current?.identity ?? null,
    spend: values.spend ?? current?.spend ?? null,
    travel: values.travel ?? current?.travel ?? null,
    retrievedAt,
  };
  const snapshotUpdated = !current
    || current.identity === null && refreshed.identity !== null
    || current.spend === null && refreshed.spend !== null
    || current.travel === null && refreshed.travel !== null
    || JSON.stringify({ identity: current.identity, spend: current.spend, travel: current.travel }) !== JSON.stringify({ identity: refreshed.identity, spend: refreshed.spend, travel: refreshed.travel });
  if (snapshotUpdated) {
    snapshot.profiles[userId] = refreshed;
    writeJsonSnapshot(snapshotPath(entityId), snapshot);
  }
  return { ...refreshed, errors, snapshotUpdated };
}

export async function handleRefreshUserProfile(response: ServerResponse, entityId: string, userId: string): Promise<void> {
  try {
    sendJson(response, 200, await refreshUserProfile(entityId, userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, message === 'Invalid user ID' ? 400 : 502, { error: message });
  }
}
