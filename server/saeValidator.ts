import countries from '../src/data/countries.json';
import {
  SAE_COLUMNS,
  SAE_V2_DETAIL_COLUMNS,
  SAE_V3_DETAIL_COLUMNS,
  saeColumnName,
  type SaeColumn,
} from './saeLayout';

/**
 * Standard Accounting Extract validator.
 *
 * Implements the machine-checkable controls in docs/EXP_SPEC_SAE_V3.md section 5.
 * Rule IDs match the spec so a finding can be traced to its requirement. Rules
 * that depend on a client-specific mapping catalogue (R-06 org-dimension level,
 * R-07 GL string completeness, C-03/C-05 cash-advance offset order) cannot be
 * decided from the file alone and are deliberately not automated.
 *
 * Amounts are compared as scaled BigInts, never floats: a 400-million journal
 * total summed over thousands of 4-decimal rows drifts in binary floating point,
 * and F-08 would then report a reconciliation error the file does not have.
 */

export type SaeSeverity = 'error' | 'warning';
export type SaeVersion = 'V2' | 'V3' | 'unknown';

export interface SaeFinding {
  rule: string;
  severity: SaeSeverity;
  message: string;
  /** 1-based physical line in the file. */
  line?: number;
  sequence?: string;
  column?: number;
  columnName?: string;
  /** Offending value, truncated and masked for sensitive columns. */
  value?: string;
  reportId?: string;
}

export interface SaeRuleSummary {
  rule: string;
  title: string;
  severity: SaeSeverity;
  errors: number;
  warnings: number;
  /** Retained findings; `errors + warnings` may exceed this when samples are capped. */
  findings: SaeFinding[];
}

export interface SaeFileResult {
  name: string;
  path: string;
  size: number;
  version: SaeVersion;
  header: {
    batchDate?: string;
    recordCount?: string;
    journalTotal?: string;
    batchId?: string;
  };
  batchId?: string;
  detailRows: number;
  reportCount: number;
  computedJournalTotal?: string;
  errors: number;
  warnings: number;
  rules: SaeRuleSummary[];
}

/** Keys used for cross-file duplicate checks; kept server-side only. */
export interface SaeFileKeys {
  batchId?: string;
  reportIds: Set<string>;
  cardTransactionIds: Set<string>;
}

export const SAE_RULES: Record<string, { title: string; severity: SaeSeverity }> = {
  'E-01': { title: 'File is valid UTF-8 text', severity: 'error' },
  'F-01': { title: 'Header record exists and starts with EXTRACT', severity: 'error' },
  'F-02': { title: 'Header field count', severity: 'error' },
  'F-03': { title: 'Every detail row starts with DETAIL', severity: 'error' },
  'F-04': { title: 'Detail rows keep every column position', severity: 'error' },
  'F-05': { title: 'Detail batch ID and date match the header', severity: 'error' },
  'F-06': { title: 'Date format', severity: 'error' },
  'F-07': { title: 'Header record count equals detail rows', severity: 'error' },
  'F-08': { title: 'Header journal total equals sum of journal amounts (A-01)', severity: 'error' },
  'F-09': { title: 'Sequence numbers are numeric, unique, and gap-free', severity: 'warning' },
  'F-10': { title: 'Reserved Future Use columns are empty', severity: 'error' },
  'D-01': { title: 'Numeric fields', severity: 'error' },
  'D-02': { title: 'Money fields are signed decimals of at most 23 characters', severity: 'error' },
  'D-03': { title: 'Maximum field length', severity: 'error' },
  'D-04': { title: 'ISO currency and country codes', severity: 'error' },
  'D-05': { title: 'Y/N flags', severity: 'error' },
  'D-06': { title: 'Journal debit/credit is DR or CR', severity: 'error' },
  'D-07': { title: 'Exchange-rate direction is M or D', severity: 'error' },
  'D-08': { title: 'Entry transaction type is REG or CHD', severity: 'error' },
  'D-09': { title: 'Receipt type is T, R, or N', severity: 'error' },
  'D-10': { title: 'Tax source is CARD, USER, SYST, or PROC', severity: 'error' },
  'D-11': { title: 'Foreign/domestic flag is FRGN, HOME, or OOSD', severity: 'error' },
  'D-12': { title: 'Cash advance transaction type is 1, 2, or 3', severity: 'error' },
  'D-13': { title: 'Report type is blank, RR, CR, or SR', severity: 'error' },
  'D-14': { title: 'Travel allowance meal provided values', severity: 'error' },
  'D-15': { title: 'Bank account currency is a documented value', severity: 'warning' },
  'D-16': { title: 'Other documented code values (field catalogue)', severity: 'error' },
  'R-01': { title: 'Journal rows carry a Report ID or Report Key', severity: 'error' },
  'R-02': { title: 'Report rows carry a Report Entry Key', severity: 'error' },
  'R-03': { title: 'Journal amount has journal key, account code, and DR/CR', severity: 'error' },
  'R-04': { title: 'Allocation key/percentage present and percentages total 100', severity: 'error' },
  'R-05': { title: 'Allocation rows with every allocation dimension blank', severity: 'warning' },
  'A-02': { title: 'Posted amount matches transaction amount × exchange rate', severity: 'warning' },
  'A-03': { title: 'Net tax amount = posted amount − total tax posted', severity: 'error' },
  'A-04': { title: 'Net reclaim adjusted = approved amount − total reclaim adjusted', severity: 'error' },
  'A-05': { title: 'Approved amount does not exceed posted amount', severity: 'warning' },
  'A-06': { title: 'Report totals reconcile to their entries', severity: 'warning' },
  'A-07': { title: 'Payment-safe due amounts are not negative', severity: 'error' },
  'A-08': { title: 'Card transaction IDs are not reused by different entries', severity: 'warning' },
  'C-01': { title: 'Cash advance issue posts Company → payee, DR, with clearing account', severity: 'error' },
  'C-02': { title: 'Cash advance application posts Employee → Company, CR, non-positive', severity: 'error' },
  'C-04': { title: 'Balance-due records identify their source report', severity: 'warning' },
  'S-01': { title: 'Unmasked card account numbers present', severity: 'warning' },
  'S-02': { title: 'Employee bank account fields present', severity: 'warning' },
  'X-01': { title: 'Batch ID is not repeated across files', severity: 'error' },
  'X-02': { title: 'Report is not extracted in more than one file', severity: 'warning' },
  'X-03': { title: 'Card transaction is not extracted in more than one file', severity: 'warning' },
};

