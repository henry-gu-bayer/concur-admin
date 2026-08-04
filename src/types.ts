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

/* ── Concur List Items (List Item v4) — live data shape ─────────────── */

/** One Concur list item (stored flat; the UI rebuilds the tree). */
export interface ConcurListItem {
  id: string;
  code?: string;
  shortCode?: string;
  value?: string;
  parentId: string | null;
  level: number;
  hasChildren?: boolean;
  lists?: { id: string; hasChildren?: boolean }[];
  isDeleted?: boolean;
}

/** Per-list snapshot served by GET /api/local/list-items/{listId}. */
export interface ListItemsSnapshot {
  listId: string;
  retrievedAt: string;
  count: number;
  truncated: boolean;
  maxLevel: number;
  items: ConcurListItem[];
}

/** Per-list retrieval status served by GET /api/local/list-items-index. */
export interface ItemsIndexEntry {
  listId: string;
  count: number;
  retrievedAt: string;
  truncated: boolean;
  maxLevel: number;
}

export interface ItemsIndex {
  lists: Record<string, ItemsIndexEntry>;
}

/** SSE progress event from POST /api/local/list-items/bulk. */
export interface ItemsProgress {
  phase: 'list-start' | 'batch' | 'list-done' | 'list-error';
  listId: string;
  listName?: string;
  items: number;
  truncated?: boolean;
  error?: string;
  listIndex?: number;
  listTotal?: number;
}

/* ── Expense Group Configurations (v3) — live data shape ────────────── */

export interface ExpenseType {
  Code?: string;
  Name?: string;
  ExpenseCode?: string;
}

export interface PaymentType {
  ID?: string;
  Name?: string;
  IsDefault?: boolean;
}

export interface Policy {
  ID?: string;
  Name?: string;
  IsDefault?: boolean;
  IsInheritable?: boolean;
  ExpenseTypes?: ExpenseType[];
}

export interface AttendeeType {
  Code?: string;
  Name?: string;
}

export interface CashAdvance {
  WorkflowID?: string;
  Name?: string;
  AllowUserCarryBalance?: boolean;
  AllowUserLinkMultiple?: boolean;
  AllowUserUpdateExchangeRate?: boolean;
}

export interface ExpenseGroupConfiguration {
  ID?: string;
  Name?: string;
  URI?: string;
  AttendeeListFormID?: string;
  AttendeeListFormName?: string;
  AllowUserRegisterYodlee?: boolean;
  AllowUserDigitalTaxInvoice?: boolean;
  CashAdvance?: CashAdvance;
  PaymentTypes?: PaymentType[];
  Policies?: Policy[];
  AttendeeTypes?: AttendeeType[];
}

/** Snapshot served by GET /api/local/expense-groups. */
export interface ExpenseGroupsSnapshot {
  retrievedAt: string;
  count: number;
  groups: ExpenseGroupConfiguration[];
}

/** Per-user snapshot served by GET /api/local/expense-groups/user/{loginId}. */
export interface UserExpenseGroupsData {
  loginId: string;
  retrievedAt: string;
  count: number;
  groups: ExpenseGroupConfiguration[];
}
