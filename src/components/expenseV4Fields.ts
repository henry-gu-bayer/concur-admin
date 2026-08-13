import type { ExpenseEntry, ExpenseV4, ReportV4Money } from '../types';

export interface ExpenseV4OnlyField {
  label: string;
  value: string;
  mono?: boolean;
}

export interface ExpenseV4OnlySection {
  title: string;
  fields: ExpenseV4OnlyField[];
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function formatMoney(value: ReportV4Money | null | undefined): string | null {
  if (!value || value.value === null || value.value === undefined) return null;
  const amount = value.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value.currencyCode ? `${amount} ${value.currencyCode}` : amount;
}

function formatValue(value: unknown): string | null {
  if (!hasValue(value)) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ('operation' in record) {
      const rate = hasValue(record.value) ? String(record.value) : null;
      const operation = hasValue(record.operation) ? String(record.operation) : null;
      return [rate, operation ? `(${operation})` : null].filter(Boolean).join(' ') || null;
    }
    if ('value' in record) return formatMoney(value as ReportV4Money);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type Candidate = {
  key: keyof ExpenseV4;
  label: string;
  v3Key?: keyof ExpenseEntry;
  mono?: boolean;
};

const TRANSACTION: Candidate[] = [
  { key: 'transactionDate', label: 'Transaction date', v3Key: 'TransactionDate' },
  { key: 'businessPurpose', label: 'Business purpose' },
  { key: 'expenseSource', label: 'Expense source' },
  { key: 'ticketNumber', label: 'Ticket number' },
];

const AMOUNTS: Candidate[] = [
  { key: 'transactionAmount', label: 'Transaction amount', v3Key: 'TransactionAmount' },
  { key: 'postedAmount', label: 'Posted amount', v3Key: 'PostedAmount' },
  { key: 'approvedAmount', label: 'Approved amount', v3Key: 'ApprovedAmount' },
  { key: 'claimedAmount', label: 'Claimed amount' },
  { key: 'approverAdjustedAmount', label: 'Approver adjusted amount' },
];

const FLAGS: Candidate[] = [
  { key: 'allocationState', label: 'Allocation state' },
  { key: 'allocationSetId', label: 'Allocation set ID', mono: true },
  { key: 'attendeeCount', label: 'Attendee count' },
  { key: 'hasBlockingExceptions', label: 'Has blocking exceptions' },
  { key: 'hasMissingReceiptDeclaration', label: 'Has missing receipt declaration' },
  { key: 'imageCertificationStatus', label: 'Image certification status' },
  { key: 'isAutoCreated', label: 'Auto created' },
  { key: 'isImageRequired', label: 'Image required' },
  { key: 'isPaperReceiptRequired', label: 'Paper receipt required' },
  { key: 'isPersonalExpense', label: 'Personal expense', v3Key: 'IsPersonal' },
  { key: 'receiptImageId', label: 'Receipt image ID', mono: true },
  { key: 'ereceiptImageId', label: 'E-receipt image ID', mono: true },
  { key: 'budgetAccrualDate', label: 'Budget accrual date' },
  { key: 'authorizationRequestExpenseId', label: 'Authorization request expense ID', mono: true },
];

const LEGACY_DUPLICATES: Candidate[] = [
  { key: 'expenseTypeCode', label: 'Expense type code', v3Key: 'ExpenseTypeCode' },
  { key: 'expenseTypeName', label: 'Expense type name', v3Key: 'ExpenseTypeName' },
  { key: 'spendCategoryCode', label: 'Spend category code', v3Key: 'SpendCategoryCode' },
  { key: 'spendCategoryName', label: 'Spend category name', v3Key: 'SpendCategoryName' },
  { key: 'locationId', label: 'Location ID', v3Key: 'LocationID' },
  { key: 'locationName', label: 'Location', v3Key: 'LocationName' },
  { key: 'vendorDescription', label: 'Vendor', v3Key: 'VendorDescription' },
  { key: 'paymentTypeId', label: 'Payment type ID', v3Key: 'PaymentTypeID' },
  { key: 'paymentTypeName', label: 'Payment type', v3Key: 'PaymentTypeName' },
  { key: 'isPersonal', label: 'Personal', v3Key: 'IsPersonal' },
  { key: 'isBillable', label: 'Billable', v3Key: 'IsBillable' },
  { key: 'hasAttendees', label: 'Has attendees', v3Key: 'HasAttendees' },
  { key: 'hasItemizations', label: 'Has itemizations', v3Key: 'HasItemizations' },
  { key: 'hasComments', label: 'Has comments', v3Key: 'HasComments' },
  { key: 'hasExceptions', label: 'Has exceptions', v3Key: 'HasExceptions' },
  { key: 'expenseId', label: 'Expense UUID', v3Key: 'ExpenseID', mono: true },
  { key: 'reportId', label: 'Report ID', v3Key: 'ReportID', mono: true },
];

function fieldsFor(entryV3: ExpenseEntry, expenseV4: ExpenseV4, candidates: Candidate[]): ExpenseV4OnlyField[] {
  return candidates.flatMap((candidate) => {
    if (candidate.v3Key && hasValue(entryV3[candidate.v3Key])) return [];
    const value = formatValue(expenseV4[candidate.key]);
    return value === null ? [] : [{ label: candidate.label, value, mono: candidate.mono }];
  });
}

function humanizeV4Key(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type StructuredField = { key: string; label: string; v3Key?: keyof ExpenseEntry; mono?: boolean };

function structuredFields(
  entryV3: ExpenseEntry,
  record: Record<string, unknown> | null | undefined,
  prefix: string,
  definitions: StructuredField[],
): ExpenseV4OnlyField[] {
  if (!record) return [];
  return definitions.flatMap(({ key, label, v3Key, mono }) => {
    if (v3Key && hasValue(entryV3[v3Key])) return [];
    const value = formatValue(record[key]);
    return value === null ? [] : [{ label: `${prefix} · ${label}`, value, mono }];
  });
}

function allObjectFields(record: Record<string, unknown> | null | undefined, prefix: string): ExpenseV4OnlyField[] {
  if (!record) return [];
  return Object.entries(record).flatMap(([key, raw]) => {
    if (key === 'links') return [];
    const value = formatValue(raw);
    return value === null ? [] : [{ label: `${prefix} · ${humanizeV4Key(key)}`, value, mono: /(^ID$|Id$|Uuid$)/.test(key) }];
  });
}

/** Compare Expenses v4 to the Entries v3 payload and return only non-empty additions, grouped. */
export function expenseV4OnlySections(entryV3: ExpenseEntry, expenseV4: ExpenseV4): ExpenseV4OnlySection[] {
  const transaction = fieldsFor(entryV3, expenseV4, TRANSACTION);
  const amounts = fieldsFor(entryV3, expenseV4, AMOUNTS);
  if (expenseV4.exchangeRate) {
    if (!hasValue(entryV3.ExchangeRate)) {
      const value = formatValue(expenseV4.exchangeRate);
      if (value) amounts.push({ label: 'Exchange rate', value });
    } else if (hasValue(expenseV4.exchangeRate.operation)) {
      amounts.push({ label: 'Exchange rate operation', value: String(expenseV4.exchangeRate.operation) });
    }
  }

  const sourceIdentifiers = allObjectFields(
    expenseV4.expenseSourceIdentifiers as Record<string, unknown> | null | undefined,
    'Expense source',
  ).filter((field) => !(field.label === 'Expense source · Receipt Image Id' && hasValue(expenseV4.receiptImageId)));
  const transactionStructured = [
    ...structuredFields(entryV3, expenseV4.expenseType as Record<string, unknown> | null | undefined, 'Expense type', [
      { key: 'id', label: 'ID', v3Key: 'ExpenseTypeCode', mono: true },
      { key: 'name', label: 'Name', v3Key: 'ExpenseTypeName' },
      { key: 'code', label: 'Code', v3Key: 'SpendCategoryCode' },
      { key: 'isDeleted', label: 'Is deleted' },
    ]),
    ...structuredFields(entryV3, expenseV4.location as Record<string, unknown> | null | undefined, 'Location', [
      { key: 'id', label: 'ID', v3Key: 'LocationID', mono: true },
      { key: 'name', label: 'Name', v3Key: 'LocationName' },
      { key: 'city', label: 'City' },
      { key: 'countryCode', label: 'Country code', v3Key: 'LocationCountry' },
      { key: 'countrySubDivisionCode', label: 'Country subdivision code', v3Key: 'LocationSubdivision' },
    ]),
    ...allObjectFields(expenseV4.journey, 'Journey'),
    ...allObjectFields(expenseV4.tripData, 'Trip data'),
  ];
  const vendorPayment = [
    ...structuredFields(entryV3, expenseV4.paymentType as Record<string, unknown> | null | undefined, 'Payment type', [
      { key: 'id', label: 'ID', v3Key: 'PaymentTypeID', mono: true },
      { key: 'name', label: 'Name', v3Key: 'PaymentTypeName' },
      { key: 'code', label: 'Code' },
    ]),
    ...structuredFields(entryV3, expenseV4.vendor as Record<string, unknown> | null | undefined, 'Vendor', [
      { key: 'id', label: 'ID', v3Key: 'VendorListItemID', mono: true },
      { key: 'name', label: 'Name', v3Key: 'VendorListItemName' },
      { key: 'description', label: 'Description', v3Key: 'VendorDescription' },
    ]),
  ];
  amounts.push(...allObjectFields(expenseV4.expenseTaxSummary as Record<string, unknown> | null | undefined, 'Tax summary'));
  const controls = [
    ...fieldsFor(entryV3, expenseV4, FLAGS),
    ...allObjectFields(expenseV4.travelAllowance as Record<string, unknown> | null | undefined, 'Travel allowance'),
    ...sourceIdentifiers,
  ];

  const allocations = (expenseV4.allocations ?? []).flatMap((allocation, index) => {
    const value = formatValue(allocation);
    return value === null ? [] : [{ label: `Allocation ${index + 1}`, value }];
  });
  controls.push(...allocations);

  const customFields = (expenseV4.customData ?? []).flatMap((field) => {
    const id = field.id?.trim();
    const value = formatValue(field.value);
    if (!id || value === null) return [];
    const match = /^(custom|orgunit)(\d+)$/i.exec(id);
    const fieldNumber = match ? Number(match[2]) : null;
    const v3Field = match && fieldNumber !== null
      ? match[1].toLowerCase() === 'custom'
        ? entryV3[`Custom${fieldNumber}`]
        : entryV3[`OrgUnit${fieldNumber}`]
      : undefined;
    if (hasValue(v3Field?.Value)) return [];
    const label = match && fieldNumber !== null
      ? `${match[1].toLowerCase() === 'custom' ? 'Custom' : 'Org unit'} ${fieldNumber}`
      : id;
    return [{ label, value }];
  });

  const consumed = new Set<string>([
    ...TRANSACTION, ...AMOUNTS, ...FLAGS, ...LEGACY_DUPLICATES,
  ].map(({ key }) => String(key)));
  [
    'exchangeRate', 'expenseSourceIdentifiers', 'customData', 'links', 'vendor', 'location', 'paymentType', 'expenseType', 'spendCategory',
    'travelAllowance', 'expenseTaxSummary', 'journey', 'tripData', 'allocations',
  ].forEach((key) => consumed.add(key));
  const additional = Object.entries(expenseV4).flatMap(([key, raw]) => {
    if (consumed.has(key)) return [];
    const v3Key = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    const v3 = entryV3 as unknown as Record<string, unknown>;
    if (hasValue(v3[key]) || hasValue(v3[v3Key])) return [];
    const value = formatValue(raw);
    return value === null ? [] : [{ label: humanizeV4Key(key), value }];
  });

  return [
    { title: 'Transaction', fields: [...transaction, ...transactionStructured] },
    { title: 'Amounts', fields: amounts },
    { title: 'Vendor & payment', fields: vendorPayment },
    { title: 'Accounting & controls', fields: controls },
    { title: 'Custom fields', fields: customFields },
    { title: 'Other fields', fields: additional },
  ].filter((section) => section.fields.length > 0);
}
