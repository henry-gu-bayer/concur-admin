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
    id: 'forms',
    label: 'Forms & Fields',
    group: 'Foundation data',
    description: 'Expense form types, forms, and their configured fields (Expense Form v1.1), crawled on demand and stored locally for fast browsing.',
    icon: icons.forms,
    implemented: true,
    columns: [
      { id: 'forms', label: 'Forms', align: 'right' },
      { id: 'fields', label: 'Fields', align: 'right' },
    ],
    fetchItems: notYet,
  },

  {
    id: 'expense-groups',
    label: 'Expense Groups',
    group: 'Foundation data',
    description: 'Expense group configurations retrieved live from Concur (v3). Expand a group to see its children: payment types, expense policies with their expense types, and attendee types.',
    icon: icons['expense-groups'],
    implemented: true,
    columns: [
      { id: 'policies', label: 'Policies' },
      { id: 'paymentTypes', label: 'Payment types' },
      { id: 'attendeeTypes', label: 'Attendee types' },
    ],
    fetchItems: notYet,
  },

  {
    id: 'locations',
    label: 'Locations',
    group: 'Foundation data',
    description: 'Query company-valid locations via Locations v3 with combinable filters. Country searches create an entity-scoped disk snapshot so later subdivision, city, and name searches run locally.',
    icon: icons.locations,
    implemented: true,
    columns: [
      { id: 'name', label: 'Name' },
      { id: 'subdivision', label: 'Subdivision' },
      { id: 'country', label: 'Country' },
    ],
    fetchItems: notYet,
  },

  {
    id: 'localities',
    label: 'Localities',
    group: 'Foundation data',
    description: 'Query Localities v5 countries, subdivisions, and locations. Countries can be cached locally per entity; location results link back to their country and subdivision records.',
    icon: icons.localities,
    implemented: true,
    columns: [
      { id: 'code', label: 'Code' },
      { id: 'name', label: 'Name' },
      { id: 'status', label: 'Status' },
    ],
    fetchItems: notYet,
  },

  {
    id: 'reports',
    label: 'Expense Reports',
    group: 'Expense',
    description: 'Search expense report headers live via Reports v3 by login ID or exact report ID, with an advanced search for approval/payment status, country, and date ranges; drill into a report to retrieve its expense entries (Entries v3).',
    icon: icons.reports,
    implemented: true,
    columns: [
      { id: 'name', label: 'Name' },
      { id: 'owner', label: 'Owner' },
      { id: 'approval', label: 'Approval' },
      { id: 'total', label: 'Total', align: 'right' },
    ],
    fetchItems: notYet,
  },

  {
    id: 'users',
    label: 'Users',
    group: 'Identity',
    description: 'Find Concur Identity users by Login ID, Employee ID, or Email, then inspect the full profile by user UUID.',
    icon: icons.users,
    implemented: true,
    columns: [
      { id: 'name', label: 'Name' },
      { id: 'loginId', label: 'Login ID' },
      { id: 'employeeId', label: 'Employee ID', hideBelow: 'md' },
      { id: 'email', label: 'Email', hideBelow: 'lg' },
      { id: 'status', label: 'Status' },
    ],
    fetchItems: notYet,
  },

  // Expense Policies / Expense Types / Payment Types / Attendee Types are NOT
  // standalone categories — they're children of an expense group, shown by
  // expanding a group in the Expense Groups view (Foundation data).
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
