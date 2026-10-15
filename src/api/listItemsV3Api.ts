import { ItemsV3Index, ItemsV3Progress, ListItemsV3Snapshot } from '../types';
import { entityRequestHeaders } from '../entities/entityStore';

/**
 * Client for the local List Items v3 snapshots served by the backend
 * (`server/concurListItemsV3.ts`). The UI reads a per-list snapshot on demand,
 * can refresh a single list, or stream a bulk retrieval over many lists.
 */

export async function getItemsV3Index(): Promise<ItemsV3Index> {
  const res = await fetch('/api/local/v3/list-items-index', { headers: entityRequestHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load v3 item index: HTTP ${res.status}`);
  return (await res.json()) as ItemsV3Index;
}

export async function getListItemsV3(listId: string): Promise<ListItemsV3Snapshot> {
  const res = await fetch(`/api/local/v3/list-items/${encodeURIComponent(listId)}`, { headers: entityRequestHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load v3 items: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ListItemsV3Snapshot;
}

export async function refreshListItemsV3(listId: string): Promise<ListItemsV3Snapshot> {
  const res = await fetch(`/api/local/v3/list-items/${encodeURIComponent(listId)}/refresh`, {
    method: 'POST',
    headers: entityRequestHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to refresh v3 items: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as ListItemsV3Snapshot;
}

export interface BulkV3Summary {
  total: number;
  succeeded: number;
  failed: number;
  truncated: number;
  skipped: number;
}

/**
 * Start a bulk retrieval over many lists and stream progress events.
 * The server responds with text/event-stream; we parse SSE frames manually so
 * we can POST the list-id set (EventSource only supports GET).
 *
 * Lists whose snapshot already holds the complete tree are skipped unless
 * `force` is set.
 */
export async function fetchAllListItemsV3(
  listIds: string[],
  listNames: Record<string, string>,
  handlers: {
    onProgress?: (p: ItemsV3Progress) => void;
    onDone?: (summary: BulkV3Summary) => void;
    onError?: (message: string) => void;
  },
  options: { force?: boolean } = {}
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/local/v3/list-items/bulk', {
      method: 'POST',
      headers: { ...entityRequestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ listIds, listNames, force: options.force === true }),
      cache: 'no-store',
    });
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    handlers.onError?.(`Bulk v3 retrieval failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
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
    if (eventMatch?.[1] === 'done') handlers.onDone?.(data as BulkV3Summary);
    else handlers.onProgress?.(data as ItemsV3Progress);
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

/** Display label for a v3 item: "(Level1Code) Name" when both exist. */
export function itemV3Label(it: { Level1Code?: string; Name?: string; ID: string }): string {
  const code = (it.Level1Code ?? '').trim();
  const name = (it.Name ?? '').trim();
  if (code && name) return `(${code}) ${name}`;
  return name || code || it.ID;
}
