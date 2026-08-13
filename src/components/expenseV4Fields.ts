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
  if (typeof value === 'object' && !Array.isArray(value) && 'value' in (value as Record<string, unknown>)) {
    return formatMoney(value as ReportV4Money);
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
  { key: 'expenseTypeCode', label: 'Expense type code', v3Key: 'ExpenseTypeCode' },
  { key: 'expenseTypeName', label: 'Expense type name', v3Key: 'ExpenseTypeName' },
  { key: 'spendCategoryCode', label: 'Spend category code', v3Key: 'SpendCategoryCode' },
  { key: 'spendCategoryName', label: 'Spend category name', v3Key: 'SpendCategoryName' },
  { key: 'locationId', label: 'Location ID', v3Key: 'LocationID' },
  { key: 'locationName', label: 'Location', v3Key: 'LocationName' },
  { key: 'exchangeRate', label: 'Exchange rate', v3Key: 'ExchangeRate' },
  { key: 'businessPurpose', label: 'Business purpose' },
  { key: 'expenseSource', label: 'Expense source' },
];

const AMOUNTS: Candidate[] = [
  { key: 'transactionAmount', label: 'Transaction amount', v3Key: 'TransactionAmount' },
  { key: 'postedAmount', label: 'Posted amount', v3Key: 'PostedAmount' },
  { key: 'approvedAmount', label: 'Approved amount', v3Key: 'ApprovedAmount' },
];

const VENDOR_PAYMENT: Candidate[] = [
  { key: 'vendorDescription', label: 'Vendor', v3Key: 'VendorDescription' },
  { key: 'paymentTypeId', label: 'Payment type ID', v3Key: 'PaymentTypeID' },
  { key: 'paymentTypeName', label: 'Payment type', v3Key: 'PaymentTypeName' },
  { key: 'isPersonal', label: 'Personal', v3Key: 'IsPersonal' },
  { key: 'isBillable', label: 'Billable', v3Key: 'IsBillable' },
  { key: 'isPersonalCardCharge', label: 'Personal card charge' },
  { key: 'receiptImageId', label: 'Receipt image ID', mono: true },
  { key: 'isImageRequired', label: 'Image required' },
];

const FLAGS: Candidate[] = [
  { key: 'hasAttendees', label: 'Has attendees', v3Key: 'HasAttendees' },
  { key: 'hasItemizations', label: 'Has itemizations', v3Key: 'HasItemizations' },
  { key: 'hasComments', label: 'Has comments', v3Key: 'HasComments' },
  { key: 'hasExceptions', label: 'Has exceptions', v3Key: 'HasExceptions' },
  { key: 'lastModifiedDate', label: 'Last modified' },
];

const IDS: Candidate[] = [
  { key: 'expenseId', label: 'Expense UUID', v3Key: 'ExpenseID', mono: true },
  { key: 'reportId', label: 'Report ID', v3Key: 'ReportID', mono: true },
  { key: 'expenseTypeId', label: 'Expense type ID', mono: true },
];

