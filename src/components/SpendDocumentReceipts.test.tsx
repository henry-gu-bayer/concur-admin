import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpendDocumentReceipt } from '../types';
import { SpendDocumentReceiptsList } from './SpendDocumentReceipts';

vi.mock('../api/spendDocumentsApi', () => ({ downloadSpendDocument: vi.fn() }));

afterEach(cleanup);

function renderReceipt(receipt: SpendDocumentReceipt) {
  render(<SpendDocumentReceiptsList loading={false} skippedCount={0} results={[{ reference: { id: 'r-1' }, receipt, error: null }]} />);
  return screen.getByRole('article', { name: 'Spend document receipt 1' });
}

describe('SpendDocumentReceiptsList', () => {
  it('shows method-specific payment details for each payment type', () => {
    const card = renderReceipt({
      receiptData: {
        amount: { total: '100.00', currency: 'EUR' },
        paymentTypes: [
          { method: 'Credit Card', amount: '40.00', creditCard: { type: 'American Express', lastFour: '0005' }, digitalWallet: 'ApplePay' },
          { method: 'Digital Wallet', amount: '30.00', digitalWallet: 'GooglePay', creditCard: { type: 'Visa', lastFour: '1111' } },
          { method: 'Company Paid', amount: '20.00', companyPaid: { source: 'LodgeCard', creditCard: { type: 'Visa', lastFour: '4242' } } },
          { method: 'Unused Ticket', amount: '10.00', unusedTicket: { ticketNumber: 'TKT-9' } },
          { method: 'Cash' },
        ],
      },
    });
    const section = within(card).getByRole('region', { name: 'Payment types' });
    const credit = within(section).getByLabelText('Payment 1');
    expect(credit).toHaveTextContent('MethodCredit Card');
    expect(credit).toHaveTextContent('Amount40.00 EUR');
    expect(credit).toHaveTextContent('Card typeAmerican Express');
    expect(credit).toHaveTextContent('Last 4 digits•••• 0005');
    // A wallet value on a card payment does not belong to that method.
    expect(credit).not.toHaveTextContent('ApplePay');

    const wallet = within(section).getByLabelText('Payment 2');
    expect(wallet).toHaveTextContent('Digital walletGooglePay');
    expect(wallet).not.toHaveTextContent('Card type');

    const companyPaid = within(section).getByLabelText('Payment 3');
    expect(companyPaid).toHaveTextContent('Company paid sourceLodgeCard');
    expect(companyPaid).toHaveTextContent('Last 4 digits•••• 4242');

    expect(within(section).getByLabelText('Payment 4')).toHaveTextContent('Ticket numberTKT-9');
    const cash = within(section).getByLabelText('Payment 5');
    expect(cash).toHaveTextContent('MethodCash');
    expect(cash).not.toHaveTextContent('Amount');
  });

  it('accepts the single paymentType object and method spellings such as digitalWallet', () => {
    const card = renderReceipt({ receiptData: { paymentType: { method: 'digitalWallet', digitalWallet: 'PayTM' } } });
    const section = within(card).getByRole('region', { name: 'Payment type' });
    expect(section).toHaveTextContent('MethoddigitalWallet');
    expect(section).toHaveTextContent('Digital walletPayTM');
  });

  it('renders vendor, taxes, line items, document compliance, and trip details from ReceiptData', () => {
    const card = renderReceipt({
      receiptData: {
        transactionDateTime: '2026-05-12T16:30:00.000Z',
        amount: { total: '119.00', subTotal: '100.00', taxesTotal: '19.00', currency: 'EUR' },
        vendor: { name: 'Hotel Berlin', taxId: 'DE123', city: 'Berlin', country: 'DE' },
        taxes: [{ name: 'VAT', rate: 19, rateType: 'Standard', amount: '19.00', authority: { addressCountry: 'DE' } }],
        lineItems: [{ description: 'Room', quantity: '2', unitOfMeasure: 'nights', unitPrice: '50.00', amount: '100.00', vatApplicable: true, amountIncludesVat: false }],
        documentCompliance: { uuid: 'doc-uuid', typeCode: '380', verificationCode: 'VC-1' },
        tripDetails: { rideDetails: { classOfService: 'UberX', distance: { totalDistance: 12.4, unit: 'km' } } },
      },
    });
    const data = within(card).getByRole('region', { name: 'Receipt data' });
    expect(data).toHaveTextContent('Transaction date/time2026-05-12 16:30:00 UTC');
    expect(data).toHaveTextContent('Subtotal100.00 EUR');
    expect(data).toHaveTextContent('Taxes total19.00 EUR');
    const vendor = within(card).getByRole('region', { name: 'Vendor' });
    expect(vendor).toHaveTextContent('Hotel Berlin');
    expect(vendor).toHaveTextContent('Tax IDDE123');
    const taxes = within(card).getByRole('table', { name: 'Receipt taxes' });
    expect(within(taxes).getByText('VAT')).toBeInTheDocument();
    expect(within(taxes).getByText('Standard')).toBeInTheDocument();
    const items = within(card).getByRole('table', { name: 'Receipt line items' });
    expect(within(items).getByText('Room')).toBeInTheDocument();
    expect(within(items).getByText('2 nights')).toBeInTheDocument();
    expect(within(items).getByText('VAT applicable')).toBeInTheDocument();
    expect(within(card).getByRole('region', { name: 'Document compliance' })).toHaveTextContent('Verification codeVC-1');
    const trip = within(card).getByRole('region', { name: 'Trip details' });
    expect(trip).toHaveTextContent('Ride details · Class of serviceUberX');
    expect(trip).toHaveTextContent('Ride details · Distance · Total distance12.4');
  });

  it('omits optional ReceiptData sections that were not returned', () => {
    const card = renderReceipt({ receiptData: { amount: { total: '5.00' } } });
    expect(within(card).queryByRole('table', { name: 'Receipt taxes' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('table', { name: 'Receipt line items' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('region', { name: 'Document compliance' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('region', { name: 'Trip details' })).not.toBeInTheDocument();
    expect(within(card).getByRole('region', { name: 'Payment type' })).toHaveTextContent('Not returned.');
  });
});
