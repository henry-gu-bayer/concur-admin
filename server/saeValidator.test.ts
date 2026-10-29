import { describe, expect, it } from 'vitest';
import { crossFileFindings, formatScaledAmount, maskSensitive, scaledAmount, validateSaeContent, type SaeFileResult } from './saeValidator';

/**
 * Build a detail row from sparse column values. Columns are 1-based, matching
 * the spec, so fixtures read like the field catalogue.
 */
function detail(width: number, values: Record<number, string>): string {
  const fields = Array.from({ length: width }, () => '');
  fields[0] = 'DETAIL';
  for (const [column, value] of Object.entries(values)) fields[Number(column) - 1] = value;
  return fields.join('|');
}

const BATCH = { 2: '4943', 3: '2026-10-15' };

/** A balanced expense entry: debit expense, credit employee, VAT reclaimed. */
function expenseRows(width: number, sequenceStart: number, overrides: Record<number, string> = {}) {
  const entry = {
    ...BATCH,
    5: '06045348', 19: 'RPT-1', 20: '11721848', 22: 'JPY', 24: '2026-10-09', 28: 'N', 29: 'Y', 30: 'N',
    31: '500.0000', 32: '500.0000', 61: '9001', 62: 'REG', 64: '2026-08-26', 65: 'JPY', 66: '1.0000', 67: 'M',
    68: 'N', 72: 'Y', 73: 'T', 123: '500.0000', 124: '500.0000', 125: '500.0000', 158: 'JP', 160: 'HOME',
    189: '7001', 190: '100.0000', 201: '0134', 246: '45.0000', 247: '455.0000', 248: '45.0000', 249: '455.0000',
    ...overrides,
  };
  return [
    detail(width, { ...entry, 4: String(sequenceStart), 163: 'Company', 165: 'Employee', 167: '6100000', 168: 'DR', 169: '+455.0000', 170: '5001' }),
    detail(width, { ...entry, 4: String(sequenceStart + 1), 163: 'JPVAT', 165: 'Company', 167: '1240000', 168: 'DR', 169: '+45.0000', 170: '5001' }),
  ];
}

function sae(lines: string[]): Buffer {
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf-8');
}

function run(lines: string[]): SaeFileResult {
  return validateSaeContent('extract.txt', '/tmp/extract.txt', sae(lines)).result;
}

function rule(result: SaeFileResult, id: string) {
  return result.rules.find((entry) => entry.rule === id);
}

describe('SAE amounts', () => {
  it('sums large 4-decimal totals exactly', () => {
    const values = ['395453957.2500', '-0.0001', '+0.0001'];
    const total = values.reduce((sum, value) => sum + scaledAmount(value)!, 0n);
    expect(formatScaledAmount(total)).toBe('395453957.2500');
    expect(scaledAmount('1,000.00')).toBeNull();
  });

  it('masks all but the last four characters of sensitive values', () => {
    expect(maskSensitive('4980123456781234')).toBe('****1234');
    expect(maskSensitive('123')).toBe('****');
  });
});