/** Findings kept per rule per file; the counts always cover every occurrence. */
export const MAX_FINDINGS_PER_RULE = 100;
/**
 * Header journal total vs. recomputed total. The spec asks for an agreed tolerance
 * compatible with the configured precision; one minor unit of a 2-decimal currency
 * absorbs representation differences without hiding a missing journal line.
 */
const JOURNAL_TOTAL_TOLERANCE = 0.01;
const MAX_VALUE_LENGTH = 60;
const SCALE_DIGITS = 8;
const SCALE = 10n ** BigInt(SCALE_DIGITS);
const DOCUMENTED_BANK_CURRENCIES = new Set(['USD', 'EUR', 'AUD', 'GBP']);

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH_DATE = /^(\d{4})\/(\d{2})\/(\d{2})$/;
const NUMERIC = /^\d+$/;
const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;
const CARD_NUMBER = /^\D{0,6}\d{12,19}$/;

const knownCurrencies: Set<string> | null = (() => {
  try {
    return new Set(Intl.supportedValuesOf('currency'));
  } catch {
    return null;
  }
})();

// The generated geo data is the app's ISO 3166 source of truth. Intl.DisplayNames
// is not usable here: it names unassigned codes ("ZZ" → "Unknown Region").
const knownCountries = new Set((countries as { code: string }[]).map((country) => country.code));

const minorUnitCache = new Map<string, number>();
function currencyMinorUnits(currency: string): number {
  let digits = minorUnitCache.get(currency);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    minorUnitCache.set(currency, digits);
  }
  return digits;
}

function isCalendarDate(match: RegExpExecArray | null): boolean {
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isSaeDate(value: string): boolean {
  return isCalendarDate(DATE.exec(value));
}

/** Parse a signed decimal into an integer scaled by 10^8; null when not a decimal. */
export function scaledAmount(value: string): bigint | null {
  if (!DECIMAL.test(value)) return null;
  const negative = value.startsWith('-');
  const unsigned = value.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(SCALE_DIGITS, '0').slice(0, SCALE_DIGITS));
  return negative ? -scaled : scaled;
}

export function formatScaledAmount(value: bigint, decimals = 4): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(SCALE_DIGITS, '0').slice(0, decimals);
  return `${negative ? '-' : ''}${whole}${decimals > 0 ? `.${fraction}` : ''}`;
}

function toNumber(value: bigint): number {
  return Number(value) / Number(SCALE);
}

