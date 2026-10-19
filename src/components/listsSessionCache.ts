import type { ConcurList, ItemsIndex, ItemsV3Index, ListsSnapshot, ListsV3Snapshot } from '../types';
import { createEntitySessionCache } from '../state/entitySessionCache';

export interface ListsViewSession {
  snapshot: ListsSnapshot | null;
  itemsIndex: ItemsIndex | null;
  query: string;
  searchField: 'name' | 'value' | 'code' | 'list-id' | 'item-id';
  category: string;
  level: string;
  sort: { id: 'name' | 'category' | 'levelCount' | 'displayFormat'; dir: 1 | -1 };
  letter: string | null;
  page: number;
  expandedId: string | null;
  detailList: ConcurList | null;
  snapshotV3?: ListsV3Snapshot | null;
  itemsV3Index?: ItemsV3Index | null;
}

export const listsViewSessions = createEntitySessionCache<ListsViewSession>();

export function resetListsViewSessions(): void {
  listsViewSessions.clear();
}