const DUPLICATE_FIELDS: Candidate[] = [
  { key: 'expenseTypeCode', label: 'Expense type code', v3Key: 'ExpenseTypeCode' },
  { key: 'expenseTypeName', label: 'Expense type name', v3Key: 'ExpenseTypeName' },
  { key: 'transactionAmount', label: 'Transaction amount', v3Key: 'TransactionAmount' },
  { key: 'postedAmount', label: 'Posted amount', v3Key: 'PostedAmount' },
  { key: 'approvedAmount', label: 'Approved amount', v3Key: 'ApprovedAmount' },
  { key: 'transactionDate', label: 'Transaction date', v3Key: 'TransactionDate' },
  { key: 'exchangeRate', label: 'Exchange rate', v3Key: 'ExchangeRate' },
  { key: 'vendorDescription', label: 'Vendor', v3Key: 'VendorDescription' },
  { key: 'paymentTypeId', label: 'Payment type ID', v3Key: 'PaymentTypeID' },
  { key: 'paymentTypeName', label: 'Payment type', v3Key: 'PaymentTypeName' },
  { key: 'spendCategoryCode', label: 'Spend category code', v3Key: 'SpendCategoryCode' },
  { key: 'spendCategoryName', label: 'Spend category name', v3Key: 'SpendCategoryName' },
  { key: 'locationId', label: 'Location ID', v3Key: 'LocationID' },
  { key: 'locationName', label: 'Location', v3Key: 'LocationName' },
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

function objectFields(record: Record<string, unknown>, prefix: string): ExpenseV4OnlyField[] {
  return Object.entries(record).flatMap(([key, raw]) => {
    if (key === 'links') return [];
    const value = formatValue(raw);
    return value === null ? [] : [{ label: `${prefix} · ${humanizeV4Key(key)}`, value, mono: /(^ID$|Id$|Uuid$)/.test(key) }];
  });
}

/** Compare Expenses v4 to the Entries v3 payload and return only non-empty additions, grouped. */
export function expenseV4OnlySections(entryV3: ExpenseEntry, expenseV4: ExpenseV4): ExpenseV4OnlySection[] {
  const sections: ExpenseV4OnlySection[] = [
    { title: 'Transaction', fields: fieldsFor(entryV3, expenseV4, TRANSACTION) },
    { title: 'Amounts', fields: fieldsFor(entryV3, expenseV4, AMOUNTS) },
    { title: 'Vendor & payment', fields: fieldsFor(entryV3, expenseV4, VENDOR_PAYMENT) },
    { title: 'Flags & dates', fields: fieldsFor(entryV3, expenseV4, FLAGS) },
    { title: 'Configuration IDs', fields: fieldsFor(entryV3, expenseV4, IDS) },
  ];

  // Structured sub-objects (vendor/location/paymentType/expenseType/journey/tripData) flattened.
  const structured: { record: Record<string, unknown> | null | undefined; prefix: string }[] = [
    { record: expenseV4.vendor as Record<string, unknown> | null | undefined, prefix: 'Vendor' },
    { record: expenseV4.location as Record<string, unknown> | null | undefined, prefix: 'Location' },
    { record: expenseV4.paymentType as Record<string, unknown> | null | undefined, prefix: 'Payment type' },
    { record: expenseV4.expenseType as Record<string, unknown> | null | undefined, prefix: 'Expense type' },
    { record: expenseV4.spendCategory as Record<string, unknown> | null | undefined, prefix: 'Spend category' },
    { record: expenseV4.journey as Record<string, unknown> | null | undefined, prefix: 'Journey' },
    { record: expenseV4.tripData as Record<string, unknown> | null | undefined, prefix: 'Trip data' },
  ];
  const structuredFields = structured.flatMap(({ record, prefix }) => (record ? objectFields(record, prefix) : []));
  sections.push({ title: 'Structured data', fields: structuredFields });

  const allocations = (expenseV4.allocations ?? []).flatMap((allocation, index) => {
    const value = formatValue(allocation);
    return value === null ? [] : [{ label: `Allocation ${index + 1}`, value, mono: false }];
  });
  sections.push({ title: 'Allocations', fields: allocations });

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
  sections.push({ title: 'Additional custom fields', fields: customFields });

  const consumed = new Set<string>([
    ...TRANSACTION, ...AMOUNTS, ...VENDOR_PAYMENT, ...FLAGS, ...IDS, ...DUPLICATE_FIELDS,
  ].map(({ key }) => String(key)));
  ['customData', 'links', 'vendor', 'location', 'paymentType', 'expenseType', 'spendCategory', 'journey', 'tripData', 'allocations']
    .forEach((key) => consumed.add(key));
  const additional = Object.entries(expenseV4).flatMap(([key, raw]) => {
    if (consumed.has(key)) return [];
    const v3Key = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    if (hasValue((entryV3 as unknown as Record<string, unknown>)[key]) || hasValue((entryV3 as unknown as Record<string, unknown>)[v3Key])) return [];
    const value = formatValue(raw);
    return value === null ? [] : [{ label: humanizeV4Key(key), value }];
  });
  sections.push({ title: 'Other Expenses v4 fields', fields: additional });

  return sections.filter((section) => section.fields.length > 0);
}
