/**
 * SAE V3 positional layout (docs/EXP_SPEC_SAE_V3.md, section 4).
 *
 * SAE is a fixed-column, pipe-delimited format, so every check is positional:
 * the column number is the only reliable key. V2 extracts (4-field header,
 * 256 detail columns) share the meaning of columns 1–256 with V3 — verified
 * against real CES V2 extracts — so the same catalogue validates both, and the
 * validator simply never reaches the V3-only columns for a V2 file.
 */

export type SaeFieldType =
  | 'constant'
  | 'text'
  | 'numeric'
  | 'decimal'
  | 'money'
  | 'date'
  | 'slashDate'
  | 'flag'
  | 'enum'
  | 'currency'
  | 'country'
  | 'reserved';

export interface SaeColumn {
  column: number;
  name: string;
  type: SaeFieldType;
  maxLength?: number;
  values?: readonly string[];
  /** Spec rule an out-of-list enum value violates; defaults to the generic code-list rule. */
  rule?: string;
  /** Card, bank, and personal-contact values are masked wherever a finding echoes them (S-01, S-04). */
  sensitive?: boolean;
}

export const SAE_V2_DETAIL_COLUMNS = 256;
export const SAE_V3_DETAIL_COLUMNS = 400;

const columns = new Map<number, SaeColumn>();

function define(column: number, name: string, type: SaeFieldType, extra: Partial<SaeColumn> = {}): void {
  columns.set(column, { column, name, type, ...extra });
}

function defineRange(from: number, to: number, name: (index: number) => string, type: SaeFieldType, extra: Partial<SaeColumn> = {}): void {
  for (let column = from; column <= to; column += 1) define(column, name(column - from + 1), type, extra);
}

function reserve(from: number, to: number): void {
  defineRange(from, to, () => 'Future Use', 'reserved');
}

const TA_PROVIDED = ['NPR', 'PRO', 'TAX', 'BSE', 'CVT', 'WRK', 'INC', 'EXT'] as const;

// Detail prefix — 2.3
define(1, 'Constant', 'constant');
define(2, 'Batch ID', 'numeric', { maxLength: 13 });
define(3, 'Batch Date', 'date');
define(4, 'Sequence Number', 'numeric');

// Employee — 4.1
define(5, 'Employee ID', 'text', { maxLength: 48 });
define(6, 'Employee Last Name', 'text', { maxLength: 32 });
define(7, 'Employee First Name', 'text', { maxLength: 32 });
define(8, 'Employee Middle Initial', 'text', { maxLength: 1 });
define(9, 'Employee Group ID', 'text', { maxLength: 48 });
defineRange(10, 15, (i) => `Employee Org Unit ${i}`, 'text', { maxLength: 48 });
define(16, 'Employee Bank Account Number', 'text', { maxLength: 100, sensitive: true });
define(17, 'Employee Bank Routing Number', 'text', { maxLength: 100, sensitive: true });
define(18, 'Journal Net of Total Adjusted Reclaim Tax', 'money');

// Report — 4.2
define(19, 'Report ID', 'text', { maxLength: 32 });
define(20, 'Report Key', 'numeric', { maxLength: 48 });
define(21, 'Ledger Code', 'text', { maxLength: 20 });
define(22, 'Reimbursement Currency', 'currency');
define(23, 'Home Country', 'text', { maxLength: 64 });
define(24, 'Report Submit Date', 'date');
define(25, 'Report User-Defined Date', 'date');
define(26, 'Report Payment Processing Date', 'date');
define(27, 'Report Name', 'text', { maxLength: 40 });
define(28, 'Report Image Required', 'flag');
define(29, 'Report Has VAT Entry', 'flag');
define(30, 'Report Has TA Entry', 'flag');
define(31, 'Report Total Posted Amount', 'money');
define(32, 'Report Total Approved Amount', 'money');
define(33, 'Report Policy Name', 'text', { maxLength: 64 });
define(34, 'Budget Accrual Date', 'date');
defineRange(35, 40, (i) => `Report Org Unit ${i}`, 'text', { maxLength: 48 });
defineRange(41, 60, (i) => `Report Custom ${i}`, 'text', { maxLength: 48 });

