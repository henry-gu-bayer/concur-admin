import { ListsSnapshot } from '../types';

/**
 * Client for the local Lists snapshot served by the backend
 * (`server/concurLists.ts`). The UI reads the persisted snapshot and can
 * trigger a fresh paged retrieval from Concur.
 */

export async function getLists(): Promise<ListsSnapshot> {
  const res = await fetch('/api/local/lists', { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load lists: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ListsSnapshot;
}

export async function refreshLists(): Promise<ListsSnapshot> {
  const res = await fetch('/api/local/lists/refresh', { method: 'POST', cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to refresh lists: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ListsSnapshot;
}

/** Display name for a list (LIST v4 uses `value`). */
export function listName(l: { value?: string; displayName?: string; name?: string; id: string }): string {
  return (l.value ?? l.displayName ?? l.name ?? l.id).trim();
}

/** Relative "x ago" from an ISO timestamp. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
