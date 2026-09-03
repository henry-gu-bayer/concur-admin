import { describe, expect, it } from 'vitest';
import type { ExpenseReport } from '../types';
import { reportV3RemainingFields } from './reportV3Fields';

describe('reportV3RemainingFields', () => {
  it('returns non-empty fields not already displayed, in label order', () => {
    const report = {
      ID: 'rpt-1',
      Name: 'Berlin trip',
      OwnerName: 'Jane Doe',
      ApprovalStatusName: 'Approved',
      ApprovalStatusCode: 'A_APPR',
      HasException: false,
      NewServerField: 'new value',
      URI: 'https://example.test/report/rpt-1',
      WorkflowActionUrl: 'https://example.test/workflow',
      Custom1: { Value: 'Already shown' },
      OrgUnit1: { Value: 'Already shown' },
      EmptyText: '   ',
      EmptyArray: [],
      NullValue: null,
    } as ExpenseReport & Record<string, unknown>;

    expect(reportV3RemainingFields(report)).toEqual([
      { key: 'ApprovalStatusCode', label: 'Approval status code', value: 'A_APPR' },
      { key: 'HasException', label: 'Has exception', value: 'No' },
      { key: 'NewServerField', label: 'New server field', value: 'new value' },
    ]);
  });

  it('formats numbers, objects, and non-empty arrays', () => {
    const report = {
      ID: 'rpt-1',
      AdditionalCount: 0,
      AdditionalObject: { code: 'DE', active: true },
      AdditionalValues: ['one', 'two'],
    } as ExpenseReport & Record<string, unknown>;

    expect(reportV3RemainingFields(report)).toEqual([
      { key: 'AdditionalCount', label: 'Additional count', value: '0' },
      { key: 'AdditionalObject', label: 'Additional object', value: '{"code":"DE","active":true}' },
      { key: 'AdditionalValues', label: 'Additional values', value: '["one","two"]' },
    ]);
  });

  it('excludes every v3 key already represented in report details', () => {
    const report: ExpenseReport = {
      ID: 'rpt-1',
      Name: 'Berlin trip',
      Total: 100,
      CurrencyCode: 'EUR',
      Country: 'DE',
      CountrySubdivision: 'DE-BE',
      CreateDate: '2026-01-01',
      SubmitDate: '2026-01-02',
      ProcessingPaymentDate: '2026-01-03',
      PaidDate: '2026-01-04',
      ReceiptsReceived: true,
      UserDefinedDate: '2026-01-05',
      LastComment: 'Reviewed',
      OwnerLoginID: 'jane@example.com',
      OwnerName: 'Jane Doe',
      ApproverLoginID: 'manager@example.com',
      ApproverName: 'Manager',
      ApprovalStatusName: 'Approved',
      PaymentStatusName: 'Paid',
      LastModifiedDate: '2026-01-06',
      PersonalAmount: 0,
      AmountDueEmployee: 10,
      AmountDueCompanyCard: 90,
      TotalClaimedAmount: 100,
      TotalApprovedAmount: 100,
      LedgerName: 'EU',
      PolicyID: 'policy-1',
      EverSentBack: false,
    };

    expect(reportV3RemainingFields(report)).toEqual([]);
  });
});