// Report entry — 4.3
define(61, 'Report Entry Key', 'numeric', { maxLength: 13 });
define(62, 'Entry Transaction Type', 'enum', { values: ['REG', 'CHD'], rule: 'D-08' });
define(63, 'Expense Type Name', 'text', { maxLength: 64 });
define(64, 'Entry Transaction Date', 'date');
define(65, 'Entry Spend Currency', 'currency');
define(66, 'Entry Exchange Rate', 'decimal', { maxLength: 23 });
define(67, 'Exchange Rate Direction', 'enum', { values: ['M', 'D'], rule: 'D-07' });
define(68, 'Entry Is Personal', 'flag');
define(69, 'Entry Description', 'text', { maxLength: 64 });
define(70, 'Entry Vendor Name', 'text', { maxLength: 64 });
define(71, 'Entry Vendor Description', 'text', { maxLength: 64 });
define(72, 'Entry Receipt Received', 'flag');
define(73, 'Entry Receipt Type', 'enum', { values: ['T', 'R', 'N'], rule: 'D-09' });
define(74, 'Employee Attendee Count', 'numeric');
define(75, 'Spouse Attendee Count', 'numeric');
define(76, 'Business Guest Attendee Count', 'numeric');
defineRange(77, 82, (i) => `Entry Org Unit ${i}`, 'text', { maxLength: 48 });
defineRange(83, 122, (i) => `Entry Custom ${i}`, 'text', { maxLength: 48 });
define(123, 'Entry Transaction Amount', 'money');
define(124, 'Entry Posted Amount', 'money');
define(125, 'Entry Approved Amount', 'money');
define(126, 'Payment Type Code', 'text', { maxLength: 4 });
define(127, 'Payment Type Name', 'text', { maxLength: 80 });
define(128, 'Reimbursement Type', 'enum', { values: ['1'] });

// Credit card — 4.4
define(129, 'Card Billing Date', 'date');
define(130, 'Billed Card Account Number', 'text', { maxLength: 255, sensitive: true });
define(131, 'Billed Card Account Description', 'text', { maxLength: 255 });
define(132, 'Card Journal Import Key', 'text');
define(133, 'Card Vendor Reference', 'text');
define(134, 'Card Transaction Key', 'text');
define(135, 'Card Transaction Type', 'enum', { values: ['ANF', 'CAV', 'CCF', 'CHG', 'FNC', 'LAF', 'NSF', 'PAY', 'RPE'] });
define(136, 'Card Transaction ID', 'text');
define(137, 'Card Transaction Amount', 'money');
define(138, 'Card Tax Amount', 'money');
define(139, 'Card Transaction Currency', 'currency');
define(140, 'Card Posted Amount', 'money');
define(141, 'Card Posted Currency', 'currency');
define(142, 'Card Transaction Date', 'date');
define(143, 'Card Posted Date', 'date');
define(144, 'Merchant Description', 'text', { maxLength: 42 });
define(145, 'Merchant Category Code', 'text', { maxLength: 5 });
define(146, 'Merchant Name', 'text', { maxLength: 128 });
define(147, 'Merchant City', 'text', { maxLength: 40 });
define(148, 'Merchant State', 'text', { maxLength: 32 });
define(149, 'Merchant Country', 'country');
define(150, 'Merchant Reference', 'text', { maxLength: 15 });
define(151, 'Card Billing Type', 'text', { maxLength: 2 });
define(152, 'Billing-to-Employee Exchange Rate', 'decimal', { maxLength: 23 });
define(153, 'Billing Amount', 'money');
define(154, 'Individual Card Account Number', 'text', { sensitive: true });
define(155, 'Name on Card', 'text');
define(156, 'Merchant DBA Name', 'text');
define(157, 'Acquirer Reference Number', 'numeric', { maxLength: 50 });

// Location and journal — 4.5
define(158, 'Spend Location Country', 'country');
define(159, 'Spend Location Subdivision', 'text', { maxLength: 6 });
define(160, 'Foreign/Domestic Flag', 'enum', { values: ['FRGN', 'HOME', 'OOSD'], rule: 'D-11' });
define(161, 'Market Code', 'text', { maxLength: 255 });
// The spec labels the processor reference numeric, but card feeds deliver
// alphanumeric references (e.g. `6000044O2Y…`). Treating it as numeric would
// flag every card row, so only its length is enforced.
define(162, 'Processor Reference Number', 'text', { maxLength: 64 });
define(163, 'Journal Payer Payment Type', 'text', { maxLength: 80 });
define(164, 'Journal Payer Payment Code', 'text', { maxLength: 80 });
define(165, 'Journal Payee Payment Type', 'text', { maxLength: 80 });
define(166, 'Journal Payee Payment Code', 'text', { maxLength: 80 });
define(167, 'Journal Account Code', 'text', { maxLength: 48 });
define(168, 'Journal Debit/Credit', 'enum', { values: ['DR', 'CR'], rule: 'D-06' });
define(169, 'Journal Amount', 'money');
define(170, 'Journal Key', 'numeric', { maxLength: 10 });

