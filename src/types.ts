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

/* ── Expense Forms & Form Fields (v1.1, XML) — local snapshot shape ─── */

/** One configured form field (from GET .../Form/{FormId}/Fields). */
export interface FormFieldEntry {
  id?: string;
  label?: string;
  controlType?: string;
  dataType?: string;
  maxLength?: number;
  required?: boolean;
  cols?: number;
  access?: string;
  width?: number;
  custom?: boolean;
  sequence?: number;
}

/** One configured form (from GET .../Forms/{FormCode}); fields filled by the fields crawl. */
export interface FormEntry {
  name: string;
  formId: string;
  fields: FormFieldEntry[];
  /** Set when the fields request failed for this form. */
  error?: string;
}

/** One form type (from GET .../Forms) with its forms. */
export interface FormTypeEntry {
  name: string;
  formCode: string;
  forms: FormEntry[];
  /** Set when the forms request failed for this type. */
  error?: string;
}

/** The local snapshot served by GET /api/local/forms (`data/<entity>/forms.json`). */
export interface FormsSnapshot {
  retrievedAt: string;
  formTypes: FormTypeEntry[];
}

/** SSE progress event from POST /api/local/forms/refresh. */
export interface FormsProgress {
  phase: 'types' | 'form' | 'done-form' | 'type-error';
  /** Total form types discovered (phase 'types'). */
  types?: number;
  /** Forms fully crawled so far (phases 'form'/'done-form'). */
  formsFetched?: number;
  /** Total forms discovered so far. */
  formsTotal?: number;
  /** Current form being crawled. */
  formName?: string;
  formCode?: string;
  error?: string;
}

/** SSE 'done' summary from POST /api/local/forms/refresh. */
export interface FormsRefreshSummary {
  types: number;
  forms: number;
  fields: number;
  failed: number;
  /** Set when the crawl died before completing (e.g. token/types request failed). */
  error?: string;
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

/* ── Identity v4.1 user search and profile ──────────────────────────── */

export type UserSearchCriterion = 'loginId' | 'employeeId' | 'email';

export interface IdentityName {
  formatted?: string;
  givenName?: string;
  familyName?: string;
  middleName?: string | null;
  honorificPrefix?: string | null;
  honorificSuffix?: string | null;
  familyNamePrefix?: string | null;
}

export interface IdentityEmail {
  value?: string;
  type?: string;
  verified?: boolean;
  notifications?: boolean;
}

export interface IdentityPhoneNumber {
  value?: string;
  type?: string;
}

export interface IdentityEnterpriseUser {
  employeeNumber?: string;
  companyId?: string;
  costCenter?: string | null;
  startDate?: string | null;
  terminationDate?: string | null;
}

export interface IdentityAddress {
  type?: string;
  country?: string;
  streetAddress?: string | null;
  locality?: string | null;
  region?: string | null;
  postalCode?: string | null;
}

export interface IdentityLocaleOverrides {
  preferenceEndDayViewHour?: number;
  preferenceFirstDayOfWeek?: string;
  preferenceDateFormat?: string;
  preferenceCurrencySymbolLocation?: string;
  preferenceHourMinuteSeparator?: string;
  preferenceDistance?: string;
  preferenceDefaultCalView?: string;
  preference24Hour?: string;
  preferenceNumberFormat?: string;
  preferenceStartDayViewHour?: number;
  preferenceNegativeCurrencyFormat?: string;
  preferenceNegativeNumberFormat?: string;
}

export interface IdentityMeta {
  resourceType?: string;
  created?: string;
  lastModified?: string;
  version?: number;
  location?: string;
}

export interface IdentityUserSummary {
  id: string;
  userName?: string;
  displayName?: string;
  active?: boolean;
  name?: IdentityName;
  emails?: IdentityEmail[];
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'?: IdentityEnterpriseUser;
}

export interface IdentitySearchResponse {
  schemas?: string[];
  totalResults?: number;
  startIndex?: number;
  itemsPerPage?: number;
  Resources?: IdentityUserSummary[];
}

export interface IdentityUserProfile extends IdentityUserSummary {
  schemas?: string[];
  localeOverrides?: IdentityLocaleOverrides;
  addresses?: IdentityAddress[];
  timezone?: string;
  meta?: IdentityMeta;
  phoneNumbers?: IdentityPhoneNumber[];
  emergencyContacts?: unknown;
  preferredLanguage?: string;
  title?: string | null;
  dateOfBirth?: string | null;
  nickName?: string | null;
}

/* ── Spend User v4.1 profile ────────────────────────────────────────── */

export interface SpendUserReference {
  value?: string;
}

export interface SpendCustomData {
  id?: string;
  value?: string;
  syncGuid?: string;
  href?: string;
}

export interface SpendUserExtension {
  reimbursementCurrency?: string;
  reimbursementType?: string | null;
  ledgerCode?: string;
  country?: string;
  budgetCountryCode?: string | null;
  stateProvince?: string | null;
  locale?: string;
  cashAdvanceAccountCode?: string;
  testEmployee?: boolean;
  nonEmployee?: boolean;
  biManager?: SpendUserReference;
  customData?: SpendCustomData[];
}

export interface SpendApproverEntry {
  approver?: SpendUserReference;
  primary?: boolean;
}

export interface SpendApproverExtension {
  report?: SpendApproverEntry[];
  request?: SpendApproverEntry[];
  cashAdvance?: SpendApproverEntry[];
}

export interface SpendRole {
  roleName?: string;
  roleGroups?: string[];
}

export interface SpendRoleExtension {
  roles?: SpendRole[];
}

export interface SpendUserMeta {
  resourceType?: string;
  created?: string | null;
  lastModified?: string | null;
  location?: string;
  version?: number | null;
}

export interface SpendUserProfile {
  schemas?: string[];
  id: string;
  meta?: SpendUserMeta;
  'urn:ietf:params:scim:schemas:extension:spend:2.0:User'?: SpendUserExtension;
  'urn:ietf:params:scim:schemas:extension:spend:2.0:Approver'?: SpendApproverExtension;
  'urn:ietf:params:scim:schemas:extension:spend:2.0:Role'?: SpendRoleExtension;
}