/** Show only the last four characters of card, bank, and contact values (S-01, S-04). */
export function maskSensitive(value: string): string {
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

function displayValue(value: string, column?: SaeColumn): string {
  if (column?.sensitive) return maskSensitive(value);
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
}

function codePointLength(value: string): number {
  let length = 0;
  for (const _ of value) length += 1;
  return length;
}

class FindingCollector {
  private readonly rules = new Map<string, SaeRuleSummary>();

  add(rule: string, finding: Omit<SaeFinding, 'rule' | 'severity'> & { severity?: SaeSeverity }): void {
    const definition = SAE_RULES[rule];
    const severity = finding.severity ?? definition.severity;
    let summary = this.rules.get(rule);
    if (!summary) {
      summary = { rule, title: definition.title, severity, errors: 0, warnings: 0, findings: [] };
      this.rules.set(rule, summary);
    }
    if (severity === 'error') {
      summary.errors += 1;
      summary.severity = 'error';
    } else {
      summary.warnings += 1;
    }
    if (summary.findings.length < MAX_FINDINGS_PER_RULE) summary.findings.push({ ...finding, rule, severity });
  }

  summaries(): SaeRuleSummary[] {
    const order = Object.keys(SAE_RULES);
    return [...this.rules.values()].sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));
  }
}

function detectVersion(headerFields: string[] | null, detailWidths: Map<number, number>): SaeVersion {
  if (headerFields?.[0] === 'EXTRACT') {
    if (headerFields.length === 5) return 'V3';
    if (headerFields.length === 4) return 'V2';
  }
  let dominantWidth = 0;
  let dominantCount = 0;
  for (const [width, count] of detailWidths) {
    if (count > dominantCount) {
      dominantWidth = width;
      dominantCount = count;
    }
  }
  if (dominantWidth === SAE_V3_DETAIL_COLUMNS) return 'V3';
  if (dominantWidth === SAE_V2_DETAIL_COLUMNS) return 'V2';
  return 'unknown';
}

interface EntryTotals {
  posted: bigint;
  approved: bigint;
}

interface ReportTotals {
  reportId: string;
  line: number;
  totalPosted: string;
  totalApproved: string;
  entries: Map<string, EntryTotals>;
}

/**
 * Validate one SAE file's raw bytes.
 *
 * Returns the serializable result plus the keys the caller needs for
 * cross-file checks (batch IDs, report IDs, card transaction IDs).
 */
