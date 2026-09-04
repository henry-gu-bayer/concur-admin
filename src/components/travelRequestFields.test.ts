import { describe, expect, it } from 'vitest';
import type { TravelRequestExpectedExpenseV4, TravelRequestV4 } from '../types';
import {
  expectedExpenseFields,
  travelRequestAllFields,
  travelRequestCustomFields,
  travelRequestExpenseReferences,
  travelRequestSummary,
} from './travelRequestFields';

const REQUEST: TravelRequestV4 = {
  id: 'request-uuid',
  href: 'https://example.com/requests/request-uuid',
  name: 'Berlin customer meeting',
  owner: { firstName: 'Jane', lastName: 'Doe', loginId: 'jane@example.com' },
  approvalStatus: { code: 'APPROVED', name: 'Approved' },
  startDate: '2026-09-10',
  endDate: '2026-09-13',
  mainDestination: { city: 'Berlin', countryCode: 'DE' },
  businessPurpose: 'Quarterly review',
  totalApprovedAmount: { value: 1200, currency: 'EUR' },
  itinerary: {
    segments: [
      { carrier: 'LH', confirmed: true },
      { carrier: '', confirmed: false },
    ],
    elapsedTime: '01:30',
    ticketSource: 'ftp://example.com/tickets/123',
    contact: 'mailto:travel@example.com',
  },
  operations: [{ rel: 'approve', href: 'https://example.com/requests/request-uuid/approve' }],
  custom1: {
    value: 'Client visit',
    code: 'BER',
    href: 'https://example.com/custom/client-visit',
  },
  custom2: { value: '', code: 'INTERNAL' },
  customData: [{ id: '', value: '', href: 'https://example.com/custom/empty' }],
  customFields: [{ name: '', value: null, template: 'https://example.com/custom/template' }],
  expenses: [
    {
      id: 'expense-1',
      href: 'https://example.com/expected-expenses/1?expand=allocations%2Ctrip',
      template: 'https://example.com/expected-expenses/{id}',
    },
    {
      id: 'duplicate-expense',
      href: 'https://example.com/expected-expenses/1?expand=allocations%2Ctrip',
    },
    { href: 'https://example.com/expected-expenses/2?view=full' },
    { id: 'missing-href' },
  ],
  receiptUrl: 'https://example.com/receipt',
  emptyObject: {},
  emptyArray: [],
  emptyValue: '  ',
};

const EXPECTED_EXPENSE: TravelRequestExpectedExpenseV4 = {
  id: 'expense-1',
  href: 'https://example.com/expected-expenses/1',
  expenseType: {
    name: 'Airfare',
    href: 'https://example.com/expense-types/AIR',
  },
  amount: { value: 850, currency: 'EUR' },
  allocations: [
    { percentage: 100, costCenter: 'SALES' },
    { percentage: null, costCenter: '' },
  ],
  tripData: {
    departureCity: 'Berlin',
    bookingUrl: '//example.com/bookings/123',
    elapsedTime: '01:30',
    encodedReceipt: 'data:image/png;base64,abc123',
    localFile: 'FILE:C:/receipts/123.pdf',
  },
  emptyObject: {},
  emptyArray: [],
  emptyValue: ' ',
};

describe('travelRequestSummary', () => {
  it('builds the requested summary using readable values', () => {
    expect(travelRequestSummary(REQUEST)).toEqual([
      { label: 'Name', value: 'Berlin customer meeting' },
      { label: 'Request ID', value: 'request-uuid' },
      { label: 'Owner', value: 'Jane Doe · jane@example.com' },
      { label: 'Status', value: 'Approved' },
      { label: 'Dates', value: '2026-09-10 – 2026-09-13' },
      { label: 'Destination', value: 'Berlin, DE' },
      { label: 'Purpose', value: 'Quarterly review' },
      { label: 'Approved amount', value: '1,200.00 EUR' },
    ]);
  });
});

