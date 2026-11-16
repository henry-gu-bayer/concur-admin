import { CategoryDescriptor } from '../types';
import { ApiLogsView } from '../components/ApiLogsView';
import { ExpenseConfigView } from '../components/ExpenseConfigView';
import { FormsView } from '../components/FormsView';
import { ListsView } from '../components/ListsView';
import { LocalitiesView } from '../components/LocalitiesView';
import { LocationsView } from '../components/LocationsView';
import { ReportsView } from '../components/ReportsView';
import { SaeCheckView } from '../components/SaeCheckView';
import { UsersView } from '../components/UsersView';
import { icons } from './icons';

/**
 * Category registry — the framework's single extension point.
 *
 * Adding a Concur configuration feature = appending ONE descriptor here. The
 * Home, sidebar, and workspaces all consume this registry.
 */
export const categories: CategoryDescriptor[] = [
  {
    id: 'lists',
    label: 'Lists',
    group: 'Foundation data',
    summary: 'Browse and compare v3 and v4 lists and items.',
    description: 'Browse lists and items from both APIs. Select a list to compare its v4 and v3 configuration and items.',
    icon: icons.lists,
    render: () => <ListsView />,
  },

  {
    id: 'forms',
    label: 'Forms & Fields',
    group: 'Foundation data',
    summary: 'Inspect expense forms and their configured fields.',
    description: 'Expense form types, forms, and their configured fields (Expense Form v1.1), crawled on demand and stored locally for fast browsing.',
    icon: icons.forms,
    render: () => <FormsView />,
  },

  {
    id: 'expense-config',
    label: 'Expense Group Configuration',
    group: 'Foundation data',
    summary: 'Browse policies, expense types, and payment types.',
    description: 'Query user expense group configuration (policies, expense types, payment types, attendee types, groups) via Concur v4 API by login ID. Also browse all groups, policies, and expense types via v3 API.',
    icon: icons['expense-config'],
    render: () => <ExpenseConfigView />,
  },

  {
    id: 'locations',
    label: 'Locations',
    group: 'Foundation data',
    summary: 'Search company-valid locations and saved snapshots.',
    description: 'Query company-valid locations via Locations v3 with combinable filters. Country searches create an entity-scoped disk snapshot so later subdivision, city, and name searches run locally.',
    icon: icons.locations,
    render: ({ entityId }) => <LocationsView entityId={entityId} />,
  },

  {
    id: 'localities',
    label: 'Localities',
    group: 'Foundation data',
    summary: 'Browse countries, subdivisions, and locations.',
    description: 'Query Localities v5 countries, subdivisions, and locations. Countries can be cached locally per entity; location results link back to their country and subdivision records.',
    icon: icons.localities,
    render: () => <LocalitiesView />,
  },

  {
    id: 'reports',
    label: 'Expense Reports',
    group: 'Expense',
    summary: 'Search reports and inspect their expense entries.',
    description: 'Search expense report headers live via Reports v3 by login ID or exact report ID (Report ID alone resolves the owner via Report v2), with an advance search for approver login ID, approval/payment status, country, date ranges, has-images/has-attendees, and expense type code; drill into a report to retrieve its expense entries (Entries v3).',
    icon: icons.reports,
    render: () => <ReportsView />,
  },

  {
    id: 'users',
    label: 'Identity',
    group: 'Users',
    summary: 'Find users and browse User, Spend, and Travel Profiles.',
    description: 'Find users by Login ID, Employee ID, work email, or UUID, and browse locally saved User, Spend, and Travel Profiles.',
    icon: icons.users,
    render: () => <UsersView />,
  },

  {
    id: 'sae-check',
    label: 'SAE File Check',
    group: 'Integrations',
    summary: 'Validate local Standard Accounting Extract files.',
    description: 'Validate a Standard Accounting Extract file, or every .txt extract in a folder, against the SAE V3 specification: file structure, batch control totals, field formats and code values, journal/allocation integrity, and amount arithmetic. Files are read locally; card and bank values are masked in findings.',
    icon: icons['sae-check'],
    render: () => <SaeCheckView />,
  },

  {
    id: 'api-logs',
    label: 'API Logs',
    group: 'Operations',
    summary: 'Inspect local Concur API calls and responses.',
    description: 'Read-only local Concur API call logs. Select an entry to inspect its response payload.',
    icon: icons['api-logs'],
    sidebarFooter: true,
    render: () => <ApiLogsView />,
  },

  // Expense Policies / Expense Types / Payment Types / Attendee Types are NOT
  // standalone categories — they're children of an expense group, shown by
  // expanding a group in the Expense Groups view (Foundation data).
];

/** Convenience: nav grouped by `group`, preserving declaration order. */
export function groupedCategories(descriptors = categories): { group: string; items: CategoryDescriptor[] }[] {
  const order: string[] = [];
  const map = new Map<string, CategoryDescriptor[]>();
  for (const c of descriptors) {
    if (!map.has(c.group)) {
      map.set(c.group, []);
      order.push(c.group);
    }
    map.get(c.group)!.push(c);
  }
  return order.map((group) => ({ group, items: map.get(group)! }));
}