export function validateSaeContent(
  name: string,
  path: string,
  content: Buffer
): { result: SaeFileResult; keys: SaeFileKeys } {
  const findings = new FindingCollector();
  const keys: SaeFileKeys = { reportIds: new Set(), cardTransactionIds: new Set() };

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    findings.add('E-01', { message: 'The file is not valid UTF-8; non-ASCII names and descriptions were replaced while checking.' });
    text = content.toString('utf-8');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const headerFields = lines.length > 0 && lines[0].startsWith('EXTRACT') ? lines[0].split('|') : null;
  const detailWidths = new Map<number, number>();
  const detailLines: { line: number; fields: string[] }[] = [];
  for (let index = headerFields ? 1 : 0; index < lines.length; index += 1) {
    const fields = lines[index].split('|');
    if (fields[0] !== 'DETAIL') {
      findings.add('F-03', {
        line: index + 1,
        message: lines[index] === '' ? 'Blank line inside the file.' : 'Row does not start with DETAIL.',
        value: lines[index] === '' ? undefined : displayValue(fields[0]),
      });
      continue;
    }
    detailWidths.set(fields.length, (detailWidths.get(fields.length) ?? 0) + 1);
    detailLines.push({ line: index + 1, fields });
  }

  const version = detectVersion(headerFields, detailWidths);
  const expectedWidth = version === 'V2' ? SAE_V2_DETAIL_COLUMNS : SAE_V3_DETAIL_COLUMNS;
  const header: SaeFileResult['header'] = {};

  // ── Header (F-01, F-02, F-06, D-01, D-02) ──────────────────────────────
  if (!headerFields) {
    findings.add('F-01', {
      line: 1,
      message: lines.length === 0 ? 'The file is empty.' : 'The first row is not an EXTRACT header.',
      value: lines.length === 0 ? undefined : displayValue(lines[0].split('|')[0]),
    });
  } else {
    if (headerFields[0] !== 'EXTRACT') {
      findings.add('F-01', { line: 1, message: 'Header column 1 must be exactly EXTRACT.', value: displayValue(headerFields[0]) });
    }
    if (headerFields.length !== 4 && headerFields.length !== 5) {
      findings.add('F-02', { line: 1, message: `Header has ${headerFields.length} fields; V3 requires 5 and V2 has 4.` });
    } else if (version === 'V3' && headerFields.length !== 5) {
      findings.add('F-02', { line: 1, message: `Header has ${headerFields.length} fields but detail rows use the V3 layout, which requires 5.` });
    }
    [header.batchDate, header.recordCount, header.journalTotal, header.batchId] = headerFields.slice(1, 5);
    if (header.batchDate !== undefined && !isSaeDate(header.batchDate)) {
      findings.add('F-06', { line: 1, columnName: 'Header Batch Date', message: 'Header batch date must be a valid yyyy-MM-dd date.', value: displayValue(header.batchDate) });
    }
    if (header.recordCount !== undefined && !NUMERIC.test(header.recordCount)) {
      findings.add('D-01', { line: 1, columnName: 'Header Record Count', message: 'Header record count must be numeric.', value: displayValue(header.recordCount) });
    }
    if (header.journalTotal !== undefined && (scaledAmount(header.journalTotal) === null || header.journalTotal.length > 23)) {
      findings.add('D-02', { line: 1, columnName: 'Header Journal Amount Total', message: 'Header journal total must be a signed decimal of at most 23 characters.', value: displayValue(header.journalTotal) });
    }
    if (header.batchId !== undefined && !(NUMERIC.test(header.batchId) && header.batchId.length <= 13)) {
      findings.add('D-01', { line: 1, columnName: 'Header Batch ID', message: 'Header batch ID must be numeric (max 13 digits).', value: displayValue(header.batchId) });
    }
  }

  // ── Detail rows ────────────────────────────────────────────────────────
  const layout: (SaeColumn | undefined)[] = [];
  for (let column = 1; column <= expectedWidth; column += 1) layout.push(SAE_COLUMNS.get(column));

  let journalTotal = 0n;
  let journalAmounts = 0;
  const sequences = new Map<string, number>();
  const batchIds = new Map<string, number>();
  const batchDates = new Map<string, number>();
  const reports = new Map<string, ReportTotals>();
  const checkedEntries = new Set<string>();
  const allocations = new Map<string, { line: number; reportId?: string; percentages: Map<string, bigint> }>();
  const cardTransactions = new Map<string, { entryKey: string; line: number }>();
  let cardNumberRows = 0;
  let bankAccountRows = 0;

  for (const { line, fields } of detailLines) {
    const value = (column: number) => fields[column - 1] ?? '';
    const sequence = value(4) || undefined;
    const reportId = value(19) || undefined;
    const context = { line, sequence, reportId };

    if (fields.length !== expectedWidth) {
      findings.add('F-04', {
        ...context,
        message: `Row has ${fields.length} columns; the ${version === 'unknown' ? 'V3' : version} layout requires ${expectedWidth}.`,
      });
    }

    batchIds.set(value(2), (batchIds.get(value(2)) ?? 0) + 1);
    batchDates.set(value(3), (batchDates.get(value(3)) ?? 0) + 1);
    if (header.batchId !== undefined && value(2) !== header.batchId) {
      findings.add('F-05', { ...context, column: 2, columnName: 'Batch ID', message: `Batch ID differs from header batch ID ${header.batchId}.`, value: displayValue(value(2)) });
    }
    if (header.batchDate !== undefined && value(3) !== header.batchDate) {
      findings.add('F-05', { ...context, column: 3, columnName: 'Batch Date', message: `Batch date differs from header batch date ${header.batchDate}.`, value: displayValue(value(3)) });
    }

    if (sequence !== undefined) sequences.set(sequence, (sequences.get(sequence) ?? 0) + 1);

    // Field-level type, length, and domain checks.
    const width = Math.min(fields.length, expectedWidth);
    for (let column = 1; column <= width; column += 1) {
      const raw = fields[column - 1];
      if (raw === '') continue;
      const definition = layout[column - 1];
      if (!definition) continue;
      const finding = { ...context, column, columnName: definition.name, value: displayValue(raw, definition) };
      switch (definition.type) {
        case 'constant':
          break;
        case 'reserved':
          findings.add('F-10', { ...finding, message: 'Reserved Future Use column must stay empty.' });
          continue;
        case 'numeric':
          if (!NUMERIC.test(raw)) findings.add('D-01', { ...finding, message: 'Value must be numeric.' });
          break;
        case 'decimal':
          if (!DECIMAL.test(raw)) findings.add('D-01', { ...finding, message: 'Value must be a decimal number.' });
          break;
        case 'money':
          if (!DECIMAL.test(raw)) findings.add('D-02', { ...finding, message: 'Money value must be a signed decimal.' });
          else if (raw.length > 23) findings.add('D-02', { ...finding, message: `Money value has ${raw.length} characters; the maximum is 23.` });
          break;
        case 'date':
          if (!isSaeDate(raw)) findings.add('F-06', { ...finding, message: 'Date must be a valid yyyy-MM-dd date.' });
          break;
        case 'slashDate':
          if (!isCalendarDate(SLASH_DATE.exec(raw))) findings.add('F-06', { ...finding, message: 'Date must be a valid YYYY/MM/DD date.' });
          break;
        case 'flag':
          if (raw !== 'Y' && raw !== 'N') findings.add('D-05', { ...finding, message: 'Flag must be Y or N.' });
          break;
        case 'enum':
          if (!definition.values!.includes(raw)) {
            findings.add(definition.rule ?? 'D-16', { ...finding, message: `Value must be one of ${definition.values!.join(', ')}.` });
          }
          break;
        case 'currency':
          if (!/^[A-Z]{3}$/.test(raw)) findings.add('D-04', { ...finding, message: 'Currency must be a 3-letter ISO alpha code.' });
          else if (knownCurrencies && !knownCurrencies.has(raw)) findings.add('D-04', { ...finding, message: 'Currency is not a recognised ISO 4217 code.' });
          break;
        case 'country':
          if (!/^[A-Z]{2}$/.test(raw)) findings.add('D-04', { ...finding, message: 'Country must be a 2-letter ISO code.' });
          else if (!knownCountries.has(raw)) findings.add('D-04', { ...finding, message: 'Country is not a recognised ISO 3166 code.' });
          break;
        case 'text':
          break;
      }
      if (definition.maxLength !== undefined && raw.length > definition.maxLength) {
        const length = codePointLength(raw);
        if (length > definition.maxLength) {
          findings.add('D-03', { ...finding, message: `Value has ${length} characters; the maximum is ${definition.maxLength}.` });
        }
      }
    }

    if (value(305) && !DOCUMENTED_BANK_CURRENCIES.has(value(305))) {
      findings.add('D-15', { ...context, column: 305, columnName: saeColumnName(305), value: value(305), message: 'Bank account currency is outside the documented USD, EUR, AUD, GBP values.' });
    }

    // Journal (R-01, R-03, F-08) and cash advance (C-01, C-02, C-04).
    const cashAdvanceType = value(185);
    const journalAmount = value(169);
    const amount = journalAmount ? scaledAmount(journalAmount) : null;
    if (journalAmount) {
      journalAmounts += 1;
      if (amount !== null) journalTotal += amount;
      if (cashAdvanceType !== '1' && !value(19) && !value(20)) {
        findings.add('R-01', { ...context, message: 'Journal row has neither Report ID (19) nor Report Key (20).' });
      }
      if (!cashAdvanceType && !value(170)) {
        findings.add('R-03', { ...context, column: 170, columnName: saeColumnName(170), message: 'Journal amount is populated but the Journal Key is blank.' });
      }
      if (!value(168)) {
        findings.add('R-03', { ...context, column: 168, columnName: saeColumnName(168), message: 'Journal amount is populated but Debit/Credit is blank.' });
      }
      if (!value(167)) {
        const isZero = amount === 0n;
        findings.add('R-03', {
          ...context,
          column: 167,
          columnName: saeColumnName(167),
          severity: isZero ? 'warning' : 'error',
          value: displayValue(journalAmount),
          message: `${isZero ? 'Zero' : 'Non-zero'} journal amount has no Account Code (payer ${value(163) || '—'} → payee ${value(165) || '—'}).`,
        });
      }
    }

    if (cashAdvanceType === '1') {
      const problems = [
        value(163) !== 'Company' && `payer is ${value(163) || 'blank'}, expected Company`,
        !value(165) && 'payee is blank',
        value(168) !== 'DR' && `debit/credit is ${value(168) || 'blank'}, expected DR`,
        !value(167) && 'clearing account code is blank',
      ].filter(Boolean);
      if (problems.length) findings.add('C-01', { ...context, message: `Cash advance issue: ${problems.join('; ')}.` });
    } else if (cashAdvanceType === '2') {
      const problems = [
        value(163) !== 'Employee' && `payer is ${value(163) || 'blank'}, expected Employee`,
        value(165) !== 'Company' && `payee is ${value(165) || 'blank'}, expected Company`,
        value(168) !== 'CR' && `debit/credit is ${value(168) || 'blank'}, expected CR`,
        amount !== null && amount > 0n && `journal amount ${journalAmount} is positive`,
      ].filter(Boolean);
      if (problems.length) findings.add('C-02', { ...context, message: `Cash advance application: ${problems.join('; ')}.` });
    } else if (cashAdvanceType === '3' && !value(19) && !value(20)) {
      findings.add('C-04', { ...context, message: 'Balance-due record (type 3) has no Report ID or Report Key to identify its source report.' });
    }

    // Entry identity (R-02) and report totals (A-06).
    const entryKey = value(61);
    if (value(19) && !entryKey && !cashAdvanceType) {
      findings.add('R-02', { ...context, column: 61, columnName: saeColumnName(61), message: 'Report row has no Report Entry Key.' });
    }
    if (value(19)) {
      keys.reportIds.add(value(19));
      let report = reports.get(value(19));
      if (!report) {
        report = { reportId: value(19), line, totalPosted: value(31), totalApproved: value(32), entries: new Map() };
        reports.set(value(19), report);
      }
      if (entryKey && !report.entries.has(entryKey)) {
        report.entries.set(entryKey, { posted: scaledAmount(value(124)) ?? 0n, approved: scaledAmount(value(125)) ?? 0n });
      }
    }

    // Entry amounts (A-02 to A-05). Journal and allocation rows repeat the
    // entry columns, so arithmetic is checked once per distinct entry key.
    if (entryKey && !checkedEntries.has(entryKey)) {
      checkedEntries.add(entryKey);
      checkEntryAmounts(findings, context, value);
    }

    // Allocations (R-04, R-05).
    const allocationKey = value(189);
    if (allocationKey || value(190)) {
      if (!allocationKey || !value(190)) {
        findings.add('R-04', { ...context, message: 'Allocation row needs both Allocation Key (189) and Percentage (190).' });
      } else if (entryKey) {
        let entry = allocations.get(entryKey);
        if (!entry) {
          entry = { line, reportId, percentages: new Map() };
          allocations.set(entryKey, entry);
        }
        if (!entry.percentages.has(allocationKey)) entry.percentages.set(allocationKey, scaledAmount(value(190)) ?? 0n);
      }
      let dimensionPopulated = false;
      for (let column = 191; column <= 210; column += 1) {
        if (value(column)) {
          dimensionPopulated = true;
          break;
        }
      }
      if (!dimensionPopulated) {
        findings.add('R-05', { ...context, message: 'Every allocation custom field (191–210) is blank; map accounting dimensions from the entry-level source instead.' });
      }
    }

    // Card references (A-08) and sensitive data (S-01, S-02).
    const cardTransactionId = value(136);
    if (cardTransactionId) {
      keys.cardTransactionIds.add(cardTransactionId);
      const previous = cardTransactions.get(cardTransactionId);
      if (!previous) {
        cardTransactions.set(cardTransactionId, { entryKey, line });
      } else if (previous.entryKey !== entryKey && value(62) !== 'CHD') {
        findings.add('A-08', {
          ...context,
          column: 136,
          columnName: saeColumnName(136),
          value: displayValue(cardTransactionId),
          message: `Card transaction ID is also used by entry ${previous.entryKey || '—'} (line ${previous.line}).`,
        });
      }
    }
    if (CARD_NUMBER.test(value(130)) || CARD_NUMBER.test(value(154))) cardNumberRows += 1;
    if (value(16) || value(17)) bankAccountRows += 1;

    if (version === 'V3') {
      for (const column of [313, 314]) {
        const due = value(column) ? scaledAmount(value(column)) : null;
        if (due !== null && due < 0n) {
          findings.add('A-07', { ...context, column, columnName: saeColumnName(column), value: value(column), message: 'Payment-safe due amount must not be negative; signed values belong in columns 319–320.' });
        }
      }
    }
  }

  // ── File-level reconciliation ──────────────────────────────────────────
  if (header.recordCount !== undefined && NUMERIC.test(header.recordCount) && Number(header.recordCount) !== detailLines.length) {
    findings.add('F-07', { line: 1, message: `Header record count is ${header.recordCount} but the file has ${detailLines.length} DETAIL rows.` });
  }

  const headerTotal = header.journalTotal !== undefined ? scaledAmount(header.journalTotal) : null;
  if (headerTotal !== null) {
    const difference = headerTotal - journalTotal;
    if (Math.abs(toNumber(difference)) > JOURNAL_TOTAL_TOLERANCE) {
      findings.add('F-08', {
        line: 1,
        message: `Header journal total ${header.journalTotal} differs from the sum of ${journalAmounts} journal amounts ${formatScaledAmount(journalTotal)} by ${formatScaledAmount(difference)}.`,
      });
    }
  }

  // V2 headers carry no batch ID, so consistency is checked across the detail rows.
  if (header.batchId === undefined && batchIds.size > 1) {
    findings.add('F-05', { message: `Detail rows use ${batchIds.size} different batch IDs: ${[...batchIds.keys()].slice(0, 5).join(', ')}.` });
  }
  if (header.batchDate === undefined && batchDates.size > 1) {
    findings.add('F-05', { message: `Detail rows use ${batchDates.size} different batch dates.` });
  }
  const batchId = header.batchId ?? (batchIds.size === 1 ? [...batchIds.keys()][0] : undefined);
  keys.batchId = batchId || undefined;

  checkSequences(findings, detailLines, sequences);

  for (const [entryKey, allocation] of allocations) {
    let total = 0n;
    for (const percentage of allocation.percentages.values()) total += percentage;
    if (Math.abs(toNumber(total) - 100) > 0.01) {
      findings.add('R-04', {
        line: allocation.line,
        reportId: allocation.reportId,
        message: `Allocations of entry ${entryKey} total ${formatScaledAmount(total)}% across ${allocation.percentages.size} allocation keys, not 100%.`,
      });
    }
  }

  for (const report of reports.values()) {
    if (report.entries.size === 0) continue;
    let posted = 0n;
    let approved = 0n;
    for (const entry of report.entries.values()) {
      posted += entry.posted;
      approved += entry.approved;
    }
    const totalPosted = scaledAmount(report.totalPosted);
    const totalApproved = scaledAmount(report.totalApproved);
    const mismatches = [
      totalPosted !== null && totalPosted !== posted && `total posted ${report.totalPosted} vs entries ${formatScaledAmount(posted)}`,
      totalApproved !== null && totalApproved !== approved && `total approved ${report.totalApproved} vs entries ${formatScaledAmount(approved)}`,
    ].filter(Boolean);
    if (mismatches.length) {
      findings.add('A-06', {
        line: report.line,
        reportId: report.reportId,
        message: `Report totals do not match its ${report.entries.size} extracted entries: ${mismatches.join('; ')}. Entries outside this extract can explain a difference.`,
      });
    }
  }

  if (cardNumberRows > 0) {
    findings.add('S-01', { message: `${cardNumberRows} rows contain full card account numbers in columns 130/154. Restrict access to this file; values are masked in this report.` });
  }
  if (bankAccountRows > 0) {
    findings.add('S-02', { message: `${bankAccountRows} rows contain employee bank account or routing numbers (columns 16–17). Confirm they were explicitly approved for the extract scope.` });
  }

  const rules = findings.summaries();
  return {
    result: {
      name,
      path,
      size: content.length,
      version,
      header,
      batchId: keys.batchId,
      detailRows: detailLines.length,
      reportCount: reports.size,
      computedJournalTotal: journalAmounts > 0 || headerTotal !== null ? formatScaledAmount(journalTotal) : undefined,
      errors: rules.reduce((sum, rule) => sum + rule.errors, 0),
      warnings: rules.reduce((sum, rule) => sum + rule.warnings, 0),
      rules,
    },
    keys,
  };
}