describe('travelRequestAllFields', () => {
  it('flattens ordinary populated data without links, custom fields, or expenses', () => {
    const fields = travelRequestAllFields(REQUEST);

    expect(fields).toContainEqual({
      label: 'Itinerary › Segments [1] › Confirmed',
      value: 'Yes',
    });
    expect(fields).toContainEqual({
      label: 'Itinerary › Segments [2] › Confirmed',
      value: 'No',
    });
    expect(fields).toContainEqual({
      label: 'Itinerary › Elapsed Time',
      value: '01:30',
    });
    expect(fields.some((field) => (
      /\b(?:href|url|uri|link|links|template|operations)\b/i.test(field.label)
      || /^(?:custom \d+|custom data|custom fields|expenses)(?: ›| \[|$)/i.test(field.label)
    ))).toBe(false);
    expect(fields.map((field) => field.label)).not.toEqual(
      expect.arrayContaining(['Empty object', 'Empty array', 'Empty value']),
    );
    expect(fields.map((field) => field.value)).not.toContain('ftp://example.com/tickets/123');
    expect(fields.map((field) => field.value)).not.toContain('mailto:travel@example.com');
    expect(fields.map((field) => field.label)).toEqual(
      [...fields.map((field) => field.label)].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe('travelRequestCustomFields', () => {
  it('formats populated top-level custom fields without metadata or links', () => {
    expect(travelRequestCustomFields(REQUEST)).toEqual([
      { label: 'Custom 1', value: 'Client visit (BER)' },
      { label: 'Custom 2', value: 'INTERNAL' },
    ]);
  });

  it('labels populated array fields by id, name, label, then position', () => {
    expect(travelRequestCustomFields({
      customData: [
        { id: 'project', value: 'Migration', code: 'MIG' },
        { name: 'Region', code: 'EMEA' },
      ],
      customFields: [
        { label: 'Priority', value: 'High' },
        { value: 'Fallback' },
      ],
    })).toEqual([
      { label: 'project', value: 'Migration (MIG)' },
      { label: 'Region', value: 'EMEA' },
      { label: 'Priority', value: 'High' },
      { label: 'Custom 4', value: 'Fallback' },
    ]);
  });

  it('omits URL-valued custom fields', () => {
    expect(travelRequestCustomFields({
      customFields: [{ id: 'Source', value: 'https://example.com/source' }],
    })).toEqual([]);
  });

  it('filters URL-valued codes independently from values', () => {
    expect(travelRequestCustomFields({
      customFields: [
        { id: 'Safe value', value: 'Client visit', code: 'MAILTO:codes@example.com' },
        { id: 'Only URI code', code: 'data:text/plain,internal' },
        { id: 'Safe code', value: 'ftp://example.com/value', code: 'INTERNAL' },
        { id: 'Colon value', value: '01:30', code: 'file:C:/codes/internal' },
      ],
    })).toEqual([
      { label: 'Safe value', value: 'Client visit' },
      { label: 'Safe code', value: 'INTERNAL' },
      { label: 'Colon value', value: '01:30' },
    ]);
  });
});

describe('travelRequestExpenseReferences', () => {
  it('preserves href query strings, requires href, and deduplicates by href', () => {
    expect(travelRequestExpenseReferences(REQUEST)).toEqual([
      {
        id: 'expense-1',
        href: 'https://example.com/expected-expenses/1?expand=allocations%2Ctrip',
      },
      {
        id: 'Expected expense 3',
        href: 'https://example.com/expected-expenses/2?view=full',
      },
    ]);
  });
});

describe('expectedExpenseFields', () => {
  it('keeps populated nested expense data while excluding links and URL values', () => {
    expect(expectedExpenseFields(EXPECTED_EXPENSE)).toEqual([
      { label: 'Allocations [1] › Cost Center', value: 'SALES' },
      { label: 'Allocations [1] › Percentage', value: '100' },
      { label: 'Amount › Currency', value: 'EUR' },
      { label: 'Amount › Value', value: '850' },
      { label: 'Expense Type › Name', value: 'Airfare' },
      { label: 'ID', value: 'expense-1' },
      { label: 'Trip Data › Departure City', value: 'Berlin' },
      { label: 'Trip Data › Elapsed Time', value: '01:30' },
    ]);
  });
});
