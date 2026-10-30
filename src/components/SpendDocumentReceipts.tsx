import { ReactNode, useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { downloadSpendDocument } from '../api/spendDocumentsApi';
import type {
  ExpenseV4ReceiptReference,
  SpendDocument,
  SpendDocumentCreditCard,
  SpendDocumentLineItem,
  SpendDocumentPaymentType,
  SpendDocumentReceipt,
  SpendDocumentTax,
} from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

/** Per-receipt outcome: one failed receipt must not hide the others. */
export interface SpendDocumentReceiptResult {
  reference: ExpenseV4ReceiptReference;
  receipt: SpendDocumentReceipt | null;
  error: string | null;
}

type Row = [label: string, value: string | null | undefined, mono?: boolean];

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return null;
}

function dateTime(value?: string | null): string | null {
  return value ? value.replace('T', ' ').replace(/(\.\d+)?Z$/, ' UTC') : null;
}

function money(amount?: string | null, currency?: string | null): string | null {
  if (!amount) return null;
  return currency ? `${amount} ${currency}` : amount;
}

function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Flatten schema objects the public docs describe only loosely (expenseData,
 * customData, discounts, tripDetails) into labelled rows, so whatever Concur
 * returns is visible without hard-coding every eReceipt category.
 */
function flattenRows(value: unknown, label = '', depth = 0): Row[] {
  const scalar = text(value);
  if (scalar !== null) return label ? [[label, scalar]] : [];
  if (depth > 6 || !value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenRows(item, label ? `${label} ${index + 1}` : `Item ${index + 1}`, depth + 1));
  }
  return Object.entries(value).flatMap(([key, child]) => flattenRows(child, label ? `${label} · ${humanize(key)}` : humanize(key), depth + 1));
}

function presentRows(rows: Row[]): [string, string, boolean?][] {
  return rows.filter((row): row is [string, string, boolean?] => Boolean(row[1]));
}

