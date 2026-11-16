import { useState } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
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
      <div className="overflow-x-auto whitespace-nowrap">
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
      </div>
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
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex flex-wrap gap-2">
        <Input
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="Enter user login ID (e.g., jsmith)"
          aria-label="User login ID"
          className="!h-9 min-w-0 sm:flex-1"
        />
        <Button type="submit" className="!h-9 shrink-0" loading={loading} disabled={!loginId.trim()}>
          Look Up
        </Button>
        {config && (
          <Button type="button" variant="outline" className="!h-9 shrink-0" onClick={handleRefresh} loading={refreshing}>
            Refresh
          </Button>
        )}
      </form>

      {error && <ErrorPanel title="Lookup failed" message={error} />}

      {loading && !config && <LoadingRows label="Loading user configuration" rows={5} />}

      {config && (
        <div className="space-y-3">
          {/* User info */}
          <div className="rounded-lg border bg-card px-4 py-3">
            <h2 className="text-sm font-semibold">User Information</h2>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Login ID:</dt>
              <dd className="break-words">{config.loginId}</dd>
              {config.displayName && (
                <>
                  <dt className="text-muted-foreground">Name:</dt>
                  <dd className="break-words">{config.displayName}</dd>
                </>
              )}
              <dt className="text-muted-foreground">User UUID:</dt>
              <dd className="break-words font-mono text-xs leading-5">{config.userId}</dd>
              <dt className="text-muted-foreground">Retrieved:</dt>
              <dd className="tabular-nums">{new Date(config.retrievedAt).toLocaleString()}</dd>
            </dl>
          </div>

          {/* Groups section */}
          <CollapsibleSection
            title="Expense Groups"
            count={config.groups.length}
            expanded={expandedSections.has('groups')}
            onToggle={() => toggleSection('groups')}
          >
            {config.groups.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">No groups found</div>
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
          >
            {config.policies.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">No policies found</div>
            ) : (
              <table className="w-full min-w-[28rem] divide-y">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Policy name
                    </th>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Policy ID
                    </th>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Default
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {config.policies.map((policy) => (
                    <tr key={policy.policyId}>
                      <td className="px-3 py-1.5 text-sm">{policy.policyName}</td>
                      <td className="break-words px-3 py-1.5 font-mono text-xs text-muted-foreground">{policy.policyId}</td>
                      <td className="px-3 py-1.5 text-sm">
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
          >
            {Object.keys(config.expenseTypesByPolicy).length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">No expense types found</div>
            ) : (
              <div className="space-y-4">
                {Object.entries(config.expenseTypesByPolicy).map(([policyId, types]) => {
                  const policy = config.policies.find((p) => p.policyId === policyId);
                  return (
                    <div key={policyId}>
                      <div className="mb-2 text-sm font-medium text-foreground">
                        {policy?.policyName ?? policyId}
                      </div>
                      {types.length === 0 ? (
                        <div className="py-2 text-center text-sm text-muted-foreground">No expense types</div>
                      ) : (
                        <table className="w-full min-w-[28rem] divide-y">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                                Type name
                              </th>
                              <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                                Type ID
                              </th>
                              <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                                Category code
                              </th>
                              <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                                Category name
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {types.map((type) => (
                              <tr key={type.expenseTypeId}>
                                <td className="px-3 py-1.5 text-sm">
                                  {type.expenseTypeName}
                                  {type.isCategory && (
                                    <span className="ml-2">
                                      <Badge tone="muted">Category</Badge>
                                    </span>
                                  )}
                                </td>
                                <td className="break-words px-3 py-1.5 font-mono text-xs text-muted-foreground">
                                  {type.expenseTypeId}
                                </td>
                                <td className="px-3 py-1.5 text-sm text-muted-foreground">
                                  {type.spendCategoryCode}
                                </td>
                                <td className="px-3 py-1.5 text-sm text-muted-foreground">
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
          >
            {config.paymentTypes.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">No payment types found</div>
            ) : (
              <table className="w-full min-w-[28rem] divide-y">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Payment type name
                    </th>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Payment type ID
                    </th>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Default
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {config.paymentTypes.map((type) => (
                    <tr key={type.paymentTypeId}>
                      <td className="px-3 py-1.5 text-sm">{type.paymentTypeName}</td>
                      <td className="break-words px-3 py-1.5 font-mono text-xs text-muted-foreground">
                        {type.paymentTypeId}
                      </td>
                      <td className="px-3 py-1.5 text-sm">
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
          >
            {config.attendeeTypes.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">No attendee types found</div>
            ) : (
              <table className="w-full min-w-[28rem] divide-y">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Attendee type code
                    </th>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Attendee type name
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {config.attendeeTypes.map((type) => (
                    <tr key={type.attendeeTypeCode}>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {type.attendeeTypeCode}
                      </td>
                      <td className="px-3 py-1.5 text-sm text-muted-foreground">{type.attendeeTypeName}</td>
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
  children,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 bg-muted/40 px-4 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:ring-inset motion-reduce:transition-none"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
        </div>
        <CaretRightIcon aria-hidden="true" size={16} className={`shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && <div className="overflow-x-auto border-t p-3">{children}</div>}
    </div>
  );
}

function GroupCard({ group }: { group: ExpenseGroupConfig }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="mb-2">
        <div>
          <div className="break-words text-sm font-semibold">{group.groupName}</div>
          <div className="break-words font-mono text-xs text-muted-foreground">{group.hierarchyNodeId}</div>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        {/* Group parameters */}
        <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Attendee Form:</span>{' '}
            <span className="text-foreground">{group.attendeeListFormName}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Yodlee:</span>{' '}
            <Badge tone={group.allowUserRegisterYodlee ? 'success' : 'muted'}>
              {group.allowUserRegisterYodlee ? 'Allowed' : 'Not Allowed'}
            </Badge>
          </div>
          <div>
            <span className="text-muted-foreground">Digital Tax Invoice:</span>{' '}
            <Badge tone={group.allowUserDigitalTaxInvoice ? 'success' : 'muted'}>
              {group.allowUserDigitalTaxInvoice ? 'Allowed' : 'Not Allowed'}
            </Badge>
          </div>
        </div>

        {/* Cash advance */}
        {group.cashAdvance && (
          <div>
            <div className="mb-1 text-muted-foreground">Cash Advance Workflow:</div>
            <div className="ml-4 text-foreground">{group.cashAdvance.name}</div>
          </div>
        )}

        {/* Embedded collections */}
        <div className="grid grid-cols-3 gap-2 border-t pt-2">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Policies</div>
            <div className="text-sm text-foreground">{group.policies.length}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Payment Types</div>
            <div className="text-sm text-foreground">{group.paymentTypes.length}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Attendee Types</div>
            <div className="text-sm text-foreground">{group.attendeeTypes.length}</div>
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