// Mileage and cash advance — 4.6
define(171, 'Business Distance', 'numeric');
define(172, 'Personal Distance', 'numeric');
define(173, 'Passenger Count', 'numeric');
define(174, 'Vehicle ID', 'text');
define(175, 'Card Sales Tax Amount', 'money');
define(176, 'Card Sales Tax Vendor', 'text');
define(177, 'Cash Advance Request Amount', 'money');
define(178, 'Cash Advance Currency', 'currency');
define(179, 'Cash Advance Currency Numeric Code', 'numeric', { maxLength: 3 });
define(180, 'Cash Advance Exchange Rate', 'decimal', { maxLength: 23 });
define(181, 'Cash Advance Reimbursement Currency', 'currency');
define(182, 'Cash Advance Reimbursement Currency Numeric Code', 'numeric', { maxLength: 3 });
define(183, 'Cash Advance Issued Date', 'date');
define(184, 'Cash Advance Payment Code', 'text', { maxLength: 80 });
define(185, 'Cash Advance Transaction Type', 'enum', { values: ['1', '2', '3'], rule: 'D-12' });
define(186, 'Cash Advance Request Date', 'date');
define(187, 'Cash Advance Key', 'numeric');
define(188, 'Cash Advance Disbursement Method', 'enum', { values: ['0', '1'] });

// Allocation — 4.7
define(189, 'Allocation Key', 'numeric');
define(190, 'Allocation Percentage', 'decimal', { maxLength: 11 });
defineRange(191, 210, (i) => `Allocation Custom ${i}`, 'text', { maxLength: 48 });
define(211, 'Allocation Journal Net of Tax', 'money');

// Travel allowance — 4.8
define(212, 'TA Reimbursable Meal/Lodging Type', 'enum', { values: ['M', 'L', 'C'] });
define(213, 'TA Display Limit', 'money');
define(214, 'TA Allowance Limit', 'money');
define(215, 'TA Allowable Threshold', 'money');
define(216, 'TA Fixed Meal/Lodging Type', 'enum', { values: ['M', 'L'] });
define(217, 'TA Base Amount', 'money');
define(218, 'TA Allowance Amount', 'money');
define(219, 'TA Overnight', 'flag');
define(220, 'TA Breakfast Provided', 'enum', { values: TA_PROVIDED, rule: 'D-14' });
define(221, 'TA Lunch Provided', 'enum', { values: TA_PROVIDED, rule: 'D-14' });
define(222, 'TA Dinner Provided', 'enum', { values: TA_PROVIDED, rule: 'D-14' });
define(223, 'TA Total Tax Adjusted Posted Amount', 'money');
define(224, 'TA Reclaim Adjusted Amount', 'money');

// VAT — 4.9
define(225, 'Tax Authority Name', 'text', { maxLength: 50 });
define(226, 'Tax Label', 'text', { maxLength: 5 });
define(227, 'Tax Transaction Amount', 'money');
define(228, 'Tax Posted Amount', 'money');
define(229, 'Tax Source', 'enum', { values: ['CARD', 'USER', 'SYST', 'PROC'], rule: 'D-10' });
define(230, 'Reclaim Transaction Amount', 'money');
define(231, 'Reclaim Posted Amount', 'money');
define(232, 'Tax Code', 'text', { maxLength: 20 });
define(233, 'Domestic Reclaim', 'flag');
define(234, 'Adjusted Tax Amount', 'money');
define(235, 'Adjusted Reclaim Amount', 'money');
define(236, 'Reclaim Code', 'text', { maxLength: 20 });
define(237, 'Reclaim Transaction Adjusted Amount', 'money');
define(238, 'Allocation Reclaim Code', 'text', { maxLength: 20 });