function checkEntryAmounts(
  findings: FindingCollector,
  context: { line: number; sequence?: string; reportId?: string },
  value: (column: number) => string
): void {
  const transaction = scaledAmount(value(123));
  const posted = scaledAmount(value(124));
  const approved = scaledAmount(value(125));

  // A-02: posted = transaction × rate (M) or ÷ rate (D). The rate is published
  // to four decimals and the posted amount is rounded to the reimbursement
  // currency's minor unit, so both roundings bound the acceptable difference.
  const rate = Number(value(66));
  const spendCurrency = value(65);
  const reimbursementCurrency = value(22);
  if (transaction !== null && posted !== null && rate > 0 && spendCurrency && reimbursementCurrency && spendCurrency !== reimbursementCurrency) {
    const amount = toNumber(transaction);
    const divide = value(67) === 'D';
    const expected = divide ? amount / rate : amount * rate;
    const rateRounding = divide ? (Math.abs(amount) * 0.00005) / (rate * rate) : Math.abs(amount) * 0.00005;
    const tolerance = rateRounding + 0.5 * 10 ** -currencyMinorUnits(reimbursementCurrency) + 1e-9;
    if (Math.abs(expected - toNumber(posted)) > tolerance) {
      findings.add('A-02', {
        ...context,
        column: 124,
        columnName: saeColumnName(124),
        value: value(124),
        message: `${value(123)} ${spendCurrency} ${divide ? '÷' : '×'} ${value(66)} = ${expected.toFixed(4)} ${reimbursementCurrency}, but the posted amount is ${value(124)}.`,
      });
    }
  }

  const taxPosted = value(246) ? scaledAmount(value(246)) : null;
  const netTax = value(247) ? scaledAmount(value(247)) : null;
  if (posted !== null && taxPosted !== null && netTax !== null && posted - taxPosted !== netTax) {
    findings.add('A-03', {
      ...context,
      column: 247,
      columnName: saeColumnName(247),
      value: value(247),
      message: `Net tax ${value(247)} ≠ posted ${value(124)} − total tax posted ${value(246)} (${formatScaledAmount(posted - taxPosted)}).`,
    });
  }

  const reclaim = value(248) ? scaledAmount(value(248)) : null;
  const netReclaim = value(249) ? scaledAmount(value(249)) : null;
  if (approved !== null && reclaim !== null && netReclaim !== null && approved - reclaim !== netReclaim) {
    findings.add('A-04', {
      ...context,
      column: 249,
      columnName: saeColumnName(249),
      value: value(249),
      message: `Net reclaim adjusted ${value(249)} ≠ approved ${value(125)} − total reclaim adjusted ${value(248)} (${formatScaledAmount(approved - reclaim)}).`,
    });
  }

  if (posted !== null && approved !== null && approved > posted) {
    findings.add('A-05', {
      ...context,
      column: 125,
      columnName: saeColumnName(125),
      value: value(125),
      message: `Approved amount ${value(125)} exceeds posted amount ${value(124)}.`,
    });
  }
}

