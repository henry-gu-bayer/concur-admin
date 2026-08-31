import type { ConcurList, ItemsIndex, ListsSnapshot } from '../types';
import { createEntitySessionCache } from '../state/entitySessionCache';

export interface ListsViewSession {
  snapshot: ListsSnapshot | null;
  itemsIndex: ItemsIndex | null;
  query: string;
  searchField: 'name' | 'value' | 'code';
  category: string;
  level: string;
  sort: { id: 'name' | 'category' | 'levelCount' | 'displayFormat'; dir: 1 | -1 };
  letter: string | null;
  page: number;
  expandedId: string | null;
  detailList: ConcurList | null;
}

export const listsViewSessions = createEntitySessionCache<ListsViewSession>();

export function resetListsViewSessions(): void {
  listsViewSessions.clear();
}
