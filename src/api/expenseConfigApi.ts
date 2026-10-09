import type { UserExpenseConfig } from '../types';
import { entityRequestHeaders } from '../entities/entityStore';

/**
 * Client for the Expense Configuration (v4) API.
 * Fetches user-scoped configuration by login ID.
 */

/**
 * Retrieve the expense configuration for one user login ID.
 * The backend resolves the login ID to a UUID, fetches all v4 endpoints in parallel,
 * and caches the result locally.
 */
export async function getUserExpenseConfig(loginId: string, refresh = false): Promise<UserExpenseConfig> {
  const q = refresh ? '?refresh=1' : '';
  const res = await fetch(`/api/local/expense-config/user/${encodeURIComponent(loginId.trim())}${q}`, {
    method: 'POST',
    headers: entityRequestHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      const text = await res.text().catch(() => '');
      if (text) message = `${message} — ${text.slice(0, 160)}`;
    }
    throw new Error(message);
  }
  return (await res.json()) as UserExpenseConfig;
}
