import type { ExpenseReport, ExpenseReportV4 } from '../types';
import type { ReportFormField } from '../api/reportFormFieldsApi';

export interface HeaderFormValue {
  field: ReportFormField;
  label: string;
  value: string;
  link?: string;
}

const V4_ALIASES: Record<string, string> = {
  HasReceivedReceipts: 'isPaperReceiptsReceived',
  Currency: 'currency',
};

const V3_ALIASES: Record<string, keyof ExpenseReport> = {
  Name: 'Name', ReportId: 'ID', ReportDate: 'UserDefinedDate',
  Comment: 'LastComment', EmpName: 'OwnerName', Policy: 'PolicyID',
  ReportTotal: 'Total', ClaimedAmount: 'TotalClaimedAmount',
  ApprovedAmount: 'TotalApprovedAmount', HasReceivedReceipts: 'ReceiptsReceived',
  ApprovalStatus: 'ApprovalStatusName', PaymentStatus: 'PaymentStatusName',
  Currency: 'CurrencyCode', CountryCode: 'Country', Ledger: 'LedgerName',
};

export function formatFormValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    if (typeof item.value === 'number') {
      const amount = (item.value as number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return typeof item.currencyCode === 'string' ? `${amount} ${item.currencyCode}` : amount;
    }
    if (item.value != null) return formatFormValue(item.value);
    if (typeof item.name === 'string') return item.name;
  }
  return JSON.stringify(value);
}

/** Match configured field IDs to report data, retaining v3 as a fallback when
 * the v4 header is unavailable. Form labels and order always come from Concur. */
export function reportHeaderFormValues(fields: ReportFormField[], report: ExpenseReport, reportV4: ExpenseReportV4 | null, policyName?: string): HeaderFormValue[] {
  return [...fields]
    .sort((a, b) => (a.fieldSequence ?? Infinity) - (b.fieldSequence ?? Infinity))
    .map((field, index) => {
      const id = field.fieldId?.trim() ?? '';
      const label = field.fieldName?.trim() || id || `Field ${index + 1}`;
      const customMatch = /^(Custom|OrgUnit)(\d+)$/i.exec(id);
      const custom = customMatch ? (reportV4?.customData ?? []).find(item => item.id?.toLowerCase() === id.toLowerCase()) : undefined;
      const v3Custom = customMatch ? report[`${customMatch[1].toLowerCase() === 'custom' ? 'Custom' : 'OrgUnit'}${Number(customMatch[2])}`] : undefined;
      const v4Key = V4_ALIASES[id] ?? (id ? `${id.charAt(0).toLowerCase()}${id.slice(1)}` : '');
      const v4Value = custom ? custom.value : reportV4?.[v4Key];
      const v3Key = V3_ALIASES[id] ?? (id in report ? id as keyof ExpenseReport : undefined);
      const v3Value = id === 'Policy' && policyName ? policyName : v3Custom?.Value ?? (v3Key ? report[v3Key] : undefined);
      const raw = v4Value != null && v4Value !== '' ? v4Value : v3Value;
      const link = custom?.listItemUrl?.trim() || (typeof raw === 'string' && /^https?:\/\//i.test(raw) ? raw : undefined);
      return { field, label, value: formatFormValue(raw), ...(link ? { link } : {}) };
    });
}
