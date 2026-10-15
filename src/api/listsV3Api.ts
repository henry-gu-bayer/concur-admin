import { ListsV3Snapshot } from '../types';
import { entityRequestHeaders } from '../entities/entityStore';

/**
 * Client for the local Lists v3 snapshot served by the backend
 * (`server/concurListsV3.ts`). The UI reads the persisted snapshot and can
 * trigger a fresh paged retrieval from Concur.
 */

export async function getListsV3(): Promise<ListsV3Snapshot> {
  const res = await fetch('/api/local/v3/lists', { headers: entityRequestHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load v3 lists: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ListsV3Snapshot;
}

export async function refreshListsV3(): Promise<ListsV3Snapshot> {
  const res = await fetch('/api/local/v3/lists/refresh', { method: 'POST', headers: entityRequestHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to refresh v3 lists: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ListsV3Snapshot;
}

/** Display name for a v3 list (v3 uses `Name`). */
export function listV3Name(l: { Name?: string; ID: string }): string {
  return (l.Name ?? l.ID).trim();
}
