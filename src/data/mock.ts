import { ConfigItem } from '../types';

/**
 * Mock Concur configuration objects.
 *
 * Timestamps are relative to a fixed reference so the UI renders deterministically.
 * These fixtures stand in for the real Concur retrieval layer (`api/concurClient`).
 */

const ref = new Date('2026-08-03T08:14:00Z').getTime();
const agoDays = (d: number) => new Date(ref - d * 86_400_000).toISOString();

/* ── Lists ─────────────────────────────────────────────────────────────── */

export const LIST_ITEMS: ConfigItem[] = [
  {
    id: 'list-cost-center',
    name: 'Cost Centers',
    summary: 'Connected · 1,284 items · 3 levels',
    status: 'active',
    updatedAt: agoDays(2),
    row: { type: 'Connected', items: '1,284', levels: '3' },
    fields: [
      { label: 'List ID', value: 'lst-cost-center-emea' },
      { label: 'Connected to', value: 'Expense field: Cost Center' },
      { label: 'Levels', value: '3 (Region → Company Code → Cost Center)' },
      { label: 'Source', value: 'SAP Controlling (nightly sync)' },
      { label: 'Last retrieval', value: 'Nightly · succeeded' },
    ],
    children: {
      columns: ['Code', 'Name', 'Level', 'Status'],
      rows: [
        ['EMEA', 'Europe, Middle East & Africa', '1', 'Active'],
        ['EMEA-1000', 'Bayer AG · Leverkusen', '2', 'Active'],
        ['EMEA-1000-CC10417', 'Pharma R&D — deactivated', '3', 'Inactive'],
        ['EMEA-1000-CC10421', 'Crop Science Ops', '3', 'Active'],
        ['AMER', 'Americas', '1', 'Active'],
      ],
    },
  },
  {
    id: 'list-vendor',
    name: 'Vendors',
    summary: 'Connected · 4,107 items · 1 level',
    status: 'active',
    updatedAt: agoDays(5),
    row: { type: 'Connected', items: '4,107', levels: '1' },
    fields: [
      { label: 'List ID', value: 'lst-vendor-global' },
      { label: 'Connected to', value: 'Invoice field: Vendor' },
      { label: 'Levels', value: '1 (flat)' },
      { label: 'Source', value: 'SAP Vendor Master (hourly sync)' },
      { label: 'Last retrieval', value: 'Hourly · succeeded' },
    ],
    children: {
      columns: ['Code', 'Name', 'Status'],
      rows: [
        ['V-88410', 'Münchener Bürobedarf GmbH', 'Active'],
        ['V-90211', 'Frankfurt Flug Service', 'Active'],
        ['V-77103', 'Legacy Supplier — merged', 'Inactive'],
      ],
    },
  },
  {
    id: 'list-project',
    name: 'Projects',
    summary: 'Standalone · 612 items · 2 levels',
    status: 'active',
    updatedAt: agoDays(11),
    row: { type: 'Standalone', items: '612', levels: '2' },
    fields: [
      { label: 'List ID', value: 'lst-project-rnd' },
      { label: 'Connected to', value: 'Expense field: Project' },
      { label: 'Levels', value: '2 (Program → Project)' },
      { label: 'Source', value: 'Maintained in Concur' },
      { label: 'Last retrieval', value: 'On demand' },
    ],
  },
  {
    id: 'list-travel-agency',
    name: 'Travel Agencies',
    summary: 'Connected · 23 items · 1 level',
    status: 'active',
    updatedAt: agoDays(30),
    row: { type: 'Connected', items: '23', levels: '1' },
    fields: [
      { label: 'List ID', value: 'lst-travel-agency' },
      { label: 'Connected to', value: 'Travel profile: Preferred Agency' },
      { label: 'Levels', value: '1 (flat)' },
      { label: 'Source', value: 'Maintained in Concur' },
    ],
  },
  {
    id: 'list-cost-type-legacy',
    name: 'Legacy Cost Types (2019)',
    summary: 'Standalone · 340 items · 2 levels',
    status: 'inactive',
    updatedAt: agoDays(400),
    row: { type: 'Standalone', items: '340', levels: '2' },
    fields: [
      { label: 'List ID', value: 'lst-cost-type-legacy' },
      { label: 'Connected to', value: '— (retired)' },
      { label: 'Levels', value: '2' },
      { label: 'Note', value: 'Superseded by Cost Centers · kept for audit' },
    ],
  },
];

/* ── Registered-but-scaffolded categories ────────────────────────────────
   Each has a planned column set so the descriptor is complete, but
   `implemented: false` routes them to the guided scaffold state.        */

export const SCAFFOLD_HINTS: Record<string, { apiHint: string; fieldsHint: string }> = {
  'expense-groups': {
    apiHint: 'GET /expense/v4/groups',
    fieldsHint: 'group name, assigned policies, ledger, country, employee count',
  },
  'expense-policies': {
    apiHint: 'GET /expense/v4/policies',
    fieldsHint: 'policy name, rules, limits, assigned groups, effective dates',
  },
  'expense-types': {
    apiHint: 'GET /expense/v4/expense-types',
    fieldsHint: 'type name, code, spend category, GL account, taxability',
  },
  'payment-types': {
    apiHint: 'GET /expense/v4/payment-types',
    fieldsHint: 'payment type, code, reimbursement method, company-paid flag',
  },
  'attendee-types': {
    apiHint: 'GET /attendee/v4/attendee-types',
    fieldsHint: 'attendee type, code, linked expense types, visibility',
  },
  'allocations': {
    apiHint: 'GET /expense/v4/allocations',
    fieldsHint: 'allocation scheme, target lists, split rules, default percentages',
  },
};
