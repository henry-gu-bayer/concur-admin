import { useState } from 'react';
import { getUserExpenseConfig } from '../api/expenseConfigApi';
import type { UserExpenseConfig, ExpenseGroupConfig } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { TabPanel, Tabs } from './ui/Tabs';
import { ErrorPanel, LoadingRows } from './ui/AsyncState';
import { ExpenseGroupsView } from './ExpenseGroupsView';

/**
 * Expense Configuration (v4) — user-scoped configuration lookup.
 *
 * Primary tab: Enter a login ID to retrieve the user's complete expense configuration
 * (policies, expense types, payment types, attendee types, groups) via v4 API.
 *
 * Secondary tabs: Reuse existing v3 browsing logic for all groups, policies, expense types.
 */

type ConfigSection = 'groups' | 'policies' | 'expenseTypes' | 'paymentTypes' | 'attendeeTypes';

export function ExpenseConfigView() {
  const [activeTab, setActiveTab] = useState<'user' | 'groups' | 'policies' | 'expense-types'>('user');

  return (
    <div>
      <Tabs
        active={activeTab}
        onChange={(tab) => setActiveTab(tab as typeof activeTab)}
        tabs={[
          { id: 'user', label: 'User Configuration' },
          { id: 'groups', label: 'All Groups' },
          { id: 'policies', label: 'Policies' },
          { id: 'expense-types', label: 'Expense Types' },
        ]}
      />
      {activeTab === 'user' && (
        <TabPanel>
          <UserConfigurationPanel />
        </TabPanel>
      )}
      {activeTab === 'groups' && (
        <TabPanel>
          <AllGroupsPanel />
        </TabPanel>
      )}
      {activeTab === 'policies' && (
        <TabPanel>
          <PoliciesPanel />
        </TabPanel>
      )}
      {activeTab === 'expense-types' && (
        <TabPanel>
          <ExpenseTypesPanel />
        </TabPanel>
      )}
    </div>
  );
}

