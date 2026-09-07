import { describe, expect, it } from 'vitest';
import type { ExpenseReport, ExpenseReportV4 } from '../types';
import { reportV4OnlySections } from './reportV4Fields';

describe('reportV4OnlySections', () => {
  it('groups non-empty v4 additions and keeps explicit workflow status fields', () => {
    const v3: ExpenseReport = {
      ID: 'r1',
      Name: 'Berlin trip',
      Total: 100,
      CurrencyCode: 'EUR',
      ApprovalStatusName: 'Approved',
      Custom1: { Type: 'Text', Value: 'Already in v3' },
      OrgUnit1: { Type: 'List', Value: 'Existing org unit' },
    };
    const v4: ExpenseReportV4 = {
      reportId: 'r1',
      name: 'Berlin trip',
      reportTotal: { value: 100, currencyCode: 'EUR' },
      approvalStatus: 'Approved',
      approvalStatusId: 'APPROVED',
      paymentStatus: 'Not Paid',
      paymentStatusId: 'NOT_PAID',
      reportNumber: 'RPT-2026-0042',
      canAddExpense: false,
      isSubmitted: true,
      isSentBack: false,
      submitterId: 'submitter-uuid',
      businessPurpose: 'Customer workshop',
      canReopen: false,
      amountCompanyPaid: { value: 0, currencyCode: 'EUR' },
      ledgerId: 'ledger-1',
      customData: [
        { id: 'custom1', value: 'Already in v3' },
        { id: 'custom2', value: 'Only in v4' },
        { id: 'custom3', value: null },
        { id: 'orgUnit1', value: 'Existing org unit' },
        { id: 'orgUnit2', value: 'Only v4 org unit' },
      ],
    };

    const sections = reportV4OnlySections(v3, v4);
    const fields = sections.flatMap((section) => section.fields);
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Business purpose', value: 'Customer workshop' }),
      expect.objectContaining({ label: 'Report number', value: 'RPT-2026-0042', mono: true }),
      expect.objectContaining({ label: 'Submitter UUID', value: 'submitter-uuid', mono: true }),
      expect.objectContaining({ label: 'Approval status', value: 'Approved' }),
      expect.objectContaining({ label: 'Approval status ID', value: 'APPROVED', mono: true }),
      expect.objectContaining({ label: 'Payment status', value: 'Not Paid' }),
      expect.objectContaining({ label: 'Payment status ID', value: 'NOT_PAID', mono: true }),
      expect.objectContaining({ label: 'Can add expense', value: 'No' }),
      expect.objectContaining({ label: 'Is submitted', value: 'Yes' }),
      expect.objectContaining({ label: 'Is sent back', value: 'No' }),
      expect.objectContaining({ label: 'Can reopen', value: 'No' }),
      expect.objectContaining({ label: 'Company paid', value: '0.00 EUR' }),
      expect.objectContaining({ label: 'Ledger ID', value: 'ledger-1' }),
      expect.objectContaining({ label: 'Custom 2', value: 'Only in v4' }),
      expect.objectContaining({ label: 'Org unit 2', value: 'Only v4 org unit' }),
    ]));
    expect(fields.some((field) => field.label === 'Name')).toBe(false);
    expect(fields.some((field) => field.label === 'Report total')).toBe(false);
    expect(fields.some((field) => field.label === 'Approval status')).toBe(true);
    expect(fields.some((field) => field.label === 'Custom 1')).toBe(false);
    expect(fields.some((field) => field.label === 'Org unit 1')).toBe(false);
  });

  it('drops null, empty strings, and empty arrays', () => {
    const sections = reportV4OnlySections({ ID: 'r1' }, {
      businessPurpose: '   ',
      startDate: null,
      customData: [],
      links: [],
    });
    expect(sections).toEqual([]);
  });
});
