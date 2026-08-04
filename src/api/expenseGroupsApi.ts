import { ExpenseGroupsSnapshot } from '../types';

/**
 * Client for the local Expense Group Configurations snapshot served by the
 * backend (`server/concurExpenseGroups.ts`). The UI reads the persisted
 * snapshot and can trigger a fresh paged retrieval from Concur.
 */

export async function getExpenseGroups(): Promise<ExpenseGroupsSnapshot> {
  const res = await fetch('/api/local/expense-groups', { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load expense groups: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ExpenseGroupsSnapshot;
}

export async function refreshExpenseGroups(): Promise<ExpenseGroupsSnapshot> {
  const res = await fetch('/api/local/expense-groups/refresh', { method: 'POST', cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to refresh expense groups: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ExpenseGroupsSnapshot;
}