function UserConfigurationPanel() {
  const [loginId, setLoginId] = useState('');
  const [config, setConfig] = useState<UserExpenseConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<ConfigSection>>(new Set(['groups']));

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const result = await getUserExpenseConfig(loginId.trim());
      setConfig(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!config) return;
    setRefreshing(true);
    setError(null);
    try {
      const result = await getUserExpenseConfig(config.loginId, true);
      setConfig(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSection = (section: ConfigSection) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="Enter user login ID (e.g., jsmith)"
          className="flex-1"
        />
        <Button type="submit" loading={loading} disabled={!loginId.trim()}>
          Look Up
        </Button>
        {config && (
          <Button type="button" onClick={handleRefresh} loading={refreshing}>
            Refresh
          </Button>
        )}
      </form>

      {error && <ErrorPanel title="Lookup failed" message={error} />}

      {loading && !config && <LoadingRows label="Loading user configuration" rows={5} />}

      {config && (
        <div className="space-y-4">
          {/* User info */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm text-gray-600">User Information</div>
            <div className="mt-2 space-y-1">
              <div className="flex gap-2">
                <span className="font-medium text-gray-900">Login ID:</span>
                <span className="text-gray-700">{config.loginId}</span>
              </div>
              {config.displayName && (
                <div className="flex gap-2">
                  <span className="font-medium text-gray-900">Name:</span>
                  <span className="text-gray-700">{config.displayName}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="font-medium text-gray-900">User UUID:</span>
                <span className="font-mono text-xs text-gray-700">{config.userId}</span>
              </div>
              <div className="flex gap-2">
                <span className="font-medium text-gray-900">Retrieved:</span>
                <span className="text-gray-700">{new Date(config.retrievedAt).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Groups section */}
          <CollapsibleSection
            title="Expense Groups"
            count={config.groups.length}
            expanded={expandedSections.has('groups')}
            onToggle={() => toggleSection('groups')}
            tone="blue"
          >
            {config.groups.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No groups found</div>
            ) : (
              <div className="space-y-3">
                {config.groups.map((group) => (
                  <GroupCard key={group.hierarchyNodeId} group={group} />
                ))}
              </div>
            )}
          </CollapsibleSection>

          {/* Policies section */}
          <CollapsibleSection
            title="Policies"
            count={config.policies.length}
            expanded={expandedSections.has('policies')}
            onToggle={() => toggleSection('policies')}
            tone="blue"
          >
            {config.policies.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No policies found</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Policy Name
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Policy ID
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Default
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {config.policies.map((policy) => (
                    <tr key={policy.policyId}>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{policy.policyName}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">{policy.policyId}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm">
                        {policy.isDefault && <Badge tone="success">Default</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CollapsibleSection>

          {/* Expense Types section */}
          <CollapsibleSection
            title="Expense Types"
            count={Object.values(config.expenseTypesByPolicy).flat().length}
            expanded={expandedSections.has('expenseTypes')}
            onToggle={() => toggleSection('expenseTypes')}
            tone="blue"
          >
            {Object.keys(config.expenseTypesByPolicy).length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No expense types found</div>
            ) : (
              <div className="space-y-4">
                {Object.entries(config.expenseTypesByPolicy).map(([policyId, types]) => {
                  const policy = config.policies.find((p) => p.policyId === policyId);
                  return (
                    <div key={policyId}>
                      <div className="mb-2 text-sm font-medium text-gray-700">
                        {policy?.policyName ?? policyId}
                      </div>
                      {types.length === 0 ? (
                        <div className="py-2 text-center text-sm text-gray-500">No expense types</div>
                      ) : (
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                Type Name
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                Type ID
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                Category Code
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                Category Name
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 bg-white">
                            {types.map((type) => (
                              <tr key={type.expenseTypeId}>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">
                                  {type.expenseTypeName}
                                  {type.isCategory && (
                                    <span className="ml-2">
                                      <Badge tone="muted">Category</Badge>
                                    </span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
                                  {type.expenseTypeId}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                                  {type.spendCategoryCode}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                                  {type.spendCategoryName}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CollapsibleSection>

          {/* Payment Types section */}
          <CollapsibleSection
            title="Payment Types"
            count={config.paymentTypes.length}
            expanded={expandedSections.has('paymentTypes')}
            onToggle={() => toggleSection('paymentTypes')}
            tone="emerald"
          >
            {config.paymentTypes.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No payment types found</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Payment Type Name
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Payment Type ID
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Default
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {config.paymentTypes.map((type) => (
                    <tr key={type.paymentTypeId}>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{type.paymentTypeName}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
                        {type.paymentTypeId}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm">
                        {type.isDefault && <Badge tone="success">Default</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CollapsibleSection>

          {/* Attendee Types section */}
          <CollapsibleSection
            title="Attendee Types"
            count={config.attendeeTypes.length}
            expanded={expandedSections.has('attendeeTypes')}
            onToggle={() => toggleSection('attendeeTypes')}
            tone="violet"
          >
            {config.attendeeTypes.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No attendee types found</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Attendee Type Code
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Attendee Type Name
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {config.attendeeTypes.map((type) => (
                    <tr key={type.attendeeTypeCode}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-sm text-gray-900">
                        {type.attendeeTypeCode}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{type.attendeeTypeName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  expanded,
  onToggle,
  tone,
  children,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  tone: 'blue' | 'emerald' | 'violet';
  children: React.ReactNode;
}) {
  const toneClasses = {
    blue: 'border-blue-200 bg-blue-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    violet: 'border-violet-200 bg-violet-50',
  };

  const badgeToneMap = {
    blue: 'primary',
    emerald: 'success',
    violet: 'warning',
  } as const;

  return (
    <div className={`rounded-lg border ${toneClasses[tone]}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-gray-900">{title}</span>
          <Badge tone={badgeToneMap[tone]}>{count}</Badge>
        </div>
        <span className="text-gray-500">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && <div className="border-t border-gray-200 bg-white p-4">{children}</div>}
    </div>
  );
}

function GroupCard({ group }: { group: ExpenseGroupConfig }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-base font-semibold text-gray-900">{group.groupName}</div>
          <div className="mt-1 font-mono text-xs text-gray-500">{group.hierarchyNodeId}</div>
        </div>
      </div>

      <div className="space-y-3 text-sm">
        {/* Group parameters */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-600">Attendee Form:</span>{' '}
            <span className="text-gray-900">{group.attendeeListFormName}</span>
          </div>
          <div>
            <span className="text-gray-600">Yodlee:</span>{' '}
            <Badge tone={group.allowUserRegisterYodlee ? 'success' : 'muted'}>
              {group.allowUserRegisterYodlee ? 'Allowed' : 'Not Allowed'}
            </Badge>
          </div>
          <div>
            <span className="text-gray-600">Digital Tax Invoice:</span>{' '}
            <Badge tone={group.allowUserDigitalTaxInvoice ? 'success' : 'muted'}>
              {group.allowUserDigitalTaxInvoice ? 'Allowed' : 'Not Allowed'}
            </Badge>
          </div>
        </div>

        {/* Cash advance */}
        {group.cashAdvance && (
          <div>
            <div className="mb-1 text-gray-600">Cash Advance Workflow:</div>
            <div className="ml-4 text-gray-900">{group.cashAdvance.name}</div>
          </div>
        )}

        {/* Embedded collections */}
        <div className="grid grid-cols-3 gap-4 border-t border-gray-200 pt-3">
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-gray-500">Policies</div>
            <div className="text-sm text-gray-900">{group.policies.length}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-gray-500">Payment Types</div>
            <div className="text-sm text-gray-900">{group.paymentTypes.length}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-gray-500">Attendee Types</div>
            <div className="text-sm text-gray-900">{group.attendeeTypes.length}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Secondary tabs - reuse existing v3 logic
function AllGroupsPanel() {
  return <ExpenseGroupsView initialScope="groups" />;
}

function PoliciesPanel() {
  return <ExpenseGroupsView initialScope="policies" />;
}

function ExpenseTypesPanel() {
  return <ExpenseGroupsView initialScope="expenseTypes" />;
}
