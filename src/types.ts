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

/* ── Locations v3 (common) — live query shape ───────────────────────── */

/** Combinable query filters for GET /api/v3.0/common/locations. */
export interface LocationQuery {
  /** ISO 3166-1 alpha-2 country code, e.g. 'US'. */
  country?: string;
  /** ISO 3166-2 subdivision code, e.g. 'US-WA'. */
  countrySubdivision?: string;
  city?: string;
  name?: string;
}

/** One location record from Locations v3. */
export interface ConcurLocation {
  ID?: string;
  Name?: string;
  Country?: string;
  CountrySubdivision?: string;
  AdministrativeRegion?: string;
  IATACode?: string;
  IsAirport?: boolean;
  IsBookingTool?: boolean;
  Latitude?: number;
  Longitude?: number;
  URI?: string;
  LocationNameId?: string;
}

/** Paged response envelope from Locations v3. */
export interface LocationsResponse {
  Items?: ConcurLocation[];
  NextPage?: string | null;
}

/** Result of a locations search: first page plus follow-up state. */
export interface LocationSearchResult {
  locations: ConcurLocation[];
  /** True when the server has more pages beyond what was fetched. */
  hasMore: boolean;
}

/* ── Localities v5 (common) — countries, subdivisions, locations ────── */

export interface LocalityLink {
  rel?: string;
  href?: string;
}

export interface LocalityName {
  id?: string;
  name?: string;
  langCode?: string;
  legacyKey?: number;
  active?: boolean;
}

export interface LocalityCurrency {
  code?: string;
}

export interface LocalityCountry {
  code: string;
  active?: boolean;
  numCode?: number;
  alpha3Code?: string;
  distanceUnitCode?: string;
  names?: LocalityName[];
  currencies?: LocalityCurrency[];
  links?: LocalityLink[];
}

export interface LocalitySubdivision {
  code: string;
  active?: boolean;
  names?: LocalityName[];
  countryCode?: string;
  links?: LocalityLink[];
}

export interface LocalityAdministrativeRegion {
  id?: string;
  names?: LocalityName[];
  countryCode?: string;
  subDivCode?: string;
  links?: LocalityLink[];
}

export interface LocalityLocation {
  legacyKey?: number;
  code?: string;
  id?: string;
  timeZoneOffset?: number;
  active?: boolean;
  point?: { latitude?: number; longitude?: number };
  names?: LocalityName[];
  administrativeRegion?: LocalityAdministrativeRegion;
  country?: LocalityCountry;
  subDivision?: LocalitySubdivision;
  links?: LocalityLink[];
}

export interface LocalityCountriesSnapshot {
  retrievedAt: string;
  countries: LocalityCountry[];
}

export interface LocalityCountriesResponse {
  countries?: LocalityCountry[];
}

export interface LocalitySubdivisionsResponse {
  subdivisions?: LocalitySubdivision[];
}

export interface LocalityLocationsResponse {
  locations?: LocalityLocation[];
}

export interface LocalityLocationQuery {
  countryCode?: string;
  subdivisionCode?: string;
  searchText?: string;
  locCode?: string;
}

/* ── Expense Reports v3 + Expense Entries v3 — live query shape ─────── */

/** Combinable query filters for GET /api/v3.0/expense/reports. */
export interface ReportQuery {
  /** Login ID of the report owner; searches all owners when omitted. */
  loginId?: string;
  /** Approval status code, e.g. 'A_PEND'. */
  approvalStatusCode?: string;
  /** Payment status code, e.g. 'P_PAID'. */
  paymentStatusCode?: string;
  /** ISO 3166-1 alpha-2 country code, e.g. 'US'. */
  countryCode?: string;
  /** yyyy-MM-dd lower/upper bounds for the report create date. */
  createdAfter?: string;
  createdBefore?: string;
  /** yyyy-MM-dd lower/upper bounds for the report submit date. */
  submittedAfter?: string;
  submittedBefore?: string;
  /** yyyy-MM-dd lower/upper bounds for the report paid date. */
  paidAfter?: string;
  paidBefore?: string;
}

/** Custom/OrgUnit field value object used by report and entry records. */
export interface ReportCustomField {
  Code?: string;
  ListItemID?: string;
  Type?: string;
  Value?: string;
}

/** One expense report header from Reports v3. */
export interface ExpenseReport {
  ID: string;
  Name?: string;
  Total?: number;
  CurrencyCode?: string;
  Country?: string;
  CountrySubdivision?: string | null;
  CreateDate?: string;
  SubmitDate?: string | null;
  ProcessingPaymentDate?: string | null;
  PaidDate?: string | null;
  ReceiptsReceived?: boolean;
  UserDefinedDate?: string | null;
  LastComment?: string;
  OwnerLoginID?: string;
  OwnerName?: string;
  ApproverLoginID?: string | null;
  ApproverName?: string | null;
  ApprovalStatusName?: string;
  ApprovalStatusCode?: string;
  PaymentStatusName?: string;
  PaymentStatusCode?: string;
  LastModifiedDate?: string;
  PersonalAmount?: number;
  AmountDueEmployee?: number;
  AmountDueCompanyCard?: number;
  TotalClaimedAmount?: number;
  TotalApprovedAmount?: number;
  LedgerName?: string;
  PolicyID?: string;
  EverSentBack?: boolean;
  HasException?: boolean;
  WorkflowActionUrl?: string;
  URI?: string;
  [key: `Custom${number}`]: ReportCustomField | null | undefined;
  [key: `OrgUnit${number}`]: ReportCustomField | null | undefined;
}

/** Paged response envelope from Reports v3. */
export interface ReportsResponse {
  Items?: ExpenseReport[];
  NextPage?: string | null;
}

/** Result of a reports search: fetched reports plus follow-up state. */
export interface ReportSearchResult {
  reports: ExpenseReport[];
  /** True when the server has more pages beyond what was fetched. */
  hasMore: boolean;
}

/** One expense entry from Entries v3. */
export interface ExpenseEntry {
  ID: string;
  ExpenseTypeCode?: string;
  ExpenseTypeName?: string;
  TransactionDate?: string;
  TransactionAmount?: number;
  TransactionCurrencyCode?: string;
  PostedAmount?: number;
  ApprovedAmount?: number;
  ExchangeRate?: number;
  VendorDescription?: string | null;
  VendorListItemName?: string | null;
  Description?: string | null;
  LocationName?: string | null;
  LocationCountry?: string;
  LocationSubdivision?: string | null;
  PaymentTypeName?: string;
  SpendCategoryName?: string;
  IsPersonal?: boolean;
  IsBillable?: boolean;
  HasExceptions?: boolean;
  HasImage?: boolean;
  HasComments?: boolean;
  HasItemizations?: boolean;
  HasAttendees?: boolean;
  HasVAT?: boolean;
  ReceiptReceived?: boolean;
  AllocationType?: string;
  TaxReceiptType?: string;
  FormID?: string;
  ReportID?: string;
  ReportOwnerID?: string;
  LastModified?: string;
  URI?: string;
  ExpenseID?: string;
  [key: `Custom${number}`]: ReportCustomField | null | undefined;
  [key: `OrgUnit${number}`]: ReportCustomField | null | undefined;
}

/** Paged response envelope from Entries v3. */
export interface EntriesResponse {
  Items?: ExpenseEntry[];
  NextPage?: string | null;
}

/** Result of an entries retrieval: fetched entries plus follow-up state. */
export interface EntriesResult {
  entries: ExpenseEntry[];
  /** True when the server has more pages beyond what was fetched. */
  hasMore: boolean;
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