// Travel request, additional tax, company bill, Expense Pay — 4.10
define(239, 'Assigned Request ID', 'text');
define(240, 'Assigned Request Name', 'text');
define(241, 'Assigned Request Total Posted Amount', 'money');
define(242, 'Assigned Request Total Approved Amount', 'money');
define(243, 'Assigned Request Start Date', 'date');
define(244, 'Assigned Request End Date', 'date');
define(245, 'Assigned Request Authorized Date', 'date');
define(246, 'Entry Total Tax Posted Amount', 'money');
define(247, 'Entry Net Tax Amount', 'money');
define(248, 'Entry Total Reclaim Adjusted Amount', 'money');
define(249, 'Entry Net Reclaim Adjusted Amount', 'money');
define(250, 'Entry Payment Type Name', 'text', { maxLength: 80 });
define(251, 'Card Program Type', 'text');
define(252, 'Statement Period Start Date', 'date');
define(253, 'Statement Period End Date', 'date');
define(254, 'Funding Cash Account Code', 'text');
define(255, 'Funding Liability Account Code', 'text');
define(256, 'Estimated Payment Date', 'slashDate');
define(257, 'Funding Trace Number', 'text', { maxLength: 30 });
define(258, 'Cash Advance Requested Disbursement Date', 'date');
define(259, 'Cash Advance Request Name', 'text');
define(260, 'System Allocation', 'flag');
reserve(261, 263);

// Additional employee and banking — 4.11
define(264, 'Employee Login ID', 'text', { maxLength: 128, sensitive: true });
define(265, 'Employee Email Address', 'text', { maxLength: 255, sensitive: true });
defineRange(266, 285, (i) => `Employee Custom ${i}`, 'text', { maxLength: 48 });
reserve(286, 290);
define(291, 'Bank Account Active', 'flag');
define(292, 'Bank Account Type', 'enum', { values: ['CHCK', 'SAVE'] });
defineRange(293, 301, (i) => `Employee Banking Detail ${i}`, 'text');
define(302, 'Bank Tax ID', 'text', { sensitive: true });
defineRange(303, 304, (i) => `Employee Banking Detail ${i + 9}`, 'text');
define(305, 'Bank Account Currency', 'currency');
reserve(306, 310);

// Additional report, cash advance, entry, tax, request — 4.12
define(311, 'Report Total Personal Amount', 'money');
define(312, 'Report Total Claimed Amount', 'money');
define(313, 'Report Amount Due Employee', 'money');
define(314, 'Report Amount Due Company Card', 'money');
define(315, 'Report Total Rejected Amount', 'money');
define(316, 'Report Total Company Paid', 'money');
define(317, 'Report Amount Due Company', 'money');
define(318, 'Report Total Confirmed Paid', 'money');
define(319, 'Report Actual Total Due Employee', 'money');
define(320, 'Report Actual Total Due Company Card', 'money');
define(321, 'Report Type', 'enum', { values: ['RR', 'CR', 'SR'], rule: 'D-13' });
define(322, 'Report Total Tax Adjusted', 'money');
define(323, 'Report Net Adjusted Tax', 'money');
define(324, 'Report Start Date', 'date');
define(325, 'Report End Date', 'date');
reserve(326, 326);
define(327, 'Cash Advance Returned Amount', 'money');
define(328, 'Cash Advance Return Received', 'flag');
define(329, 'Cash Advance Utilized Amount', 'money');
reserve(330, 333);
define(334, 'Entry Location City', 'text');
define(335, 'Entry Billable', 'flag');
define(336, 'Entry From Location', 'text');
define(337, 'Entry To Location', 'text');
define(338, 'Entry Location Name', 'text');
define(339, 'Entry Location Country', 'text');
define(340, 'Entry Location Subdivision', 'text');
define(341, 'XML Receipt UUID', 'text', { maxLength: 36 });
define(342, 'XML Receipt Supplier Tax ID', 'text', { maxLength: 64 });
reserve(343, 346);
defineRange(347, 351, (i) => `Allocation Tax Total ${i}`, 'money');
define(352, 'Merchant Tax ID', 'text', { maxLength: 64 });
reserve(353, 356);
define(357, 'Request Name', 'text');
define(358, 'Request Total Posted Amount', 'money');
define(359, 'Request Total Approved Amount', 'money');
define(360, 'Request Start Date', 'date');
define(361, 'Request End Date', 'date');
define(362, 'Request Authorized Date', 'date');
define(363, 'Request ID', 'text');
reserve(364, 400);

export const SAE_COLUMNS: ReadonlyMap<number, SaeColumn> = columns;

export function saeColumnName(column: number): string {
  return columns.get(column)?.name ?? `Column ${column}`;
}
