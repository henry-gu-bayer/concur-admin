import { describe, expect, it } from 'vitest';
import { reportHeaderFormValues } from './reportHeaderFormValues';

describe('report header form values', () => {
  it('maps configured system IDs to available v4 values and v3 fallbacks', () => {
    const fields = ['Purpose', 'PolKey', 'AmountApproved', 'AmountClaimed', 'DueEmployee', 'DueCompanyCard'].map(fieldId => ({ fieldId }));
    const report = { ID: 'r', PolicyID: 'policy-id', TotalApprovedAmount: 12, TotalClaimedAmount: 13, AmountDueEmployee: 4, AmountDueCompanyCard: 8 };
    const rows = reportHeaderFormValues(fields, report, { businessPurpose: 'Customer visit', approvedAmount: { value: 20, currencyCode: 'USD' } }, 'Travel policy');
    expect(rows.map(row => row.value)).toEqual(['Customer visit', 'Travel policy', '20.00 USD', '13', '4', '8']);
  });

  it.each(['https://example.com', 'https://us.api.concursolutions.com/list/v4/items/item-1'])('preserves URL text %s without implicit API lookup', value => {
    const [row] = reportHeaderFormValues([{ fieldId: 'Custom1' }], { ID: 'r', Custom1: { Value: value } }, null);
    expect(row.value).toBe(value);
    expect(row.link).toBeUndefined();
  });
  it('uses form order and labels while mapping v4, v3, custom, false and zero values', () => {
    const rows = reportHeaderFormValues([
      { fieldId: 'OrgUnit2', fieldName: 'Cost Center', fieldSequence: 3, fieldAccess: 'HD', isRequired: true },
      { fieldId: 'Name', fieldName: 'Report Name', fieldSequence: 1, isRequired: true },
      { fieldId: 'HasReceivedReceipts', fieldName: 'Receipts Received', fieldSequence: 4 },
      { fieldId: 'ReportTotal', fieldName: 'Report Total', fieldSequence: 5 },
      { fieldId: 'Custom4', fieldName: 'Business Reason', fieldSequence: 2 },
      { fieldId: 'Unknown', fieldName: 'Unavailable', fieldSequence: 6 },
    ], { ID: 'r-1', Name: 'V3 name', Custom4: { Value: 'V3 reason' }, OrgUnit2: { Value: 'V3 center' } }, {
      name: 'V4 name', isPaperReceiptsReceived: false, reportTotal: { value: 0, currencyCode: 'USD' },
      customData: [{ id: 'orgUnit2', value: 'item-id', listItemUrl: 'https://us.api.concursolutions.com/list/v4/items/item-id' }],
    });
    expect(rows.map(row => row.label)).toEqual(['Report Name', 'Business Reason', 'Cost Center', 'Receipts Received', 'Report Total', 'Unavailable']);
    expect(rows.map(row => row.value)).toEqual(['V4 name', 'V3 reason', 'item-id', 'false', '0.00 USD', '—']);
    expect(rows[2].link).toBe('https://us.api.concursolutions.com/list/v4/items/item-id');
  });
});