function checkSequences(
  findings: FindingCollector,
  detailLines: { line: number; fields: string[] }[],
  sequences: Map<string, number>
): void {
  const reportedDuplicates = new Set<string>();
  const numbers: number[] = [];
  for (const { line, fields } of detailLines) {
    const sequence = fields[3] ?? '';
    if (!NUMERIC.test(sequence)) {
      findings.add('F-09', { line, sequence: sequence || undefined, column: 4, columnName: 'Sequence Number', value: displayValue(sequence), message: sequence ? 'Sequence number is not numeric.' : 'Sequence number is blank.' });
      continue;
    }
    numbers.push(Number(sequence));
    if ((sequences.get(sequence) ?? 0) > 1 && !reportedDuplicates.has(sequence)) {
      reportedDuplicates.add(sequence);
      findings.add('F-09', { line, sequence, column: 4, columnName: 'Sequence Number', value: sequence, message: `Sequence number appears ${sequences.get(sequence)} times.` });
    }
  }
  if (numbers.length === 0) return;
  const present = new Set(numbers);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const missing = max - min + 1 - present.size;
  if (missing > 0) {
    const examples: number[] = [];
    for (let sequence = min; sequence <= max && examples.length < 10; sequence += 1) {
      if (!present.has(sequence)) examples.push(sequence);
    }
    findings.add('F-09', { message: `${missing} sequence numbers are missing between ${min} and ${max} (e.g. ${examples.join(', ')}).` });
  }
}

