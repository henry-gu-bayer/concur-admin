import { describe, expect, it } from 'vitest';
import type { ExpenseEntry, ExpenseV4 } from '../types';
import { expenseFormValues } from './expenseFormValues';

const entry: ExpenseEntry = {
  ID: 'entry-v3', ExpenseID: 'expense-v4', ExpenseTypeName: 'Hotel', TransactionAmount: 125,
  TransactionCurrencyCode: 'USD', TransactionDate: '2026-01-05',
  Custom1: { Type: 'Text', Value: 'Legacy center' },
};

describe('expense form values', () => {
  it('maps configured location and payment IDs using v4 and v3 fallbacks', () => {
    const fields = [{ fieldId: 'LocName' }, { fieldId: 'PatKey' }];
    const data = { ...entry, LocationName: 'Boston', PaymentTypeName: 'Cash' };
    expect(expenseFormValues(fields, data, { location: { name: 'New York' }, paymentType: { name: 'Card' } }).map(row => row.value)).toEqual(['New York', 'Card']);
    expect(expenseFormValues(fields, data, null).map(row => row.value)).toEqual(['Boston', 'Cash']);
  });

  it.each(['https://example.com', 'https://us.api.concursolutions.com/list/v4/items/item-1'])('preserves URL text %s without implicit API lookup', value => {
    const [row] = expenseFormValues([{ fieldId: 'Custom1' }], { ...entry, Custom1: { Value: value } }, null);
    expect(row.value).toBe(value);
    expect(row.link).toBeUndefined();
  });
  it('follows configured order, reads v4 values and links, and falls back to v3', () => {
    const expense: ExpenseV4 = {
      expenseType: { name: 'Lodging' }, transactionAmount: { value: 126, currencyCode: 'USD' },
      customData: [{ id: 'custom1', value: 'opaque-id', listItemUrl: 'https://us.api.concursolutions.com/list/v4/items/opaque-id' }],
    };
    const rows = expenseFormValues([
      { fieldId: 'Custom1', fieldName: 'Cost center', fieldSequence: 3 },
      { fieldId: 'ExpName', fieldName: 'Expense type', fieldSequence: 1 },
      { fieldId: 'TxnAmount', fieldName: 'Amount', fieldSequence: 2 },
      { fieldId: 'TransactionDate', fieldName: 'Date', fieldSequence: 4 },
    ], entry, expense);
    expect(rows.map(row => [row.label, row.value])).toEqual([
      ['Expense type', 'Lodging'], ['Amount', '126.00 USD'], ['Cost center', 'opaque-id'], ['Date', '2026-01-05'],
    ]);
    expect(rows[2].link).toBe('https://us.api.concursolutions.com/list/v4/items/opaque-id');
  });

  it('keeps configured fields with no value and uses v3 custom values when v4 is unavailable', () => {
    const rows = expenseFormValues([
      { fieldId: 'Custom1', fieldName: 'Cost center' },
      { fieldId: 'Custom2', fieldName: 'Optional field' },
    ], entry, null);
    expect(rows.map(row => row.value)).toEqual(['Legacy center', '—']);
  });

  it('maps expense form field IDs that differ from the Expenses v4 property names', () => {
    const rows = expenseFormValues([
      { fieldId: 'TransactionCurrencyName', fieldName: 'Currency' },
      { fieldId: 'VendorListId', fieldName: 'Vendor' },
      { fieldId: 'IsPartOfTravelAllowance', fieldName: 'Travel allowance' },
    ], { ...entry, VendorDescription: 'A hotel' }, {
      transactionAmount: { value: 125, currencyCode: 'USD' },
      travelAllowance: { isExpensePartOfTravelAllowance: false },
    });
    expect(rows.map(row => row.value)).toEqual(['USD', 'A hotel', 'false']);
  });
});
