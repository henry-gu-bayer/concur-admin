import { FormsProgress, FormsRefreshSummary, FormsSnapshot } from '../types';
import { entityRequestHeaders } from '../entities/entityStore';

/**
 * Client for the local Forms & Fields snapshot (`server/concurForms.ts`).
 * The snapshot is only ever re-created by an explicit refresh — viewing the
 * page never calls Concur.
 */

/** Read the cached snapshot, or null when nothing has been fetched yet. */
export async function getFormsSnapshot(): Promise<FormsSnapshot | null> {
  const res = await fetch('/api/local/forms', { headers: entityRequestHeaders(), cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load forms: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as FormsSnapshot;
}

/**
 * Re-crawl form types → forms → fields from Concur, streaming progress.
 * The server responds with text/event-stream; we parse SSE frames manually
 * so we can POST (EventSource only supports GET).
 */
export async function refreshForms(handlers: {
  onProgress?: (p: FormsProgress) => void;
  onDone?: (summary: FormsRefreshSummary) => void;
  onError?: (message: string) => void;
}): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/local/forms/refresh', {
      method: 'POST',
      headers: entityRequestHeaders(),
      cache: 'no-store',
    });
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    handlers.onError?.(`Forms refresh failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
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
    if (eventMatch?.[1] === 'done') handlers.onDone?.(data as FormsRefreshSummary);
    else handlers.onProgress?.(data as FormsProgress);
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
