import { ConfigItem } from '../types';
import { concurGet } from './concurFetch';

/**
 * Concur retrieval seam.
 *
 * The UI only knows "getting configuration out of Concur" through this client.
 * `realConcurClient` issues authenticated calls via `concurFetch` (which checks
 * token availability before every request and proxies through the backend, so
 * no secret reaches the browser). `mockConcurClient` returns fixture data for
 * UI development — set `VITE_USE_MOCK=true` to force it.
 */

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export interface ConcurList {
  id: string;
  name?: string;
  displayName?: string;
  isDeleted?: boolean;
  levelCount?: number;
  searchCriteria?: string;
}

export interface ConcurClient {
  /** GET /list/v4/lists — all lists in the entity. */
  fetchLists(): Promise<ConcurList[]>;
  /** Future: fetchListItems, fetchExpenseGroups, fetchPolicies, … */
}

export const realConcurClient: ConcurClient = {
  async fetchLists() {
    const data = await concurGet<{ content?: ConcurList[] } | ConcurList[]>('/list/v4/lists');
    return Array.isArray(data) ? data : data.content ?? [];
  },
};

export const mockConcurClient: ConcurClient = {
  async fetchLists() {
    await new Promise((r) => setTimeout(r, 300));
    return [];
  },
};

/** Active client. Mock only when explicitly forced; otherwise real. */
export const concurClient: ConcurClient = USE_MOCK ? mockConcurClient : realConcurClient;

/** Helper for mapping a Concur list record to a table ConfigItem (used later). */
export function listToConfigItem(l: ConcurList): Pick<ConfigItem, 'id' | 'name'> {
  return { id: l.id, name: l.displayName ?? l.name ?? l.id };
}
