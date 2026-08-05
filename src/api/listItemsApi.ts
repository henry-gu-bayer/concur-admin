import { ItemsIndex, ItemsProgress, ListItemsSnapshot } from '../types';
import { entityRequestHeaders } from '../entities/entityStore';

/**
 * Client for the local List Items snapshots served by the backend
 * (`server/concurListItems.ts`). The UI reads a per-list snapshot on demand,
 * can refresh a single list, or stream a bulk retrieval over many lists.
 */

export async function getItemsIndex(): Promise<ItemsIndex> {
  const res = await fetch('/api/local/list-items-index', { headers: entityRequestHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load item index: HTTP ${res.status}`);
  return (await res.json()) as ItemsIndex;
}

export async function getListItems(listId: string): Promise<ListItemsSnapshot> {
  const res = await fetch(`/api/local/list-items/${encodeURIComponent(listId)}`, { headers: entityRequestHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load items: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ListItemsSnapshot;
}

export interface ChildrenPage {
  listId: string;
  parent: string | null;
  items: import('../types').ConcurListItem[];
  fromCache: boolean;
}

/**
 * Lazy per-node retrieval. Pass parentId=null for level-1 roots, else the
 * item's id for its direct children. The backend serves from its incremental
 * cache when available, otherwise fetches from Concur and caches the level.
 */
export async function getChildrenLevel(listId: string, parentId: string | null): Promise<ChildrenPage> {
  const q = parentId ? `?parent=${encodeURIComponent(parentId)}` : '';
  const res = await fetch(`/api/local/list-items/${encodeURIComponent(listId)}/children${q}`, { headers: entityRequestHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load children: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ChildrenPage;
}

export async function refreshListItems(listId: string): Promise<ListItemsSnapshot> {
  const res = await fetch(`/api/local/list-items/${encodeURIComponent(listId)}/refresh`, {
    method: 'POST',
    headers: entityRequestHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to refresh items: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ListItemsSnapshot;
}

export interface BulkSummary {
  total: number;
  succeeded: number;
  failed: number;
  truncated: number;
}

/**
 * Start a bulk retrieval over many lists and stream progress events.
 * The server responds with text/event-stream; we parse SSE frames manually so
 * we can POST the list-id set (EventSource only supports GET).
 */
export async function fetchAllListItems(
  listIds: string[],
  listNames: Record<string, string>,
  handlers: {
    onProgress?: (p: ItemsProgress) => void;
    onDone?: (summary: BulkSummary) => void;
    onError?: (message: string) => void;
  }
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/local/list-items/bulk', {
      method: 'POST',
      headers: { ...entityRequestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ listIds, listNames }),
      cache: 'no-store',
    });
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    handlers.onError?.(`Bulk retrieval failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (frame: string) => {
    const eventMatch = frame.match(/^event: (.+)$/m);
    const dataMatch = frame.match(/^data: (.+)$/m);
    if (!dataMatch) return;
    let data: unknown;
    try {
      data = JSON.parse(dataMatch[1]);
    } catch {
      return;
    }
    if (eventMatch?.[1] === 'done') handlers.onDone?.(data as BulkSummary);
    else handlers.onProgress?.(data as ItemsProgress);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        dispatch(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
      }
    }
    if (buffer.trim()) dispatch(buffer);
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : String(e));
  }
}

/** Display label for an item: "(CODE) Value" when both exist. */
export function itemLabel(it: { code?: string; shortCode?: string; value?: string; id: string }): string {
  const code = (it.code ?? it.shortCode ?? '').trim();
  const value = (it.value ?? '').trim();
  if (code && value) return `(${code}) ${value}`;
  return value || code || it.id;
}
