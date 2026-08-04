import { LIST_ITEMS } from '../data/mock';
import { CategoryDescriptor } from '../types';
import { icons } from './icons';

const notYet = () => Promise.resolve([]);

/**
 * Category registry — the framework's single extension point.
 *
 * Adding a Concur configuration feature = appending ONE descriptor here.
 * The sidebar groups and renders it, the table/search/filter/detail panel
 * consume `columns` + `fetchItems`, and `implemented` controls whether the
 * main stage shows live data or a guided scaffold state. Nothing else to touch.
 */
export const categories: CategoryDescriptor[] = [
  {
    id: 'lists',
    label: 'Lists',
    group: 'Foundation data',
    description: 'All lists of values in the entity (cost centers, vendors, projects…) retrieved live from Concur LIST v4 and stored locally for fast browsing.',
    icon: icons.lists,
    implemented: true,
    columns: [
      { id: 'type', label: 'Type' },
      { id: 'items', label: 'Items', align: 'right' },
      { id: 'levels', label: 'Levels', align: 'right', hideBelow: 'lg' },
    ],
    fetchItems: async () => LIST_ITEMS,
  },

  {
    id: 'expense-groups',
    label: 'Expense Groups',
    group: 'Expense',
    description: 'Employee groupings that determine which policies and configurations apply.',
    icon: icons['expense-groups'],
    implemented: false,
    columns: [
      { id: 'policies', label: 'Policies' },
      { id: 'ledger', label: 'Ledger', hideBelow: 'lg' },
      { id: 'members', label: 'Members', align: 'right' },
    ],
    fetchItems: notYet,
  },
  {
    id: 'expense-policies',
    label: 'Expense Policies',
    group: 'Expense',
    description: 'Spend rules, limits, and audit requirements applied to expense groups.',
    icon: icons['expense-policies'],
    implemented: false,
    columns: [
      { id: 'rules', label: 'Rules', align: 'right' },
      { id: 'groups', label: 'Assigned groups', hideBelow: 'lg' },
      { id: 'effective', label: 'Effective' },
    ],
    fetchItems: notYet,
  },
  {
    id: 'expense-types',
    label: 'Expense Types',
    group: 'Expense',
    description: 'Categories of spend (airfare, lodging, meals…) and their GL mapping.',
    icon: icons['expense-types'],
    implemented: false,
    columns: [
      { id: 'code', label: 'Code' },
      { id: 'category', label: 'Spend category', hideBelow: 'lg' },
      { id: 'gl', label: 'GL account', hideBelow: 'xl' },
    ],
    fetchItems: notYet,
  },
  {
    id: 'payment-types',
    label: 'Payment Types',
    group: 'Expense',
    description: 'How expenses are paid and reimbursed (cash, card, company-paid…).',
    icon: icons['payment-types'],
    implemented: false,
    columns: [
      { id: 'code', label: 'Code' },
      { id: 'method', label: 'Reimbursement', hideBelow: 'lg' },
      { id: 'companyPaid', label: 'Company paid' },
    ],
    fetchItems: notYet,
  },
  {
    id: 'attendee-types',
    label: 'Attendee Types',
    group: 'Expense',
    description: 'Classifications of attendees for entertainment and business-meal expenses.',
    icon: icons['attendee-types'],
    implemented: false,
    columns: [
      { id: 'code', label: 'Code' },
      { id: 'expenseTypes', label: 'Linked expense types', hideBelow: 'lg' },
    ],
    fetchItems: notYet,
  },
  {
    id: 'allocations',
    label: 'Allocations',
    group: 'Expense',
    description: 'Rules that split expense amounts across cost objects.',
    icon: icons.allocations,
    implemented: false,
    columns: [
      { id: 'scheme', label: 'Scheme' },
      { id: 'targets', label: 'Targets', hideBelow: 'lg' },
    ],
    fetchItems: notYet,
  },
];

/** Convenience: nav grouped by `group`, preserving declaration order. */
export function groupedCategories(): { group: string; items: CategoryDescriptor[] }[] {
  const order: string[] = [];
  const map = new Map<string, CategoryDescriptor[]>();
  for (const c of categories) {
    if (!map.has(c.group)) {
      map.set(c.group, []);
      order.push(c.group);
    }
    map.get(c.group)!.push(c);
  }
  return order.map((group) => ({ group, items: map.get(group)! }));
}
