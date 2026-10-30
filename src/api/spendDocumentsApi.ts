import { concurFetch, concurGet } from './concurFetch';
import type { ExpenseV4, ExpenseV4ReceiptReference, SpendDocumentReceipt } from '../types';

const SPEND_DOCUMENTS_RECEIPTS_PATH = '/spend-documents/v4/receipts';

export interface SpendDocumentFile {
  blob: Blob;
  contentType: string;
}

/**
 * Receipt references live under Expenses v4 `expenseSourceIdentifiers.receipts`.
 * The field is untyped upstream, so anything that is not an object carrying an
 * `id` or `imageId` is dropped rather than trusted.
 */
export function expenseReceiptReferences(expense: ExpenseV4 | null | undefined): ExpenseV4ReceiptReference[] {
  const identifiers = expense?.expenseSourceIdentifiers;
  if (!identifiers || typeof identifiers !== 'object') return [];
  const receipts = (identifiers as { receipts?: unknown }).receipts;
  if (!Array.isArray(receipts)) return [];
  return receipts.filter((item): item is ExpenseV4ReceiptReference => {
    if (!item || typeof item !== 'object') return false;
    const { id, imageId } = item as ExpenseV4ReceiptReference;
    return Boolean((typeof id === 'string' && id.trim()) || (typeof imageId === 'string' && imageId.trim()));
  });
}

/** Retrieve one receipt by its Spend Documents receipt UUID (scope spenddocs.receipts.read). */
export async function fetchSpendDocumentReceipt(receiptId: string): Promise<SpendDocumentReceipt> {
  const id = receiptId.trim();
  if (!id) throw new Error('A receipt ID is required for Spend Documents v4');
  return concurGet<SpendDocumentReceipt>(`${SPEND_DOCUMENTS_RECEIPTS_PATH}/${encodeURIComponent(id)}`);
}

/**
 * Document hrefs are absolute Concur API URLs. Only the path and query are kept
 * — the local proxy re-targets the active entity's base URL and attaches the
 * token server-side — and only Spend Documents receipt resources are allowed,
 * so an unexpected href cannot turn the proxy into a generic fetcher.
 * concurFetch drops the query of an absolute URL, which would lose the
 * required `type=display|compliance`, hence the explicit normalization.
 */
export function normalizeSpendDocumentHref(href: string): string {
  const value = href.trim();
  if (!value) throw new Error('A document href is required');
  if (value.startsWith('//')) throw new Error('Document href must use HTTP or HTTPS');
  const url = value.startsWith('/') ? new URL(value, 'https://placeholder.invalid') : new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Document href must use HTTP or HTTPS');
  }
  if (url.pathname !== SPEND_DOCUMENTS_RECEIPTS_PATH && !url.pathname.startsWith(`${SPEND_DOCUMENTS_RECEIPTS_PATH}/`)) {
    throw new Error('Document href is not a Spend Documents receipt resource');
  }
  return `${url.pathname}${url.search}`;
}

/** Download one receipt representation (display/compliance/original) on demand. */
export async function downloadSpendDocument(href: string): Promise<SpendDocumentFile> {
  const response = await concurFetch(normalizeSpendDocumentHref(href), {
    headers: { Accept: 'application/pdf,image/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5' },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Document download failed: HTTP ${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ''}`);
  }
  const blob = await response.blob();
  return { blob, contentType: response.headers.get('content-type') || blob.type || 'application/octet-stream' };
}
