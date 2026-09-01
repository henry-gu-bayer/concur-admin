import { ReactNode } from 'react';

/**
 * The category registry owns navigation metadata and the view renderer. Adding
 * a feature requires one descriptor rather than another App-level route branch.
 */
export interface CategoryDescriptor {
  id: string;
  label: string;
  group: string;
  description: string;
  icon: ReactNode;
  render: (context: { entityId: string }) => ReactNode;
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
  complete?: boolean;
  failedChildren?: { parentId: string; error: string }[];
}

/** Per-list retrieval status served by GET /api/local/list-items-index. */
export interface ItemsIndexEntry {
  listId: string;
  count: number;
  retrievedAt: string;
  truncated: boolean;
  maxLevel: number;
  complete?: boolean;
  failedChildren?: number;
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
  City?: string;
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
  /** Localities v5 code matched through names[].id === LocationNameId. */
  LocCode?: string;
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
  /** Present when a country-scoped disk snapshot served the query. */
  source?: 'cache' | 'concur';
  snapshotCountry?: string;
  snapshotAt?: string;
  snapshotStale?: boolean;
  snapshotComplete?: boolean;
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
  /** Only reports containing at least one expense entry with this expense type code. */
  expenseTypeCode?: string;
  /** true = only reports with receipt images; false = only reports without. */
  hasImages?: boolean;
  /** true = only reports whose entries have attendees; false = only reports without. */
  hasAttendees?: boolean;
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

export interface IdentityV4UserSummary {
  id?: string;
  userName?: string;
}

export interface IdentityV4SearchResponse {
  totalResults?: number;
  Resources?: IdentityV4UserSummary[];
}

export interface ReportV4Money {
  value?: number | null;
  currencyCode?: string | null;
}

export interface ReportV4CustomData {
  id?: string;
  value?: unknown;
  isValid?: boolean | null;
  listItemUrl?: string | null;
}

export interface ExpenseV4ExchangeRate {
  value?: number | null;
  operation?: string | null;
}

export interface ExpenseV4Reference {
  id?: string | null;
  name?: string | null;
  code?: string | null;
  isDeleted?: boolean | null;
}

export interface ExpenseV4Location extends ExpenseV4Reference {
  city?: string | null;
  countryCode?: string | null;
  countrySubDivisionCode?: string | null;
}

export interface ExpenseV4TravelAllowance {
  dailyLimitAmount?: ReportV4Money | null;
  dailyTravelAllowanceId?: string | null;
  isExpensePartOfTravelAllowance?: boolean | null;
}

export interface ExpenseV4TaxSummary {
  baseTaxAmount?: ReportV4Money | null;
  baseTaxReclaimAmount?: ReportV4Money | null;
  baseTaxReclaimAdjustedAmount?: ReportV4Money | null;
  postedTaxAmount?: ReportV4Money | null;
  postedTaxReclaimAmount?: ReportV4Money | null;
  postedTaxReclaimAdjustedAmount?: ReportV4Money | null;
  transactionTaxAmount?: ReportV4Money | null;
  transactionTaxReclaimAmount?: ReportV4Money | null;
  transactionTaxReclaimAdjustedAmount?: ReportV4Money | null;
  [key: string]: unknown;
}

/** Report-header exception returned by Expense Exceptions v4. */
export interface ReportExceptionV4 {
  exceptionCode?: string | null;
  exceptionVisibility?: string | null;
  isBlocking?: boolean | null;
  message?: string | null;
  allocationId?: string | null;
  expenseId?: string | null;
  parentExpenseId?: string | null;
  [key: string]: unknown;
}

export interface ReportCommentEmployeeV4 {
  employeeId?: string | null;
  employeeUuid?: string | null;
}

/** Report-header comment returned by Expense Comments v4. */
export interface ReportCommentV4 {
  comment?: string | null;
  author?: ReportCommentEmployeeV4 | null;
  createdForEmployee?: ReportCommentEmployeeV4 | null;
  createdForEmployeeId?: string | null;
  creationDate?: string | null;
  expenseId?: string | null;
  isAuditorComment?: boolean | null;
  isLatest?: boolean | null;
  stepInstanceId?: string | null;
  [key: string]: unknown;
}

export interface ExpenseAttendeeAssociationV4 {
  attendeeId?: string | null;
  customData?: ReportV4CustomData[] | null;
  isAmountUserEdited?: boolean | null;
  isTraveling?: boolean | null;
  associatedAttendeeCount?: number | null;
  versionNumber?: number | null;
  transactionAmount?: ReportV4Money | null;
  approvedAmount?: ReportV4Money | null;
  [key: string]: unknown;
}

export interface ExpenseAttendeeAssociationsV4 {
  noShowAttendeeCount?: number | null;
  expenseAttendeeList?: ExpenseAttendeeAssociationV4[] | null;
}

export interface AttendeeV4CustomField {
  code?: string | null;
  listItemId?: string | null;
  type?: string | null;
  value?: string | null;
}

export interface AttendeeV4 {
  id?: string | null;
  attendeeTypeCode?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  middleInitial?: string | null;
  preferredName?: string | null;
  suffix?: string | null;
  company?: string | null;
  title?: string | null;
  externalId?: string | null;
  hasExceptionsPrevYear?: boolean | null;
  hasExceptionsYtd?: boolean | null;
  totalAmountPrevYear?: number | null;
  totalAmountYtd?: number | null;
  versionNumber?: number | null;
  ownerName?: string | null;
  ownerUserId?: string | null;
  currencyCode?: string | null;
  uri?: string | null;
  [key: `custom${number}`]: AttendeeV4CustomField | undefined;
}

export interface ExpenseAttendeeV4 extends AttendeeV4 {
  association: ExpenseAttendeeAssociationV4;
}

/** One expense returned by Expenses v4. Unknown future fields are retained. */
export interface ExpenseV4 {
  allocations?: unknown[] | null;
  allocationSetId?: string | null;
  allocationState?: string | null;
  approverAdjustedAmount?: ReportV4Money | null;
  approvedAmount?: ReportV4Money | null;
  attendeeCount?: number | null;
  authorizationRequestExpenseId?: string | null;
  budgetAccrualDate?: string | null;
  businessPurpose?: string | null;
  claimedAmount?: ReportV4Money | null;
  customData?: ReportV4CustomData[] | null;
  ereceiptImageId?: string | null;
  exchangeRate?: ExpenseV4ExchangeRate | null;
  expenseId?: string | null;
  expenseSource?: string | null;
  expenseSourceIdentifiers?: unknown;
  expenseTaxSummary?: ExpenseV4TaxSummary | null;
  expenseType?: ExpenseV4Reference | null;
  expenseTypeCode?: string | null;
  expenseTypeId?: string | null;
  expenseTypeName?: string | null;
  hasAttendees?: boolean | null;
  hasBlockingExceptions?: boolean | null;
  hasComments?: boolean | null;
  hasExceptions?: boolean | null;
  hasItemizations?: boolean | null;
  hasMissingReceiptDeclaration?: boolean | null;
  imageCertificationStatus?: string | null;
  isAutoCreated?: boolean | null;
  isBillable?: boolean | null;
  isImageRequired?: boolean | null;
  isPersonal?: boolean | null;
  isPersonalCardCharge?: boolean | null;
  journey?: Record<string, unknown> | null;
  lastModifiedDate?: string | null;
  isPaperReceiptRequired?: boolean | null;
  isPersonalExpense?: boolean | null;
  location?: ExpenseV4Location | null;
  locationId?: string | null;
  locationName?: string | null;
  paymentType?: ExpenseV4Reference | null;
  paymentTypeId?: string | null;
  paymentTypeName?: string | null;
  postedAmount?: ReportV4Money | null;
  receiptImageId?: string | null;
  reportId?: string | null;
  spendCategory?: { code?: string | null; name?: string | null } | null;
  spendCategoryCode?: string | null;
  spendCategoryName?: string | null;
  ticketNumber?: string | null;
  transactionAmount?: ReportV4Money | null;
  transactionDate?: string | null;
  travelAllowance?: ExpenseV4TravelAllowance | null;
  tripData?: Record<string, unknown> | null;
  vendor?: { description?: string | null; id?: string | null; name?: string | null } | null;
  vendorDescription?: string | null;
  links?: unknown[] | null;
  [key: string]: unknown;
}

/** Report header returned by Expense Reports v4. Unknown future fields are retained. */
export interface ExpenseReportV4 {
  approvalStatusId?: string | null;
  concurAuditStatus?: string | null;
  customData?: ReportV4CustomData[] | null;
  ledger?: string | null;
  ledgerId?: string | null;
  paymentStatus?: string | null;
  paymentStatusId?: string | null;
  submitDate?: string | null;
  approvedAmount?: ReportV4Money | null;
  claimedAmount?: ReportV4Money | null;
  amountCompanyPaid?: ReportV4Money | null;
  paymentConfirmedAmount?: ReportV4Money | null;
  amountDueCompany?: ReportV4Money | null;
  amountDueCompanyCard?: ReportV4Money | null;
  amountDueEmployee?: ReportV4Money | null;
  personalAmount?: ReportV4Money | null;
  reportTotal?: ReportV4Money | null;
  amountNotApproved?: ReportV4Money | null;
  isFinancialIntegrationEnabled?: boolean | null;
  canReopen?: boolean | null;
  isReopened?: boolean | null;
  isReceiptImageAvailable?: boolean | null;
  isReceiptImageRequired?: boolean | null;
  isPaperReceiptsReceived?: boolean | null;
  reportId?: string | null;
  currency?: string | null;
  currencyCode?: string | null;
  analyticsGroupId?: string | null;
  hierarchyNodeId?: string | null;
  allocationFormId?: string | null;
  reportDate?: string | null;
  reportFormId?: string | null;
  businessPurpose?: string | null;
  countryCode?: string | null;
  countrySubDivisionCode?: string | null;
  policyId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  name?: string | null;
  policy?: string | null;
  country?: string | null;
  userId?: string | null;
  reportType?: string | null;
  redirectFund?: unknown;
  creationDate?: string | null;
  canRecall?: boolean | null;
  reportVersion?: number | null;
  links?: unknown[] | null;
  [key: string]: unknown;
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
  VendorListItemID?: string | null;
  Description?: string | null;
  LocationName?: string | null;
  LocationCountry?: string;
  LocationSubdivision?: string | null;
  LocationID?: string;
  PaymentTypeName?: string;
  PaymentTypeID?: string;
  SpendCategoryCode?: string;
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
  Comment?: string | null;
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

export type UserSearchCriterion = 'loginId' | 'employeeId' | 'email' | 'userId';

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
  preferredName?: string;
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
  nextCursor?: string | null;
  Resources?: IdentityUserSummary[];
}

export interface ActiveUsersSnapshot {
  entityId: string;
  retrievedAt: string;
  count: number;
  pageCount: number;
  profiles: IdentityUserSummary[];
}

export interface ActiveUsersSummary {
  entityId: string;
  retrievedAt: string;
  count: number;
  pageCount: number;
}

export type ActiveUserSortKey = 'id' | 'name' | 'preferredName' | 'firstName' | 'lastName' | 'login' | 'employee' | 'email' | 'active' | 'costCenter' | 'startDate';

export interface ActiveUsersLocalResult {
  users: IdentityUserSummary[];
  total: number;
  snapshotCount: number;
  retrievedAt: string;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export type ActiveUsersProgressState = 'idle' | 'running' | 'complete' | 'error';

export interface ActiveUsersProgress {
  entityId: string;
  state: ActiveUsersProgressState;
  startedAt: string | null;
  updatedAt: string | null;
  retrievedCount: number;
  totalResults: number | null;
  pageCount: number;
  startIndex: number | null;
  itemsPerPage: number;
  percent: number;
  error?: string;
}

export type SpendFilterOperator = 'eq' | 'ne' | 'contains' | 'startsWith' | 'endsWith' | 'empty' | 'notEmpty';

export interface SpendFilterCondition {
  id: string;
  kind: 'condition';
  field: string;
  operator: SpendFilterOperator;
  value: string;
}

export interface SpendFilterGroup {
  id: string;
  kind: 'group';
  logic: 'and' | 'or';
  items: Array<SpendFilterCondition | SpendFilterGroup>;
}

export interface SpendProfilesSummary {
  entityId: string;
  retrievedAt: string;
  count: number;
  pageCount: number;
  identityCount: number;
  identityGeneration?: string;
  identityStale?: boolean;
  spendFields: string[];
  customFields: string[];
}

export interface SpendProfilesProgress {
  entityId: string;
  state: ActiveUsersProgressState;
  startedAt: string | null;
  updatedAt: string | null;
  retrievedCount: number;
  totalResults: number | null;
  pageCount: number;
  startIndex: number | null;
  itemsPerPage: number;
  percent: number;
  elapsedMs: number;
  error?: string;
}

export interface SpendProfileRow {
  id: string;
  loginId: string;
  employeeNumber: string;
  email: string;
  preferredName: string;
  values: Record<string, string>;
}

export interface SpendProfilesQueryResult {
  rows: SpendProfileRow[];
  total: number;
  snapshotCount: number;
  retrievedAt: string;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface SpendProfileLocalDetail {
  identity: IdentityUserSummary | null;
  spend: SpendUserProfile | null;
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