function RowList({ rows, label, className = '' }: { rows: Row[]; label?: string; className?: string }) {
  return (
    <dl aria-label={label} className={`grid gap-1 text-xs ${className}`}>
      {presentRows(rows).map(([rowLabel, value, mono]) => (
        <div key={rowLabel} className="grid gap-x-3" style={{ gridTemplateColumns: 'minmax(0, 9rem) minmax(0, 1fr)' }}>
          <dt className="text-muted-foreground">{rowLabel}</dt>
          <dd className={`min-w-0 break-all text-foreground ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>;
}

/** A schema group; optional groups disappear when Concur returned nothing for them. */
function DetailGroup({ title, rows, optional = false, className = '' }: { title: string; rows: Row[]; optional?: boolean; className?: string }) {
  const hasRows = presentRows(rows).length > 0;
  if (optional && !hasRows) return null;
  return (
    <section aria-label={title} className={`min-w-0 ${className}`}>
      <SectionTitle>{title}</SectionTitle>
      {hasRows ? <RowList rows={rows} /> : <p className="text-xs text-muted-foreground">Not returned.</p>}
    </section>
  );
}

function maskedLastFour(lastFour?: string | null): string | null {
  const digits = lastFour?.trim();
  return digits ? `•••• ${digits}` : null;
}

function cardRows(card: SpendDocumentCreditCard | null | undefined): Row[] {
  return [
    ['Card type', card?.type],
    ['Last 4 digits', maskedLastFour(card?.lastFour), true],
    ['Authorization code', card?.authorizationCode, true],
  ];
}

/** "Credit Card", "creditCard" and "CREDIT_CARD" all name the same method. */
function paymentMethodKey(method?: string | null): string {
  return (method ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Method-specific detail per the PaymentType schema: card data belongs to the
 * Credit Card method, the wallet type to Digital Wallet, and so on. Details
 * that don't belong to the stated method are not shown.
 */
function paymentRows(payment: SpendDocumentPaymentType, currency?: string | null): Row[] {
  const rows: Row[] = [
    ['Method', payment.method?.trim() || 'Not returned'],
    ['Amount', money(payment.amount, currency)],
  ];
  switch (paymentMethodKey(payment.method)) {
    case 'creditcard':
      return [...rows, ...cardRows(payment.creditCard)];
    case 'digitalwallet':
      return [...rows, ['Digital wallet', payment.digitalWallet]];
    case 'companypaid':
      return [...rows, ['Company paid source', payment.companyPaid?.source], ...cardRows(payment.companyPaid?.creditCard)];
    case 'unusedticket':
      return [...rows, ['Ticket number', payment.unusedTicket?.ticketNumber, true]];
    default:
      return rows;
  }
}

function PaymentTypes({ payments, currency }: { payments: SpendDocumentPaymentType[]; currency?: string | null }) {
  const title = payments.length > 1 ? 'Payment types' : 'Payment type';
  return (
    <section aria-label={title} className="min-w-0">
      <SectionTitle>{title}</SectionTitle>
      {payments.length ? (
        <div className="grid gap-2">
          {payments.map((payment, index) => (
            <RowList
              key={index}
              label={`Payment ${index + 1}`}
              rows={paymentRows(payment, currency)}
              className={payments.length > 1 ? 'rounded-md border bg-muted/20 px-3 py-2' : ''}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Not returned.</p>
      )}
    </section>
  );
}

function TableSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <SectionTitle>{title}</SectionTitle>
      <div className="overflow-auto rounded-md border">{children}</div>
    </section>
  );
}

const TH = 'px-3 py-2';
const HEAD_ROW = 'border-b bg-muted text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground';

function TaxesTable({ taxes, currency }: { taxes: SpendDocumentTax[]; currency?: string | null }) {
  return (
    <TableSection title="Taxes">
      <table className="w-full text-xs" aria-label="Receipt taxes">
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={TH}>Name</th>
            <th scope="col" className={TH}>Rate</th>
            <th scope="col" className={TH}>Rate type</th>
            <th scope="col" className={TH}>Authority</th>
            <th scope="col" className={`${TH} text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {taxes.map((tax, index) => (
            <tr key={index} className="border-b last:border-0">
              <td className={TH}>{tax.name || '—'}</td>
              <td className={`${TH} tabular-nums`}>{text(tax.rate) ?? '—'}</td>
              <td className={TH}>{tax.rateType || '—'}</td>
              <td className={TH}>{[tax.authority?.addressCountry, tax.authority?.addressRegion].filter(Boolean).join(' · ') || '—'}</td>
              <td className={`${TH} text-right tabular-nums`}>{money(tax.amount, currency) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableSection>
  );
}

function LineItemsTable({ items, currency }: { items: SpendDocumentLineItem[]; currency?: string | null }) {
  return (
    <TableSection title="Line items">
      <table className="w-full text-xs" aria-label="Receipt line items">
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={TH}>Description</th>
            <th scope="col" className={TH}>Quantity</th>
            <th scope="col" className={`${TH} text-right`}>Unit price</th>
            <th scope="col" className={TH}>Tax</th>
            <th scope="col" className={`${TH} text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const secondary = [
              item.additionalDescription,
              item.productCode && `Code ${item.productCode}`,
              item.reference && `Ref ${item.reference}`,
              item.semanticsCode,
              item.semanticsType,
              item.type,
              item.date,
              item.vatApplicable === true ? (item.amountIncludesVat ? 'VAT included' : 'VAT applicable') : null,
            ].filter(Boolean).join(' · ');
            const tax = [item.taxRate && `Rate ${item.taxRate}`, money(item.taxesTotal, currency)].filter(Boolean).join(' · ');
            return (
              <tr key={item.itemId ?? index} className="border-b align-top last:border-0">
                <td className={`${TH} min-w-0`}>
                  <span className="text-foreground">{item.description || '—'}</span>
                  {secondary && <p className="mt-0.5 text-[11px] text-muted-foreground">{secondary}</p>}
                </td>
                <td className={`${TH} tabular-nums`}>{[item.quantity, item.unitOfMeasure].filter(Boolean).join(' ') || '—'}</td>
                <td className={`${TH} text-right tabular-nums`}>{money(item.unitPrice, currency) ?? '—'}</td>
                <td className={`${TH} tabular-nums`}>{tax || '—'}</td>
                <td className={`${TH} text-right tabular-nums`}>{money(item.amount ?? item.subTotal, currency) ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableSection>
  );
}

/** Save a blob through a temporary object URL; nothing is fetched until the user asks. */
function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick so the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DocumentRow({ document: doc, fallbackName }: { document: SpendDocument; fallbackName: string }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = doc.name?.trim() || fallbackName;
  const href = doc.href?.trim();
  const download = async () => {
    if (!href) return;
    setDownloading(true);
    setError(null);
    try {
      const file = await downloadSpendDocument(href);
      saveBlob(file.blob, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };
  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2 text-xs">{doc.representation ? <Badge tone="muted">{doc.representation}</Badge> : '—'}</td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{doc.type || '—'}</td>
      <td className="min-w-0 break-all px-3 py-2 text-xs text-foreground">
        {name}
        {error && <p className="mt-1 text-[11px] text-destructive" role="alert">{error}</p>}
      </td>
      <td className="px-3 py-2 text-right">
        {href ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void download()}
            loading={downloading}
            aria-label={`Download ${name}`}
            className="h-7 gap-1 px-2.5 text-[11px]"
          >
            {!downloading && <DownloadSimpleIcon aria-hidden="true" size={14} />}
            Download
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">No link</span>
        )}
      </td>
    </tr>
  );
}

function ReceiptCard({ result, receiptNumber }: { result: SpendDocumentReceiptResult; receiptNumber: number }) {
  const { reference, receipt, error } = result;
  const metadata = receipt?.metadata ?? {};
  const data = receipt?.receiptData ?? {};
  const documents = receipt?.documents ?? [];
  const currency = data.amount?.currency;
  const payments = [...(data.paymentTypes ?? []), ...(data.paymentType ? [data.paymentType] : [])];
  const taxes = data.taxes ?? [];
  const lineItems = data.lineItems ?? [];
  const compliance = metadata.compliance && typeof metadata.compliance === 'object' ? metadata.compliance : null;
  // The compliance object is not itemized in the public schema; show status and
  // type first, then any other scalar values it carries.
  const complianceRows: Row[] = compliance
    ? [
      ['Compliance status', text(compliance.status)],
      ['Compliance type', text(compliance.type)],
      ...Object.entries(compliance)
        .filter(([key]) => key !== 'status' && key !== 'type')
        .map(([key, value]): Row => [`Compliance ${key}`, text(value)]),
    ]
    : [];
  const vendor = data.vendor;
  const documentCompliance = data.documentCompliance;
  const receiptId = metadata.id ?? reference.id ?? reference.imageId ?? `receipt ${receiptNumber}`;
  return (
    <article aria-label={`Spend document receipt ${receiptNumber}`} className="rounded-lg border bg-card">
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">Receipt {receiptNumber}</h3>
        <span className="break-all font-mono text-[10px] text-muted-foreground">{receiptId}</span>
        {metadata.status && <Badge tone={metadata.status === 'processed' ? 'success' : metadata.status === 'failed' ? 'warning' : 'muted'}>{metadata.status}</Badge>}
        {(metadata.feature ?? reference.feature) && <Badge tone="primary">{metadata.feature ?? reference.feature}</Badge>}
      </header>
      {error ? (
        <p className="m-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
          Spend Documents v4 is unavailable for this receipt: {error}
        </p>
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <DetailGroup
              title="Receipt data"
              rows={[
                ['Transaction date/time', dateTime(data.transactionDateTime)],
                ['Received date/time', dateTime(data.receiveDateTime)],
                ['Total', money(data.amount?.total, currency)],
                ['Subtotal', money(data.amount?.subTotal, currency)],
                ['Net amount', money(data.amount?.netAmount, currency)],
                ['Taxes total', money(data.amount?.taxesTotal ?? data.taxesTotal, currency)],
                ['Discounts total', money(data.amount?.discountsTotal ?? data.discountsTotal, currency)],
                ['Reference number', data.referenceNumber, true],
                ['Network transaction ID', data.networkTransactionId, true],
                ['Program name', data.programName],
                ['Comments', data.comments],
              ]}
            />
            <DetailGroup
              title="Receipt metadata"
              rows={[
                ['Origin', metadata.origin],
                ['Provider', metadata.provider],
                ['Status', metadata.status],
                ...complianceRows,
                ['Compliance country', metadata.complianceCountryCode],
                ['Feature', metadata.feature],
                ['Category', metadata.category],
                ['Capture method', metadata.captureMethod],
                ['Received', dateTime(metadata.dateTimeReceived)],
                ['Receipt ID', metadata.id ?? reference.id, true],
                ['Image ID', metadata.imageId ?? reference.imageId, true],
                ['User ID', metadata.userId, true],
              ]}
            />
            <DetailGroup
              title="Vendor"
              rows={[
                ['Name', vendor?.name],
                ['Tax ID', vendor?.taxId, true],
                ['Address', vendor?.addressLine],
                ['City', vendor?.city],
                ['State', vendor?.state],
                ['Postal code', vendor?.postalCode],
                ['Country', vendor?.country],
                ['Phone', vendor?.phone],
              ]}
            />
            <PaymentTypes payments={payments} currency={currency} />
          </div>
          {taxes.length > 0 && <TaxesTable taxes={taxes} currency={currency} />}
          {lineItems.length > 0 && <LineItemsTable items={lineItems} currency={currency} />}
          <div className="grid gap-4 empty:hidden md:grid-cols-2">
            <DetailGroup
              optional
              title="Document compliance"
              rows={[
                ['Document UUID', documentCompliance?.uuid, true],
                ['Format version', documentCompliance?.formatVersion],
                ['Number', documentCompliance?.number, true],
                ['Type code', documentCompliance?.typeCode],
                ['Type', documentCompliance?.type],
                ['Verification code', documentCompliance?.verificationCode, true],
              ]}
            />
            <DetailGroup optional title="Expense data" rows={flattenRows(data.expenseData)} />
            <DetailGroup optional title="Discounts" rows={flattenRows(data.discounts)} />
            <DetailGroup optional title="Custom data" rows={flattenRows(data.customData)} />
            <DetailGroup optional title="Trip details" rows={flattenRows(data.tripDetails)} className="md:col-span-2" />
          </div>
          <section aria-label={`Documents for receipt ${receiptNumber}`}>
            <SectionTitle>Documents</SectionTitle>
            {documents.length ? (
              <div className="overflow-auto rounded-md border">
                <table className="w-full text-sm" aria-label={`Receipt ${receiptNumber} documents`}>
                  <thead>
                    <tr className={HEAD_ROW}>
                      <th scope="col" className={TH}>Representation</th>
                      <th scope="col" className={TH}>Type</th>
                      <th scope="col" className={TH}>Name</th>
                      <th scope="col" className={`${TH} text-right`}><span className="sr-only">Download</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc, index) => (
                      <DocumentRow
                        key={`${doc.href ?? doc.name ?? 'document'}-${index}`}
                        document={doc}
                        fallbackName={`${receiptId}-${doc.representation ?? index + 1}`}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No documents were returned for this receipt.</p>
            )}
          </section>
        </div>
      )}
    </article>
  );
}

export function SpendDocumentReceiptsList({
  results,
  loading,
  skippedCount,
}: {
  results: SpendDocumentReceiptResult[] | null;
  loading: boolean;
  /** References with only an imageId cannot be fetched without the company UUID. */
  skippedCount: number;
}) {
  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground" role="status">Loading spend document receipts…</p>;
  return (
    <div className="space-y-3">
      {skippedCount > 0 && (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" role="status">
          {skippedCount} receipt {skippedCount === 1 ? 'reference has' : 'references have'} no receipt ID and cannot be retrieved.
        </p>
      )}
      {results?.length
        ? results.map((result, index) => <ReceiptCard key={`${result.reference.id ?? result.reference.imageId}-${index}`} result={result} receiptNumber={index + 1} />)
        : !skippedCount && <p className="py-8 text-center text-sm text-muted-foreground">No spend document receipts were returned.</p>}
    </div>
  );
}
