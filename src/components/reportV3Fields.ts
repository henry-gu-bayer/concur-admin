import type { ExpenseReport } from '../types';

export interface ReportV3RemainingField {
  key: string;
  label: string;
  value: string;
}

/** Reports v3 properties already represented in the report header or detail sections. */
const DISPLAYED_KEYS = new Set([
  'ID',
  'Name',
  'Total',
  'CurrencyCode',
  'Country',
  'CountrySubdivision',
  'CreateDate',
  'SubmitDate',
  'ProcessingPaymentDate',
  'PaidDate',
  'ReceiptsReceived',
  'UserDefinedDate',
  'LastComment',
  'OwnerLoginID',
  'OwnerName',
  'ApproverLoginID',
  'ApproverName',
  'ApprovalStatusName',
  'PaymentStatusName',
  'LastModifiedDate',
  'PersonalAmount',
  'AmountDueEmployee',
  'AmountDueCompanyCard',
  'TotalClaimedAmount',
  'TotalApprovedAmount',
  'LedgerName',
  'PolicyID',
  'EverSentBack',
]);

/** Transport/navigation values do not describe the report configuration itself. */
const TRANSPORT_KEYS = new Set(['URI', 'WorkflowActionUrl']);

function isCustomFieldKey(key: string): boolean {
  return /^(?:Custom|OrgUnit)\d+$/i.test(key);
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function humanizeKey(key: string): string {
  const words = key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/**
 * Returns non-empty Reports v3 properties that are not already visible in the
 * report detail pane. Unknown response properties are intentionally retained
 * so additions from Concur do not remain hidden.
 */
export function reportV3RemainingFields(report: ExpenseReport): ReportV3RemainingField[] {
  return Object.entries(report as unknown as Record<string, unknown>)
    .flatMap(([key, value]) => {
      if (DISPLAYED_KEYS.has(key) || TRANSPORT_KEYS.has(key) || isCustomFieldKey(key) || !hasValue(value)) {
        return [];
      }
      return [{ key, label: humanizeKey(key), value: formatValue(value) }];
    })
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
}
