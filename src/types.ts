import { ReactNode } from 'react';

/** Lifecycle state of any Concur configuration object. */
export type ConfigStatus = 'active' | 'inactive';

/** A single configuration object (a list, a policy, an expense type, …). */
export interface ConfigItem {
  id: string;
  name: string;
  summary?: string;
  status: ConfigStatus;
  updatedAt: string;
  row: Record<string, ReactNode>;
  fields: { label: string; value: ReactNode }[];
  children?: { columns: string[]; rows: ReactNode[][] };
}

/** A table column, rendered generically by ConfigTable. */
export interface ColumnDef {
  id: string;
  label: string;
  hideBelow?: 'md' | 'lg' | 'xl';
  align?: 'left' | 'right';
}

/**
 * The framework contract. Each Concur configuration feature is ONE descriptor.
 * The Lists category uses a custom renderer (ListsView); other categories use
 * the generic ConfigTable via CategoryBrowser.
 */
export interface CategoryDescriptor {
  id: string;
  label: string;
  group: string;
  description: string;
  icon: ReactNode;
  implemented: boolean;
  columns: ColumnDef[];
  fetchItems: () => Promise<ConfigItem[]>;
}

/* ── Concur Lists (LIST v4) — live data shape ───────────────────────── */

/** One Concur list as returned by LIST v4 (server data file `data/lists.json`). */
export interface ConcurList {
  id: string;
  value?: string;
  name?: string;
  displayName?: string;
  levelCount?: number;
  searchCriteria?: string;
  displayFormat?: string;
  isReadOnly?: boolean;
  isDeleted?: boolean;
  managedBy?: string | null;
  category?: { id: string; type: string };
}

/** The local snapshot served by GET /api/local/lists. */
export interface ListsSnapshot {
  retrievedAt: string;
  count: number;
  lists: ConcurList[];
}
