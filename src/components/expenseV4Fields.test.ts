import { describe, expect, it } from 'vitest';
import { expenseV4OnlySections } from './expenseV4Fields';
import type { ExpenseEntry, ExpenseV4 } from '../types';

const V3: ExpenseEntry = {
  ID: 'entry-1',
  ExpenseID: 'exp-uuid-1',
  ExpenseTypeCode: 'HOTEL',
  ExpenseTypeName: 'Hotel',
  TransactionDate: '2026-01-06',
  TransactionAmount: 800,
  TransactionCurrencyCode: 'EUR',
  PostedAmount: 820,
  VendorDescription: 'Hotel Berlin Mitte',
  PaymentTypeName: 'Cash',
  IsPersonal: false,
};

describe('expenseV4OnlySections', () => {
  it('omits v4 fields that duplicate the v3 entry and keeps only additions', () => {
    const v4: ExpenseV4 = {
      expenseId: 'exp-uuid-1', // duplicate of v3 ExpenseID → omitted
      vendorDescription: 'Hotel Berlin Mitte', // duplicate → omitted
      transactionAmount: { value: 800, currencyCode: 'EUR' }, // duplicate → omitted
      businessPurpose: 'Customer visit', // v4-only → kept
      expenseSource: 'CAFE', // v4-only → kept
    };
    const sections = expenseV4OnlySections(V3, v4);
    const labels = sections.flatMap((section) => section.fields.map((field) => field.label));
    expect(labels).toContain('Business purpose');
    expect(labels).toContain('Expense source');
    expect(labels).not.toContain('Vendor');
    expect(labels).not.toContain('Transaction amount');
    expect(labels).not.toContain('Expense UUID');
  });

  it('groups fields into sections and formats money values', () => {
    const v4: ExpenseV4 = {
      businessPurpose: 'Customer visit',
      amountCompanyPaid: { value: 1234.5, currencyCode: 'EUR' },
    };
    const sections = expenseV4OnlySections(V3, v4);
    const transaction = sections.find((section) => section.title === 'Transaction');
    const other = sections.find((section) => section.title === 'Other Expenses v4 fields');
    expect(transaction?.fields).toEqual([{ label: 'Business purpose', value: 'Customer visit' }]);
    expect(other?.fields).toEqual([{ label: 'Amount Company Paid', value: '1,234.50 EUR' }]);
  });

  it('returns no sections when v4 adds nothing over v3', () => {
    const v4: ExpenseV4 = {
      expenseId: 'exp-uuid-1',
      vendorDescription: 'Hotel Berlin Mitte',
      transactionDate: '2026-01-06',
      isPersonal: false,
    };
    expect(expenseV4OnlySections(V3, v4)).toEqual([]);
  });

  it('keeps v4 custom fields that have no v3 counterpart', () => {
    const v4: ExpenseV4 = {
      customData: [
        { id: 'custom7', value: 'Project X' },
        { id: 'custom1', value: 'duplicate' },
      ],
    };
    const entry: ExpenseEntry = { ...V3, Custom1: { Type: 'Text', Value: 'duplicate' } };
    const sections = expenseV4OnlySections(entry, v4);
    const custom = sections.find((section) => section.title === 'Additional custom fields');
    expect(custom?.fields).toEqual([{ label: 'Custom 7', value: 'Project X' }]);
  });

  it('flattens structured sub-objects and allocations', () => {
    const v4: ExpenseV4 = {
      vendor: { name: 'Preferred Vendor GmbH' },
      journey: { outboundDepartureDatetime: '2026-01-06T08:00' },
      allocations: [{ allocationId: 'alloc-1', percentage: 100 }],
    };
    const sections = expenseV4OnlySections(V3, v4);
    const structured = sections.find((section) => section.title === 'Structured data');
    const allocations = sections.find((section) => section.title === 'Allocations');
    expect(structured?.fields.map((f) => f.label)).toEqual(
      expect.arrayContaining(['Vendor · Name', 'Journey · Outbound Departure Datetime']),
    );
    expect(allocations?.fields[0].label).toBe('Allocation 1');
  });
});
