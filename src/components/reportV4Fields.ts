import type { ExpenseReport, ExpenseReportV4, ReportV4Money } from '../types';

export interface ReportV4OnlyField {
  label: string;
  value: string;
  mono?: boolean;
}

export interface ReportV4OnlySection {
  title: string;
  fields: ReportV4OnlyField[];
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
  key: keyof ExpenseReportV4;
  label: string;
  v3Key?: keyof ExpenseReport;
  mono?: boolean;
};

const PEOPLE_SCOPE: Candidate[] = [
  { key: 'businessPurpose', label: 'Business purpose' },
  { key: 'reportType', label: 'Report type' },
  { key: 'currency', label: 'Currency', v3Key: 'CurrencyCode' },
  { key: 'country', label: 'Country name', v3Key: 'Country' },
  { key: 'redirectFund', label: 'Redirect fund' },
];

const DATES: Candidate[] = [
  { key: 'reportDate', label: 'Report date', v3Key: 'UserDefinedDate' },
  { key: 'startDate', label: 'Start date' },
  { key: 'endDate', label: 'End date' },
];

const POLICY_WORKFLOW: Candidate[] = [
  { key: 'policy', label: 'Policy name' },
  { key: 'concurAuditStatus', label: 'Concur audit status' },
  { key: 'isFinancialIntegrationEnabled', label: 'Financial integration enabled' },
  { key: 'canReopen', label: 'Can reopen' },
  { key: 'isReopened', label: 'Reopened' },
  { key: 'isReceiptImageAvailable', label: 'Receipt image available' },
  { key: 'isReceiptImageRequired', label: 'Receipt image required' },
  { key: 'isPaperReceiptsReceived', label: 'Paper receipts received', v3Key: 'ReceiptsReceived' },
  { key: 'canRecall', label: 'Can recall' },
  { key: 'reportVersion', label: 'Report version' },
];

const AMOUNTS: Candidate[] = [
  { key: 'amountCompanyPaid', label: 'Company paid' },
  { key: 'paymentConfirmedAmount', label: 'Payment confirmed amount' },
  { key: 'amountDueCompany', label: 'Due company' },
  { key: 'amountNotApproved', label: 'Not approved' },
];

const IDS: Candidate[] = [
  { key: 'ledgerId', label: 'Ledger ID', mono: true },
  { key: 'analyticsGroupId', label: 'Analytics group ID', mono: true },
  { key: 'hierarchyNodeId', label: 'Hierarchy node ID', mono: true },
  { key: 'allocationFormId', label: 'Allocation form ID', mono: true },
  { key: 'reportFormId', label: 'Report form ID', mono: true },
  { key: 'userId', label: 'Owner user ID', mono: true },
];

const DUPLICATE_FIELDS: Candidate[] = [
  { key: 'approvalStatus', label: 'Approval status', v3Key: 'ApprovalStatusName' },
  { key: 'approvalStatusId', label: 'Approval status ID', v3Key: 'ApprovalStatusCode' },
  { key: 'ledger', label: 'Ledger', v3Key: 'LedgerName' },
  { key: 'paymentStatus', label: 'Payment status', v3Key: 'PaymentStatusName' },
  { key: 'paymentStatusId', label: 'Payment status ID', v3Key: 'PaymentStatusCode' },
  { key: 'submitDate', label: 'Submitted', v3Key: 'SubmitDate' },
  { key: 'approvedAmount', label: 'Approved amount', v3Key: 'TotalApprovedAmount' },
  { key: 'claimedAmount', label: 'Claimed amount', v3Key: 'TotalClaimedAmount' },
  { key: 'amountDueCompanyCard', label: 'Due company card', v3Key: 'AmountDueCompanyCard' },
  { key: 'amountDueEmployee', label: 'Due employee', v3Key: 'AmountDueEmployee' },
  { key: 'personalAmount', label: 'Personal amount', v3Key: 'PersonalAmount' },
  { key: 'reportTotal', label: 'Report total', v3Key: 'Total' },
  { key: 'reportId', label: 'Report ID', v3Key: 'ID' },
  { key: 'currencyCode', label: 'Currency code', v3Key: 'CurrencyCode' },
  { key: 'countryCode', label: 'Country code', v3Key: 'Country' },
  { key: 'countrySubDivisionCode', label: 'Country subdivision', v3Key: 'CountrySubdivision' },
  { key: 'policyId', label: 'Policy ID', v3Key: 'PolicyID' },
  { key: 'name', label: 'Name', v3Key: 'Name' },
  { key: 'creationDate', label: 'Created', v3Key: 'CreateDate' },
];

function fieldsFor(reportV3: ExpenseReport, reportV4: ExpenseReportV4, candidates: Candidate[]): ReportV4OnlyField[] {
  return candidates.flatMap((candidate) => {
    if (candidate.v3Key && hasValue(reportV3[candidate.v3Key])) return [];
    const value = formatValue(reportV4[candidate.key]);
    return value === null ? [] : [{ label: candidate.label, value, mono: candidate.mono }];
  });
}

function humanizeV4Key(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Compare Reports v4 to the selected Reports v3 payload and return only non-empty additions. */
export function reportV4OnlySections(reportV3: ExpenseReport, reportV4: ExpenseReportV4): ReportV4OnlySection[] {
  const sections: ReportV4OnlySection[] = [
    { title: 'People & scope', fields: fieldsFor(reportV3, reportV4, PEOPLE_SCOPE) },
    { title: 'Amounts', fields: fieldsFor(reportV3, reportV4, AMOUNTS) },
    { title: 'Policy & workflow', fields: [...fieldsFor(reportV3, reportV4, POLICY_WORKFLOW), ...fieldsFor(reportV3, reportV4, IDS)] },
    { title: 'Dates', fields: fieldsFor(reportV3, reportV4, DATES) },
  ];

  const customFields = (reportV4.customData ?? []).flatMap((field) => {
    const id = field.id?.trim();
    const value = formatValue(field.value);
    if (!id || value === null) return [];
    const match = /^(custom|orgunit)(\d+)$/i.exec(id);
    const fieldNumber = match ? Number(match[2]) : null;
    const v3Field = match && fieldNumber !== null
      ? match[1].toLowerCase() === 'custom'
        ? reportV3[`Custom${fieldNumber}`]
        : reportV3[`OrgUnit${fieldNumber}`]
      : undefined;
    if (hasValue(v3Field?.Value)) return [];
    const label = match && fieldNumber !== null
      ? `${match[1].toLowerCase() === 'custom' ? 'Custom' : 'Org unit'} ${fieldNumber}`
      : id;
    return [{ label, value }];
  });
  sections.push({ title: 'Custom fields', fields: customFields });

  const consumed = new Set<string>([
    ...PEOPLE_SCOPE, ...DATES, ...POLICY_WORKFLOW, ...AMOUNTS, ...IDS, ...DUPLICATE_FIELDS,
  ].map(({ key }) => String(key)));
  consumed.add('customData');
  consumed.add('links');
  const additional = Object.entries(reportV4).flatMap(([key, raw]) => {
    if (consumed.has(key)) return [];
    const v3Key = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    if (hasValue((reportV3 as unknown as Record<string, unknown>)[key]) || hasValue((reportV3 as unknown as Record<string, unknown>)[v3Key])) return [];
    const value = formatValue(raw);
    return value === null ? [] : [{ label: humanizeV4Key(key), value }];
  });
  sections.push({ title: 'Other fields', fields: additional });

  return sections.filter((section) => section.fields.length > 0);
}
