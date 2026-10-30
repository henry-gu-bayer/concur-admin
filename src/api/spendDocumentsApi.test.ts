import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadSpendDocument,
  expenseReceiptReferences,
  fetchSpendDocumentReceipt,
  normalizeSpendDocumentHref,
} from './spendDocumentsApi';

const { concurGet, concurFetch } = vi.hoisted(() => ({
  concurGet: vi.fn(),
  concurFetch: vi.fn(),
}));

vi.mock('./concurFetch', () => ({ concurGet, concurFetch }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('expenseReceiptReferences', () => {
  it('reads receipt references from Expenses v4 expenseSourceIdentifiers', () => {
    expect(expenseReceiptReferences({
      expenseSourceIdentifiers: {
        receipts: [
          { id: 'receipt-1', imageId: 'IMG1', version: '1', feature: 'simpleReceipt', ereceipt: null },
          { imageId: 'IMG2' },
          { id: '  ' },
          'not-an-object',
          null,
        ],
      },
    })).toEqual([
      { id: 'receipt-1', imageId: 'IMG1', version: '1', feature: 'simpleReceipt', ereceipt: null },
      { imageId: 'IMG2' },
    ]);
  });

  it('returns no references when the section is missing or malformed', () => {
    expect(expenseReceiptReferences(null)).toEqual([]);
    expect(expenseReceiptReferences({})).toEqual([]);
    expect(expenseReceiptReferences({ expenseSourceIdentifiers: { receipts: 'x' } })).toEqual([]);
  });
});

describe('fetchSpendDocumentReceipt', () => {
  it('retrieves one receipt by encoded receipt ID', async () => {
    concurGet.mockResolvedValue({ metadata: { id: 'r/1' } });
    await expect(fetchSpendDocumentReceipt(' r/1 ')).resolves.toEqual({ metadata: { id: 'r/1' } });
    expect(concurGet).toHaveBeenCalledWith('/spend-documents/v4/receipts/r%2F1');
  });

  it('rejects a blank receipt ID before making a request', async () => {
    await expect(fetchSpendDocumentReceipt('  ')).rejects.toThrow(/receipt id is required/i);
    expect(concurGet).not.toHaveBeenCalled();
  });
});

describe('normalizeSpendDocumentHref', () => {
  it('keeps the path and the representation query of an absolute href', () => {
    expect(normalizeSpendDocumentHref(
      'https://us.api.concursolutions.com/spend-documents/v4/receipts/abc/representations?type=display',
    )).toBe('/spend-documents/v4/receipts/abc/representations?type=display');
  });

  it('passes a relative Spend Documents href through', () => {
    expect(normalizeSpendDocumentHref('/spend-documents/v4/receipts/abc/representations?type=compliance'))
      .toBe('/spend-documents/v4/receipts/abc/representations?type=compliance');
  });

  it('rejects hrefs outside Spend Documents receipts or with unsafe schemes', () => {
    expect(() => normalizeSpendDocumentHref('')).toThrow(/href is required/i);
    expect(() => normalizeSpendDocumentHref('//evil.example/x')).toThrow(/HTTP or HTTPS/);
    expect(() => normalizeSpendDocumentHref('javascript:alert(1)')).toThrow(/HTTP or HTTPS/);
    expect(() => normalizeSpendDocumentHref('https://us.api.concursolutions.com/api/v3.0/expense/reports'))
      .toThrow(/not a Spend Documents receipt/);
    expect(() => normalizeSpendDocumentHref('https://us.api.concursolutions.com/spend-documents/v4/receiptsX'))
      .toThrow(/not a Spend Documents receipt/);
  });
});

describe('downloadSpendDocument', () => {
  it('downloads the representation through the local proxy and returns the blob', async () => {
    concurFetch.mockResolvedValue(new Response(new Blob(['pdf'], { type: 'application/pdf' }), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    }));
    const file = await downloadSpendDocument(
      'https://us.api.concursolutions.com/spend-documents/v4/receipts/abc/representations?type=display',
    );
    expect(concurFetch).toHaveBeenCalledWith(
      '/spend-documents/v4/receipts/abc/representations?type=display',
      expect.objectContaining({ headers: expect.anything() }),
    );
    expect(file.contentType).toBe('application/pdf');
    expect(file.blob).toBeInstanceOf(Blob);
  });

  it('throws a descriptive error on a non-OK response', async () => {
    concurFetch.mockResolvedValue(new Response('scope missing', { status: 403 }));
    await expect(downloadSpendDocument('/spend-documents/v4/receipts/abc/representations?type=display'))
      .rejects.toThrow(/HTTP 403 — scope missing/);
  });
});
