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
    const other = sections.find((section) => section.title === 'Other fields');
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
    const custom = sections.find((section) => section.title === 'Custom fields');
    expect(custom?.fields).toEqual([{ label: 'Custom 7', value: 'Project X' }]);
  });

  it('flattens structured sub-objects and allocations', () => {
    const v4: ExpenseV4 = {
      vendor: { name: 'Preferred Vendor GmbH' },
      journey: { outboundDepartureDatetime: '2026-01-06T08:00' },
      allocations: [{ allocationId: 'alloc-1', percentage: 100 }],
    };
    const sections = expenseV4OnlySections(V3, v4);
    const vendor = sections.find((section) => section.title === 'Vendor & payment');
    const transaction = sections.find((section) => section.title === 'Transaction');
    const controls = sections.find((section) => section.title === 'Accounting & controls');
    expect(vendor?.fields.map((f) => f.label)).toContain('Vendor · Name');
    expect(transaction?.fields.map((f) => f.label)).toContain('Journey · Outbound Departure Datetime');
    expect(controls?.fields[0].label).toBe('Allocation 1');
  });

  it('compares the official nested v4 references against their v3 equivalents', () => {
    const entry: ExpenseEntry = {
      ...V3,
      ExpenseTypeCode: 'LUNCH',
      ExpenseTypeName: 'Lunch',
      SpendCategoryCode: 'OTHER',
      LocationID: 'loc-1',
      LocationName: 'Berlin',
      LocationCountry: 'DE',
      PaymentTypeID: 'cash-1',
      PaymentTypeName: 'Cash',
      VendorListItemID: 'vendor-1',
      VendorListItemName: 'Cafe Mitte',
    };
    const v4: ExpenseV4 = {
      expenseType: { id: 'LUNCH', name: 'Lunch', code: 'OTHER', isDeleted: false },
      location: { id: 'loc-1', name: 'Berlin', city: 'Berlin', countryCode: 'DE' },
      paymentType: { id: 'cash-1', name: 'Cash', code: 'CASH' },
      vendor: { id: 'vendor-1', name: 'Cafe Mitte', description: 'Receipt vendor' },
    };
    const fields = expenseV4OnlySections(entry, v4).flatMap((section) => section.fields);
    expect(fields).toEqual(expect.arrayContaining([
      { label: 'Expense type · Is deleted', value: 'No', mono: undefined },
      { label: 'Location · City', value: 'Berlin', mono: undefined },
      { label: 'Payment type · Code', value: 'CASH', mono: undefined },
    ]));
    expect(fields.map((field) => field.label)).not.toEqual(expect.arrayContaining([
      'Expense type · ID', 'Expense type · Name', 'Location · ID', 'Location · Name',
      'Payment type · ID', 'Payment type · Name', 'Vendor · ID', 'Vendor · Name',
    ]));
  });

  it('preserves the exchange-rate operation supplied by Expenses v4', () => {
    const sections = expenseV4OnlySections(
      { ...V3, ExchangeRate: 1 },
      { exchangeRate: { value: 1, operation: 'MULTIPLY' } },
    );
    expect(sections.find((section) => section.title === 'Amounts')?.fields).toContainEqual({
      label: 'Exchange rate operation',
      value: 'MULTIPLY',
    });
  });

  it('expands only populated expense source identifiers', () => {
    const sections = expenseV4OnlySections(V3, {
      expenseSourceIdentifiers: {
        creditCardTransactionId: 'card-txn-1',
        bookingUuid: null,
        tripId: '',
      },
    });
    expect(sections.find((section) => section.title === 'Accounting & controls')?.fields).toEqual([
      { label: 'Expense source · Credit Card Transaction Id', value: 'card-txn-1', mono: true },
    ]);
  });
});
