import { CategoryDescriptor } from '../types';
import { ExpenseGroupsView } from '../components/ExpenseGroupsView';
import { FormsView } from '../components/FormsView';
import { ListsView } from '../components/ListsView';
import { LocalitiesView } from '../components/LocalitiesView';
import { LocationsView } from '../components/LocationsView';
import { ReportsView } from '../components/ReportsView';
import { UsersView } from '../components/UsersView';
import { icons } from './icons';

/**
 * Category registry — the framework's single extension point.
 *
 * Adding a Concur configuration feature = appending ONE descriptor here. The
 * sidebar and main stage both consume this registry; App has no category router.
 */
export const categories: CategoryDescriptor[] = [
  {
    id: 'lists',
    label: 'Lists',
    group: 'Foundation data',
    description: 'All lists of values in the entity (cost centers, vendors, projects…) retrieved live from Concur LIST v4 and stored locally for fast browsing.',
    icon: icons.lists,
    render: () => <ListsView />,
  },

  {
    id: 'forms',
    label: 'Forms & Fields',
    group: 'Foundation data',
    description: 'Expense form types, forms, and their configured fields (Expense Form v1.1), crawled on demand and stored locally for fast browsing.',
    icon: icons.forms,
    render: () => <FormsView />,
  },

  {
    id: 'expense-groups',
    label: 'Expense Groups',
    group: 'Foundation data',
    description: 'Search expense group configuration from Concur (v3) in separate Group, Policy, and Expense Type scopes. Results keep their parent context, and groups can still be expanded to inspect payment and attendee types.',
    icon: icons['expense-groups'],
    render: () => <ExpenseGroupsView />,
  },

  {
    id: 'locations',
    label: 'Locations',
    group: 'Foundation data',
    description: 'Query company-valid locations via Locations v3 with combinable filters. Country searches create an entity-scoped disk snapshot so later subdivision, city, and name searches run locally.',
    icon: icons.locations,
    render: ({ entityId }) => <LocationsView entityId={entityId} />,
  },

  {
    id: 'localities',
    label: 'Localities',
    group: 'Foundation data',
    description: 'Query Localities v5 countries, subdivisions, and locations. Countries can be cached locally per entity; location results link back to their country and subdivision records.',
    icon: icons.localities,
    render: () => <LocalitiesView />,
  },

  {
    id: 'reports',
    label: 'Expense Reports',
    group: 'Expense',
    description: 'Search expense report headers live via Reports v3 by login ID or exact report ID (Report ID alone resolves the owner via Report v2), with an advanced search for approval/payment status, country, date ranges, has-images/has-attendees, and expense type code; drill into a report to retrieve its expense entries (Entries v3).',
    icon: icons.reports,
    render: () => <ReportsView />,
  },

  {
    id: 'users',
    label: 'Identity',
    group: 'Users',
    description: 'Find users by Login ID, Employee ID, work email, or UUID, and browse locally saved User and Spend Profiles.',
    icon: icons.users,
    render: () => <UsersView />,
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