export interface SaeCrossFileFinding {
  rule: string;
  severity: SaeSeverity;
  title: string;
  message: string;
  files: string[];
}

/** Batch-level controls across several files (spec 6.3: never post a batch twice). */
export function crossFileFindings(files: { name: string; keys: SaeFileKeys }[]): SaeCrossFileFinding[] {
  const results: SaeCrossFileFinding[] = [];
  const push = (rule: string, message: string, names: string[]) => {
    results.push({ rule, severity: SAE_RULES[rule].severity, title: SAE_RULES[rule].title, message, files: names });
  };

  const byBatch = new Map<string, string[]>();
  for (const file of files) {
    if (!file.keys.batchId) continue;
    byBatch.set(file.keys.batchId, [...(byBatch.get(file.keys.batchId) ?? []), file.name]);
  }
  for (const [batchId, names] of byBatch) {
    if (names.length > 1) push('X-01', `Batch ID ${batchId} appears in ${names.length} files.`, names);
  }

  for (const [rule, select, label] of [
    ['X-02', (keys: SaeFileKeys) => keys.reportIds, 'Report ID'],
    ['X-03', (keys: SaeFileKeys) => keys.cardTransactionIds, 'Card transaction ID'],
  ] as const) {
    const owners = new Map<string, string[]>();
    for (const file of files) {
      for (const key of select(file.keys)) owners.set(key, [...(owners.get(key) ?? []), file.name]);
    }
    let reported = 0;
    let total = 0;
    for (const [key, names] of owners) {
      if (names.length < 2) continue;
      total += 1;
      if (reported < MAX_FINDINGS_PER_RULE) {
        push(rule, `${label} ${displayValue(key)} appears in ${names.length} files.`, names);
        reported += 1;
      }
    }
    if (total > reported) push(rule, `${total - reported} more ${label}s appear in more than one file.`, []);
  }
  return results;
}