describe('SAE file validation', () => {
  it('accepts a clean V3 file', () => {
    const result = run(['EXTRACT|2026-10-15|2|500.0000|4943', ...expenseRows(400, 1)]);
    expect(result).toMatchObject({ version: 'V3', batchId: '4943', detailRows: 2, reportCount: 1, errors: 0, warnings: 0 });
    expect(result.computedJournalTotal).toBe('500.0000');
  });

  it('detects a V2 file and checks it against the first 256 columns', () => {
    const result = run(['EXTRACT|2026-10-15|2|500.0000', ...expenseRows(256, 1)]);
    expect(result).toMatchObject({ version: 'V2', batchId: '4943', errors: 0, warnings: 0 });
  });

  it('reports header, count, and journal total reconciliation failures', () => {
    const result = run(['EXTRACT|2026-13-01|3|600.0000|4943', ...expenseRows(400, 1)]);
    expect(rule(result, 'F-06')?.findings[0]).toMatchObject({ line: 1, value: '2026-13-01' });
    expect(rule(result, 'F-07')?.findings[0].message).toContain('3 but the file has 2');
    expect(rule(result, 'F-08')?.findings[0].message).toContain('by 100.0000');
  });

  it('flags a missing header and rows that are not DETAIL', () => {
    const result = run([...expenseRows(400, 1), 'TRAILER|x']);
    expect(rule(result, 'F-01')).toBeDefined();
    expect(rule(result, 'F-03')?.findings[0]).toMatchObject({ line: 3, value: 'TRAILER' });
  });

  it('flags truncated rows and batch mismatches', () => {
    const [first, second] = expenseRows(400, 1);
    const truncated = first.split('|').slice(0, 300).join('|');
    const otherBatch = second.replace('|4943|', '|4944|');
    const result = run(['EXTRACT|2026-10-15|2|500.0000|4943', truncated, otherBatch]);
    expect(rule(result, 'F-04')?.findings[0].message).toContain('300 columns');
    expect(rule(result, 'F-05')?.findings[0]).toMatchObject({ column: 2, value: '4944' });
  });

  it('validates field formats, code values, and lengths with spec rule IDs', () => {
    const result = run([
      'EXTRACT|2026-10-15|2|500.0000|4943',
      ...expenseRows(400, 1, { 22: 'JP', 28: 'X', 62: 'PAR', 64: '2026/08/26', 73: 'Z', 160: 'ABRD', 27: 'x'.repeat(41), 158: 'ZZ', 270: 'reserved' }),
    ]);
    expect(rule(result, 'D-04')?.findings.map((finding) => finding.column)).toEqual(expect.arrayContaining([22, 158]));
    expect(rule(result, 'D-05')?.findings[0]).toMatchObject({ column: 28, value: 'X' });
    expect(rule(result, 'D-08')?.findings[0].value).toBe('PAR');
    expect(rule(result, 'D-09')?.findings[0].value).toBe('Z');
    expect(rule(result, 'D-11')?.findings[0].value).toBe('ABRD');
    expect(rule(result, 'F-06')?.findings[0]).toMatchObject({ column: 64 });
    expect(rule(result, 'D-03')?.findings[0]).toMatchObject({ column: 27, message: expect.stringContaining('41 characters') });
    expect(rule(result, 'F-10')).toBeUndefined();
  });

  it('counts multibyte names by character, not UTF-16 unit', () => {
    const name = '技術普及費'.repeat(8); // 40 characters
    const result = run(['EXTRACT|2026-10-15|2|500.0000|4943', ...expenseRows(400, 1, { 27: name })]);
    expect(rule(result, 'D-03')).toBeUndefined();
  });

  it('keeps reserved V3 columns empty', () => {
    const result = run(['EXTRACT|2026-10-15|2|500.0000|4943', ...expenseRows(400, 1, { 288: 'local use' })]);
    expect(rule(result, 'F-10')?.findings[0]).toMatchObject({ column: 288 });
  });

  it('requires journal key, account code, and debit/credit on journal amounts', () => {
    const [expense, vat] = expenseRows(400, 1);
    const blankAccount = vat.split('|');
    blankAccount[166] = '';
    const zeroBlank = expenseRows(400, 3)[1].split('|');
    zeroBlank[166] = '';
    zeroBlank[168] = '0';
    const result = run(['EXTRACT|2026-10-15|3|455.0000|4943', expense, blankAccount.join('|'), zeroBlank.join('|')]);
    const r03 = rule(result, 'R-03')!;
    expect(r03).toMatchObject({ errors: 1, warnings: 1, severity: 'error' });
    expect(r03.findings[0].message).toContain('payer JPVAT');
  });

  it('checks tax arithmetic, approved vs posted, and FX conversion once per entry', () => {
    const result = run([
      'EXTRACT|2026-10-15|2|500.0000|4943',
      // 3.00 USD × 150 = 450 JPY, but 500 was posted.
      ...expenseRows(400, 1, { 65: 'USD', 66: '150.0000', 123: '3.0000', 247: '450.0000', 125: '510.0000', 249: '465.0000' }),
    ]);
    expect(rule(result, 'A-02')?.warnings).toBe(1);
    expect(rule(result, 'A-03')?.errors).toBe(1);
    expect(rule(result, 'A-05')?.warnings).toBe(1);
    expect(rule(result, 'A-04')).toBeUndefined();
  });

  it('tolerates exchange-rate rounding within the published precision', () => {
    // 2051.11 × 0.0394 = 80.81, posted 80.90: the true rate rounds to 0.0394.
    const result = run([
      'EXTRACT|2026-10-15|2|500.0000|4943',
      ...expenseRows(400, 1, { 22: 'SGD', 65: 'THB', 66: '0.0394', 123: '2051.1100', 124: '80.9000', 125: '80.9000', 31: '80.9000', 32: '80.9000', 247: '35.9000', 249: '35.9000' }),
    ]);
    expect(rule(result, 'A-02')).toBeUndefined();
  });

  it('reconciles report totals and allocation percentages', () => {
    const rows = expenseRows(400, 1, { 31: '600.0000', 190: '60.0000' });
    const result = run(['EXTRACT|2026-10-15|2|500.0000|4943', ...rows]);
    expect(rule(result, 'A-06')?.findings[0].message).toContain('total posted 600.0000 vs entries 500.0000');
    expect(rule(result, 'R-04')?.findings[0].message).toContain('60.0000%');
  });

  it('validates cash advance issue and application postings', () => {
    const issue = detail(400, { ...BATCH, 4: '1', 5: 'E1', 163: 'Employee', 165: 'Employee', 167: '0061P4SM100', 168: 'CR', 169: '+100.0000', 185: '1' });
    const application = detail(400, { ...BATCH, 4: '2', 5: 'E1', 19: 'RPT-9', 20: '9', 163: 'Employee', 165: 'Company', 168: 'CR', 169: '+100.0000', 185: '2', 167: '0061P4SM100' });
    const result = run(['EXTRACT|2026-10-15|2|200.0000|4943', issue, application]);
    expect(rule(result, 'C-01')?.findings[0].message).toContain('payer is Employee, expected Company');
    expect(rule(result, 'C-01')?.findings[0].message).toContain('expected DR');
    expect(rule(result, 'C-02')?.findings[0].message).toContain('is positive');
    expect(rule(result, 'R-01')).toBeUndefined();
    expect(rule(result, 'R-03')).toBeUndefined();
  });

  it('reports sequence gaps and duplicates', () => {
    const rows = [...expenseRows(400, 1), ...expenseRows(400, 4)];
    rows[3] = rows[3].replace('|4943|2026-10-15|5|', '|4943|2026-10-15|4|');
    const result = run(['EXTRACT|2026-10-15|4|1000.0000|4943', ...rows]);
    const messages = rule(result, 'F-09')!.findings.map((finding) => finding.message);
    expect(messages).toEqual(expect.arrayContaining(['Sequence number appears 2 times.', expect.stringContaining('1 sequence numbers are missing')]));
  });

  it('masks card numbers in findings and flags their presence', () => {
    const rows = expenseRows(400, 1, { 130: '4980123456781234', 154: 'MCCC49801234567812345' });
    const result = run(['EXTRACT|2026-10-15|2|500.0000|4943', ...rows]);
    expect(rule(result, 'S-01')?.findings[0].message).toContain('2 rows');
    expect(JSON.stringify(result)).not.toContain('4980123456781234');
  });

  it('flags files that are not valid UTF-8', () => {
    const content = Buffer.concat([sae(['EXTRACT|2026-10-15|0|0.0000|1']), Buffer.from([0xff, 0xfe])]);
    const { result } = validateSaeContent('bad.txt', '/tmp/bad.txt', content);
    expect(result.rules.map((entry) => entry.rule)).toContain('E-01');
  });

  it('caps retained findings but keeps the full count', () => {
    const rows = Array.from({ length: 150 }, (_, index) => detail(400, { ...BATCH, 4: String(index + 1), 28: 'X' }));
    const result = run(['EXTRACT|2026-10-15|150|0.0000|4943', ...rows]);
    expect(rule(result, 'D-05')).toMatchObject({ errors: 150 });
    expect(rule(result, 'D-05')!.findings).toHaveLength(100);
  });
});

describe('SAE cross-file checks', () => {
  it('flags repeated batches, reports, and card transactions', () => {
    const findings = crossFileFindings([
      { name: 'a.txt', keys: { batchId: '1', reportIds: new Set(['R1', 'R2']), cardTransactionIds: new Set(['T1']) } },
      { name: 'b.txt', keys: { batchId: '1', reportIds: new Set(['R2']), cardTransactionIds: new Set(['T1']) } },
      { name: 'c.txt', keys: { batchId: '2', reportIds: new Set(['R3']), cardTransactionIds: new Set() } },
    ]);
    expect(findings.map((finding) => finding.rule)).toEqual(['X-01', 'X-02', 'X-03']);
    expect(findings[1]).toMatchObject({ files: ['a.txt', 'b.txt'], message: expect.stringContaining('R2') });
  });
});
