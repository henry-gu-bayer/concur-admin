import type { ReportFormField } from '../api/reportFormFieldsApi';
import type { ExpenseEntry, ExpenseV4 } from '../types';
import type { ConfiguredFieldValue } from './ConfiguredFormFields';
import { formatFormValue } from './reportHeaderFormValues';

const V4_ALIASES: Record<string, (expense: ExpenseV4) => unknown> = {
  ExpName: expense => expense.expenseType?.name ?? expense.expenseTypeName,
  ExpenseType: expense => expense.expenseType?.name ?? expense.expenseTypeName,
  ExpenseTypeName: expense => expense.expenseType?.name ?? expense.expenseTypeName,
  ExpenseTypeCode: expense => expense.expenseType?.id ?? expense.expenseTypeCode,
  TxnDate: expense => expense.transactionDate,
  TxnAmount: expense => expense.transactionAmount,
  Vendor: expense => expense.vendor?.name ?? expense.vendor?.description ?? expense.vendorDescription,
  VendorListId: expense => expense.vendor?.name ?? expense.vendor?.description ?? expense.vendorDescription,
  VendorName: expense => expense.vendor?.name ?? expense.vendor?.description ?? expense.vendorDescription,
  Location: expense => expense.location?.name ?? expense.locationName,
  City: expense => expense.location?.city,
  PaymentType: expense => expense.paymentType?.name ?? expense.paymentTypeName,
  TransactionCurrencyName: expense => expense.transactionCurrencyName ?? expense.transactionAmount?.currencyCode,
  TransactionCurrencyCode: expense => expense.transactionAmount?.currencyCode,
  IsPartOfTravelAllowance: expense => expense.travelAllowance?.isExpensePartOfTravelAllowance,
};

const V3_ALIASES: Record<string, keyof ExpenseEntry> = {
  ExpName: 'ExpenseTypeName', ExpenseType: 'ExpenseTypeName',
  TxnDate: 'TransactionDate', TxnAmount: 'TransactionAmount',
  Vendor: 'VendorDescription', Location: 'LocationName', PaymentType: 'PaymentTypeName',
  VendorListId: 'VendorDescription', VendorName: 'VendorDescription',
  TransactionCurrencyName: 'TransactionCurrencyCode',
  IsPaperReceiptReceived: 'ReceiptReceived', ReceiptType: 'TaxReceiptType',
  City: 'LocationName',
};

function findValue(record: Record<string, unknown>, id: string): unknown {
  const key = Object.keys(record).find(candidate => candidate.toLowerCase() === id.toLowerCase());
  return key ? record[key] : undefined;
}

/** Read values from Expenses v4 first, then Entries v3, in the form's configured order. */
export function expenseFormValues(fields: ReportFormField[], entry: ExpenseEntry, expense: ExpenseV4 | null): ConfiguredFieldValue[] {
  return [...fields]
    .sort((a, b) => (a.fieldSequence ?? Infinity) - (b.fieldSequence ?? Infinity))
    .map((field, index) => {
      const id = field.fieldId?.trim() ?? '';
      const label = field.fieldName?.trim() || id || `Field ${index + 1}`;
      const customMatch = /^(Custom|OrgUnit)(\d+)$/i.exec(id);
      const custom = customMatch ? (expense?.customData ?? []).find(item => item.id?.toLowerCase() === id.toLowerCase()) : undefined;
      const v3Custom = customMatch ? entry[`${customMatch[1].toLowerCase() === 'custom' ? 'Custom' : 'OrgUnit'}${Number(customMatch[2])}`] : undefined;
      const v4Id = id ? `${id.charAt(0).toLowerCase()}${id.slice(1)}` : '';
      const v4Value = custom?.value ?? (expense && (V4_ALIASES[id]?.(expense) ?? findValue(expense, v4Id)));
      const v3Key = V3_ALIASES[id] ?? id;
      const v3Value = v3Custom?.Value ?? findValue(entry as unknown as Record<string, unknown>, v3Key);
      const raw = v4Value != null && v4Value !== '' ? v4Value : v3Value;
      const link = custom?.listItemUrl?.trim() || (typeof raw === 'string' && /^https?:\/\//i.test(raw) ? raw : undefined);
      return { field, label, value: formatFormValue(raw), ...(link ? { link } : {}) };
    });
}
