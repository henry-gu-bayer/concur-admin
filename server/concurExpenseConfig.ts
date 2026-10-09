import { join } from 'node:path';
import { getServerAccessToken } from './concurAuth';
import { logApiCall } from './logger';
import { createEntityRegistry } from './entities';
import { upstreamFetch } from './upstreamFetch';
import { readJsonSnapshot, writeJsonSnapshot } from './snapshotFiles';
import { entityDataDirectory } from './entityDataDirectory';
import type {
  UserExpenseConfig,
  ExpenseGroupConfig,
  PolicyConfig,
  ExpenseTypeConfig,
  PaymentTypeConfig,
  AttendeeTypeConfig,
} from '../types';

/**
 * Server-side repository for Expense Configuration (v4).
 *
 * Endpoints:
 * - GET /expenseconfig/v4/users/{userID}/policies
 * - GET /expenseconfig/v4/users/{userID}/policies/{policyId}/expensetypes
 * - GET /expenseconfig/v4/users/{userID}/paymenttypes
 * - GET /expenseconfig/v4/users/{userID}/attendeetypes
 * - GET /expenseconfig/v4/users/{userID}/groupconfigs
 *
 * Flow: login ID → resolve UUID via Identity API → fetch all v4 config in parallel → cache
 */

interface ServerResponse {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function headerMap(headers: { forEach: (cb: (v: string, k: string) => void) => void }): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function dataDirectory(entityId: string): string {
  return entityDataDirectory(entityId);
}

function baseUrl(entityId: string): string {
  return createEntityRegistry().require(entityId).baseUrl;
}

function usersDirectory(entityId: string): string {
  return join(dataDirectory(entityId), 'expense-config-by-user');
}

function userFilePath(entityId: string, loginId: string): string {
  return join(usersDirectory(entityId), `${encodeURIComponent(loginId)}.json`);
}

/** Thrown when the login ID cannot be resolved to a user UUID. */
export class InvalidUserError extends Error {
  constructor(loginId: string, detail?: string) {
    super(`Cannot resolve user "${loginId}"${detail ? `: ${detail}` : ''}`);
    this.name = 'InvalidUserError';
  }
}

/** Read a user's cached configuration, or null if none. */
export function readUserExpenseConfig(entityId: string, loginId: string): UserExpenseConfig | null {
  return readJsonSnapshot<UserExpenseConfig>(userFilePath(entityId, loginId));
}

/**
 * Resolve a login ID to a user UUID using the Identity v4.1 API.
 * Uses SCIM search filter: active eq true and userName eq "{loginId}"
 */
async function resolveUserByLoginId(
  entityId: string,
  loginId: string,
  token: string
): Promise<{ id: string; userName: string; displayName?: string }> {
  const url = `${baseUrl(entityId)}/profile/identity/v4.1/Users/.search`;
  const requestHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const body = {
    schemas: ['urn:ietf:params:scim:api:messages:concur:2.0:SearchRequest'],
    filter: `active eq true and userName eq "${loginId.replace(/"/g, '\\"')}"`,
    attributes: ['id', 'userName', 'displayName'],
  };

  const start = Date.now();
  const res = await upstreamFetch(url, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
  const responseTimeMs = Date.now() - start;
  const text = await res.text();

  logApiCall(entityId, {
    method: 'POST',
    url,
    requestHeaders,
    requestBody: JSON.stringify(body),
    response: { status: res.status, headers: headerMap(res.headers), body: text },
    responseTimeMs,
  });

  if (!res.ok) {
    throw new Error(`Identity user search failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }

  const data = JSON.parse(text) as {
    totalResults?: number;
    Resources?: Array<{ id?: string; userName?: string; displayName?: string }>;
  };

  if (!data.Resources || data.Resources.length === 0) {
    throw new InvalidUserError(loginId, 'user not found');
  }

  // Find exact match (SCIM "sw" may return multiple)
  const exact = data.Resources.find((r) => r.userName === loginId);
  const user = exact ?? data.Resources[0];

  if (!user.id) {
    throw new InvalidUserError(loginId, 'user ID not returned');
  }

  return {
    id: user.id,
    userName: user.userName ?? loginId,
    displayName: user.displayName,
  };
}

/** Generic v4 API fetch helper. */
async function fetchV4<T>(entityId: string, path: string, token: string): Promise<T> {
  const url = `${baseUrl(entityId)}${path}`;
  const requestHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const start = Date.now();
  const res = await upstreamFetch(url, { method: 'GET', headers: requestHeaders });
  const responseTimeMs = Date.now() - start;
  const text = await res.text();

  logApiCall(entityId, {
    method: 'GET',
    url,
    requestHeaders,
    requestBody: '',
    response: { status: res.status, headers: headerMap(res.headers), body: text },
    responseTimeMs,
  });

  if (!res.ok) {
    throw new Error(`Expense config retrieval failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }

  return JSON.parse(text) as T;
}

/** Fetch user's policies. */
async function fetchUserPolicies(entityId: string, userId: string, token: string): Promise<PolicyConfig[]> {
  return fetchV4<PolicyConfig[]>(entityId, `/expenseconfig/v4/users/${userId}/policies`, token);
}

/** Fetch user's payment types. */
async function fetchUserPaymentTypes(entityId: string, userId: string, token: string): Promise<PaymentTypeConfig[]> {
  return fetchV4<PaymentTypeConfig[]>(entityId, `/expenseconfig/v4/users/${userId}/paymenttypes`, token);
}

/** Fetch user's attendee types. */
async function fetchUserAttendeeTypes(entityId: string, userId: string, token: string): Promise<AttendeeTypeConfig[]> {
  return fetchV4<AttendeeTypeConfig[]>(entityId, `/expenseconfig/v4/users/${userId}/attendeetypes`, token);
}

/** Fetch user's group configurations. */
async function fetchUserGroupConfigs(entityId: string, userId: string, token: string): Promise<ExpenseGroupConfig[]> {
  // v4 returns a single object or array; normalize to array
  const result = await fetchV4<ExpenseGroupConfig | ExpenseGroupConfig[]>(
    entityId,
    `/expenseconfig/v4/users/${userId}/groupconfigs`,
    token
  );
  return Array.isArray(result) ? result : [result];
}

/** Fetch expense types for a specific policy. */
async function fetchPolicyExpenseTypes(
  entityId: string,
  userId: string,
  policyId: string,
  token: string
): Promise<ExpenseTypeConfig[]> {
  return fetchV4<ExpenseTypeConfig[]>(
    entityId,
    `/expenseconfig/v4/users/${userId}/policies/${policyId}/expensetypes`,
    token
  );
}

/**
 * Fetch complete user expense configuration: resolve user, fetch all 5 endpoints in parallel.
 * Cache the result locally under data/<entity>/expense-config-by-user/<loginId>.json
 */
export async function fetchUserExpenseConfig(
  entityId: string,
  loginId: string,
  refresh = false
): Promise<UserExpenseConfig> {
  const id = loginId.trim();
  if (!id) throw new InvalidUserError(loginId, 'empty login ID');

  if (!refresh) {
    const cached = readUserExpenseConfig(entityId, id);
    if (cached) return cached;
  }

  const token = await getServerAccessToken(entityId);

  // Step 1: Resolve login ID to UUID
  const user = await resolveUserByLoginId(entityId, id, token);

  // Step 2: Fetch all 4 top-level endpoints in parallel
  const [policies, paymentTypes, attendeeTypes, groups] = await Promise.all([
    fetchUserPolicies(entityId, user.id, token),
    fetchUserPaymentTypes(entityId, user.id, token),
    fetchUserAttendeeTypes(entityId, user.id, token),
    fetchUserGroupConfigs(entityId, user.id, token),
  ]);

  // Step 3: Fetch expense types for each policy in parallel
  const expenseTypesByPolicy: Record<string, ExpenseTypeConfig[]> = {};
  await Promise.all(
    policies.map(async (policy) => {
      try {
        const types = await fetchPolicyExpenseTypes(entityId, user.id, policy.policyId, token);
        expenseTypesByPolicy[policy.policyId] = types;
      } catch (err) {
        // Log but don't fail the whole request if one policy's expense types fail
        console.error(`Failed to fetch expense types for policy ${policy.policyId}:`, err);
        expenseTypesByPolicy[policy.policyId] = [];
      }
    })
  );

  const config: UserExpenseConfig = {
    loginId: id,
    userId: user.id,
    displayName: user.displayName,
    retrievedAt: new Date().toISOString(),
    groups,
    policies,
    expenseTypesByPolicy,
    paymentTypes,
    attendeeTypes,
  };

  writeJsonSnapshot(userFilePath(entityId, id), config, true);
  return config;
}

/**
 * POST /api/local/expense-config/user/{loginId}
 * Return the expense configuration for one user login ID, from the
 * per-user cache when available, else fetched from Concur and cached locally.
 */
export async function handleGetUserExpenseConfig(
  res: ServerResponse,
  entityId: string,
  loginId: string,
  rawQuery: string
): Promise<void> {
  try {
    const refresh = new URLSearchParams(rawQuery).get('refresh') === '1';
    const config = await fetchUserExpenseConfig(entityId, loginId, refresh);
    sendJson(res, 200, config);
  } catch (err) {
    if (err instanceof InvalidUserError) {
      sendJson(res, 404, { error: err.message });
      return;
    }
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
