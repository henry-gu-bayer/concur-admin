import { ExpenseGroupsSnapshot, UserExpenseGroupsData } from '../types';
import { entityRequestHeaders } from '../entities/entityStore';

/**
 * Client for the local Expense Group Configurations snapshot served by the
 * backend (`server/concurExpenseGroups.ts`). The UI reads the persisted
 * snapshot and can trigger a fresh paged retrieval from Concur.
 */

export async function getExpenseGroups(): Promise<ExpenseGroupsSnapshot> {
  const res = await fetch('/api/local/expense-groups', { headers: entityRequestHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load expense groups: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ExpenseGroupsSnapshot;
}

export async function refreshExpenseGroups(): Promise<ExpenseGroupsSnapshot> {
  const res = await fetch('/api/local/expense-groups/refresh', { method: 'POST', headers: entityRequestHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to refresh expense groups: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ExpenseGroupsSnapshot;
}

/**
 * Retrieve the expense group configuration for one user login ID. The backend
 * serves from a per-user cache when present, else fetches from Concur and
 * caches the result locally. Throws with the server's message when the login
 * ID is unknown (404) or the lookup fails.
 */
export async function getUserExpenseGroups(loginId: string, refresh = false): Promise<UserExpenseGroupsData> {
  const q = refresh ? '?refresh=1' : '';
  const res = await fetch(`/api/local/expense-groups/user/${encodeURIComponent(loginId.trim())}${q}`, { method: 'POST', headers: entityRequestHeaders(), cache: 'no-store' });
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
  return (await res.json()) as UserExpenseGroupsData;
}
