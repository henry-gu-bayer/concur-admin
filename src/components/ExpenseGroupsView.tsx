import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { UserIcon } from '@phosphor-icons/react/dist/csr/User';
import { getExpenseGroups, getUserExpenseGroups, refreshExpenseGroups } from '../api/expenseGroupsApi';
import { timeAgo } from '../api/listsApi';
import { ExpenseGroupConfiguration, ExpenseGroupsSnapshot, Policy, UserExpenseGroupsData } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { TabPanel, Tabs } from './ui/Tabs';
import { ErrorPanel, LoadingRows } from './ui/AsyncState';

/**
 * Expense Group Configurations (v3) — presented like Lists / list items.
 *
 * Each expense GROUP is a row (a "foundation data" parent). Expanding a row
 * reveals its CHILDREN: the four collections it owns — payment types, expense
 * policies (each expandable to its expense types), and attendee types. The
 * whole snapshot arrives in one fetch (no lazy loading needed — it's a single
 * small document), and a Refresh re-retrieves all pages from Concur.
 */

export function ExpenseGroupsView({ initialScope = 'groups' }: { initialScope?: SearchScope } = {}) {
  const [snapshot, setSnapshot] = useState<ExpenseGroupsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeScope, setActiveScope] = useState<SearchScope>(initialScope);
  const [queries, setQueries] = useState<Record<SearchScope, string>>({ groups: '', policies: '', expenseTypes: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);

  const loadSnapshot = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getExpenseGroups()
      .then((d) => !cancelled && setSnapshot(d))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadSnapshot(), [loadSnapshot]);

  const doRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      setSnapshot(await refreshExpenseGroups());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const groups = useMemo(() => snapshot?.groups ?? [], [snapshot]);
  const policies = useMemo(
    () => groups.flatMap((group) => (group.Policies ?? []).map((policy) => ({ group, policy }))),
    [groups],
  );
  const expenseTypes = useMemo(
    () => policies.flatMap(({ group, policy }) =>
      (policy.ExpenseTypes ?? []).map((expenseType) => ({ group, policy, expenseType }))),
    [policies],
  );
  const normalizedQueries = useMemo(() => ({
    groups: queries.groups.trim().toLowerCase(),
    policies: queries.policies.trim().toLowerCase(),
    expenseTypes: queries.expenseTypes.trim().toLowerCase(),
  }), [queries]);
  const hasPolicyCondition = Boolean(normalizedQueries.policies);
  const hasExpenseTypeCondition = Boolean(normalizedQueries.expenseTypes);
  const activeConditions = SEARCH_SCOPES.flatMap((scope) => {
    const value = queries[scope.id].trim();
    return value ? [{ ...scope, value }] : [];
  });
  const relationshipMatches = (group: ExpenseGroupConfiguration, policy?: Policy, expenseType?: NonNullable<Policy['ExpenseTypes']>[number]) => (
    matchesSearch(normalizedQueries.groups, group.Name, group.ID)
    && (!policy || matchesSearch(normalizedQueries.policies, policy.Name, policy.ID))
    && (!expenseType || matchesSearch(normalizedQueries.expenseTypes, expenseType.Name, expenseType.Code, expenseType.ExpenseCode))
  );
  const filteredGroups = useMemo(
    () => groups
      .filter((group) => {
        if (!matchesSearch(normalizedQueries.groups, group.Name, group.ID)) return false;
        if (!hasPolicyCondition && !hasExpenseTypeCondition) return true;
        return (group.Policies ?? []).some((policy) => {
          if (!matchesSearch(normalizedQueries.policies, policy.Name, policy.ID)) return false;
          return !hasExpenseTypeCondition || (policy.ExpenseTypes ?? []).some((expenseType) =>
            matchesSearch(normalizedQueries.expenseTypes, expenseType.Name, expenseType.Code, expenseType.ExpenseCode));
        });
      })
      .sort((a, b) => groupName(a).localeCompare(groupName(b), undefined, { sensitivity: 'base' })),
    [groups, hasExpenseTypeCondition, hasPolicyCondition, normalizedQueries],
  );
  const filteredPolicies = useMemo(
    () => policies
      .filter(({ group, policy }) => relationshipMatches(group, policy)
        && (!hasExpenseTypeCondition || (policy.ExpenseTypes ?? []).some((expenseType) => relationshipMatches(group, policy, expenseType))))
      .sort((a, b) => policyName(a.policy).localeCompare(policyName(b.policy), undefined, { sensitivity: 'base' })),
    [hasExpenseTypeCondition, normalizedQueries, policies],
  );
  const filteredExpenseTypes = useMemo(
    () => expenseTypes
      .filter(({ group, policy, expenseType }) => relationshipMatches(group, policy, expenseType))
      .sort((a, b) => expenseTypeName(a.expenseType).localeCompare(expenseTypeName(b.expenseType), undefined, { sensitivity: 'base' })),
    [expenseTypes, normalizedQueries],
  );
  const resultCount = activeScope === 'groups'
    ? filteredGroups.length
    : activeScope === 'policies'
      ? filteredPolicies.length
      : filteredExpenseTypes.length;
  const resultCounts: Record<SearchScope, number> = {
    groups: filteredGroups.length,
    policies: filteredPolicies.length,
    expenseTypes: filteredExpenseTypes.length,
  };
  const activeScopeLabel = SEARCH_SCOPES.find((scope) => scope.id === activeScope)?.label ?? 'Groups';
  const activeQuery = queries[activeScope];
  const setActiveQuery = (value: string) => setQueries((current) => ({ ...current, [activeScope]: value }));
  const removeCondition = (scope: SearchScope) => setQueries((current) => ({ ...current, [scope]: '' }));
  const clearAllConditions = () => setQueries({ groups: '', policies: '', expenseTypes: '' });

  if (loading) {
    return <LoadingRows label="Loading expense groups" />;
  }

  if (error && !snapshot) {
    return <ErrorPanel title="Couldn't load expense groups" message={error} onRetry={() => { loadSnapshot(); }} />;
  }

  return (
    <div className="space-y-3">
      <section aria-label="Expense group configuration search" className="space-y-2">
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="grid grid-cols-3" role="tablist" aria-label="Search configuration type">
            {SEARCH_SCOPES.map((scope) => {
              const selected = activeScope === scope.id;
              const count = resultCounts[scope.id];
              return (
                <button
                  key={scope.id}
                  type="button"
                  role="tab"
                  aria-label={`${scope.label} ${count.toLocaleString()}`}
                  aria-selected={selected}
                  aria-controls="expense-groups-search-results"
                  onClick={() => setActiveScope(scope.id)}
                  className={`min-w-0 border-r px-2 py-2 text-center text-xs font-medium transition-colors last:border-r-0 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none sm:px-4 sm:text-sm ${selected ? 'bg-primary/5 text-primary shadow-[inset_0_-2px_0_hsl(var(--primary))]' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
                >
                  <span className="block break-words">{scope.label}</span>
                  <span className={`block text-xs tabular-nums ${selected ? 'text-primary/80' : 'text-muted-foreground'}`}>{count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative">
          <MagnifyingGlassIcon size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={activeQuery}
            onChange={(event) => setActiveQuery(event.target.value)}
            placeholder={SEARCH_SCOPES.find((scope) => scope.id === activeScope)?.placeholder}
            aria-label={`Search ${activeScopeLabel.toLowerCase()}`}
            className={`!h-9 pl-9 text-sm ${activeQuery ? 'pr-16' : 'pr-3'}`}
          />
          {activeQuery && (
            <button
              type="button"
              onClick={() => setActiveQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear
            </button>
          )}
        </div>

        {activeConditions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2" aria-label="Active search conditions">
            <span className="mr-1 text-xs font-medium text-foreground">All conditions (AND)</span>
            {activeConditions.map((condition, index) => (
              <Fragment key={condition.id}>
                {index > 0 && <span className="text-xs font-semibold text-muted-foreground" aria-hidden="true">AND</span>}
                <button
                  type="button"
                  onClick={() => removeCondition(condition.id)}
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                  aria-label={`Remove ${condition.label} condition: ${condition.value}`}
                >
                  <span className="shrink-0 text-muted-foreground">{condition.label}:</span>
                  <span className="min-w-0 break-words font-medium">{condition.value}</span>
                  <span className="text-sm leading-none text-muted-foreground" aria-hidden="true">×</span>
                </button>
              </Fragment>
            ))}
            <button
              type="button"
              onClick={clearAllConditions}
              className="ml-auto rounded-sm px-1 py-1 text-xs font-medium text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear all
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-xs text-muted-foreground" role="status">
            {activeConditions.length > 0
              ? `${resultCount.toLocaleString()} ${activeScopeLabel.toLowerCase()} match all ${activeConditions.length} condition${activeConditions.length === 1 ? '' : 's'}`
              : `${resultCount.toLocaleString()} ${activeScopeLabel.toLowerCase()}`}
            {snapshot ? ` · retrieved ${timeAgo(snapshot.retrievedAt)}` : ''}
          </p>
          <Button variant="outline" size="sm" className="!h-9" loading={refreshing} onClick={doRefresh}>
            {refreshing ? 'Retrieving…' : 'Retrieve again'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="!h-9"
            onClick={() => setLookupOpen((open) => !open)}
            aria-expanded={lookupOpen}
            aria-controls="user-lookup-panel"
          >
            Find by user
          </Button>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          Refresh failed: {error}
        </div>
      )}

      {lookupOpen && <UserLookupPanel />}

      <div id="expense-groups-search-results" role="tabpanel">
        {activeScope === 'groups' && (filteredGroups.length === 0 ? (
          <SearchEmpty title={groups.length === 0 ? 'No expense group configurations' : 'No groups match'} emptySnapshot={groups.length === 0} />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[36rem] text-sm" aria-label="Expense groups">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <th scope="col" className="w-11 px-2 py-2"><span className="sr-only">Inspect</span></th>
                <th scope="col" className="px-4 py-2 sm:px-6">Group</th>
                <th scope="col" className="px-4 py-2 text-right">Policies</th>
                <th scope="col" className="px-4 py-2 text-right">Payment types</th>
                <th scope="col" className="px-4 py-2 text-right">Attendee types</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((g, i) => (
                <GroupRow
                  key={g.ID ?? i}
                  group={g}
                  query=""
                  expanded={expandedId === (g.ID ?? String(i))}
                  onToggle={() => setExpandedId((c) => (c === (g.ID ?? String(i)) ? null : g.ID ?? String(i)))}
                />
              ))}
            </tbody>
          </table>
          </div>
        ))}
        {activeScope === 'policies' && (filteredPolicies.length === 0
          ? <SearchEmpty title="No policies match" />
          : <PolicySearchResults items={filteredPolicies} />)}
        {activeScope === 'expenseTypes' && (filteredExpenseTypes.length === 0
          ? <SearchEmpty title="No expense types match" />
          : <ExpenseTypeSearchResults items={filteredExpenseTypes} />)}
      </div>
    </div>
  );
}

export type SearchScope = 'groups' | 'policies' | 'expenseTypes';

const SEARCH_SCOPES: { id: SearchScope; label: string; placeholder: string }[] = [
  { id: 'groups', label: 'Groups', placeholder: 'Search groups by name or ID…' },
  { id: 'policies', label: 'Policies', placeholder: 'Search policies by name or ID…' },
  { id: 'expenseTypes', label: 'Expense types', placeholder: 'Search expense types by name or code…' },
];

function matchesSearch(query: string, ...fields: (string | undefined)[]): boolean {
  return !query || fields.some((field) => (field ?? '').toLowerCase().includes(query));
}

function SearchEmpty({ title, emptySnapshot = false }: { title: string; emptySnapshot?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{emptySnapshot ? 'Retrieve to pull the configuration from Concur.' : 'Try a different search in this section.'}</p>
    </div>
  );
}

type PolicySearchItem = { group: ExpenseGroupConfiguration; policy: Policy };

function PolicySearchResults({ items }: { items: PolicySearchItem[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[32rem] text-sm" aria-label="Expense policies search results">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <th scope="col" className="w-11 px-2 py-2"><span className="sr-only">Inspect</span></th>
            <th scope="col" className="px-3 py-2 sm:px-5">Policy</th>
            <th scope="col" className="px-3 py-2 sm:px-5">Group</th>
            <th scope="col" className="px-3 py-2 text-right">Expense types</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ group, policy }, index) => {
            const key = `${group.ID ?? groupName(group)}-${policy.ID ?? policyName(policy)}-${index}`;
            const open = openKey === key;
            return (
              <Fragment key={key}>
                <tr className={`border-b hover:bg-accent/50 ${open ? 'bg-primary/5' : ''}`}>
                  <td className="w-11 px-2 py-2 text-center">
                    <Button type="button" variant="outline" size="icon" onClick={() => setOpenKey(open ? null : key)} aria-label={open ? 'Collapse policy details' : 'Inspect policy details'} aria-expanded={open}>
                      <CaretRightIcon size={16} aria-hidden="true" className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
                    </Button>
                  </td>
                  <td className="px-3 py-2 text-xs font-medium text-foreground sm:px-5">{policyName(policy)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground sm:px-5">{groupName(group)}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">{(policy.ExpenseTypes ?? []).length}</td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={4} className="border-b bg-muted/30 px-4 py-2 sm:px-6">
                      <div className="mb-3 flex flex-wrap gap-2">
                        {policy.IsDefault && <Badge>Default</Badge>}
                        {policy.IsInheritable && <Badge>Inheritable</Badge>}
                        {policy.ID && <span className="break-words text-xs text-muted-foreground">ID: <span className="font-mono">{policy.ID}</span></span>}
                      </div>
                      <ExpenseTypesTable items={policy.ExpenseTypes ?? []} label={`Expense types for ${policyName(policy)}`} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type ExpenseTypeSearchItem = PolicySearchItem & { expenseType: NonNullable<Policy['ExpenseTypes']>[number] };

function ExpenseTypeSearchResults({ items }: { items: ExpenseTypeSearchItem[] }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = items.find(({ group, policy, expenseType }, index) =>
    selectedKey === expenseTypeResultKey(group, policy, expenseType, index));
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="max-h-[50vh] overflow-auto">
        <table className="w-full min-w-[680px] text-sm" aria-label="Expense types search results">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
              <th scope="col" className="px-4 py-2 sm:px-6">Expense type</th>
              <th scope="col" className="px-4 py-2">Code</th>
              <th scope="col" className="px-4 py-2">Policy</th>
              <th scope="col" className="px-4 py-2">Group</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ group, policy, expenseType }, index) => {
              const key = expenseTypeResultKey(group, policy, expenseType, index);
              const active = selectedKey === key;
              return (
                <tr key={key} className={`border-b last:border-0 hover:bg-accent/50 ${active ? 'bg-primary/5 shadow-[inset_2px_0_0_hsl(var(--primary))]' : ''}`}>
                  <td className="px-4 py-2.5 text-xs font-medium text-foreground sm:px-6">
                    <button
                      type="button"
                      onClick={() => setSelectedKey(active ? null : key)}
                      aria-expanded={active}
                      className="rounded-sm text-left font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {expenseTypeName(expenseType)}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{expenseType.Code ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{policyName(policy)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{groupName(group)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="border-t bg-muted/30 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{expenseTypeName(selected.expenseType)}</h3>
            {selected.expenseType.Code && <code className="font-mono text-xs text-muted-foreground">{selected.expenseType.Code}</code>}
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Expense code</dt><dd className="mt-0.5 break-words font-mono">{selected.expenseType.ExpenseCode ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Policy</dt><dd className="mt-0.5 font-medium text-foreground">{policyName(selected.policy)}</dd></div>
            <div><dt className="text-muted-foreground">Group</dt><dd className="mt-0.5 font-medium text-foreground">{groupName(selected.group)}</dd></div>
          </dl>
        </div>
      )}
    </div>
  );
}

function ExpenseTypesTable({ items, label }: { items: NonNullable<Policy['ExpenseTypes']>; label: string }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">No expense types are configured.</p>;
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full min-w-[480px] text-sm" aria-label={label}>
        <thead><tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground"><th className="px-3 py-2">Expense type</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Expense code</th></tr></thead>
        <tbody>{items.map((item, index) => <tr key={`${item.Code ?? item.Name ?? index}-${index}`} className="border-b last:border-0"><td className="px-3 py-2 text-xs font-medium">{expenseTypeName(item)}</td><td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.Code ?? '—'}</td><td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.ExpenseCode ?? '—'}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function policyName(policy: Policy): string {
  return (policy.Name ?? policy.ID ?? 'Expense policy').trim();
}

function expenseTypeName(expenseType: NonNullable<Policy['ExpenseTypes']>[number]): string {
  return (expenseType.Name ?? expenseType.Code ?? expenseType.ExpenseCode ?? 'Expense type').trim();
}

function expenseTypeResultKey(group: ExpenseGroupConfiguration, policy: Policy, expenseType: NonNullable<Policy['ExpenseTypes']>[number], index: number): string {
  return `${group.ID ?? groupName(group)}-${policy.ID ?? policyName(policy)}-${expenseType.Code ?? expenseTypeName(expenseType)}-${index}`;
}

/**
 * Look up the expense group configuration for one user login ID. The result
 * comes from the per-user cache when available, else fetched from Concur and
 * cached locally; the matching group(s) render with the same GroupRow used by
 * the main table.
 */
function UserLookupPanel() {
  const [loginId, setLoginId] = useState('');
  const [result, setResult] = useState<UserExpenseGroupsData | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const search = async (refresh = false) => {
    const id = loginId.trim();
    if (!id) return;
    setSearching(true);
    setError(null);
    try {
      const data = await getUserExpenseGroups(id, refresh);
      setResult(data);
      setExpandedId(data.groups[0]?.ID ?? null); // auto-expand the first group
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div id="user-lookup-panel" className="mb-3 rounded-lg border bg-card">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(false);
        }}
        className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6"
      >
        <UserIcon size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <label htmlFor="user-lookup" className="text-sm font-medium">
          Find by user
        </label>
        <Input
          id="user-lookup"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="User login ID (e.g. jsmith)…"
          className="!h-9 min-w-0 sm:w-auto sm:max-w-sm sm:flex-1"
        />
        <Button type="submit" size="sm" className="!h-9" loading={searching} disabled={!loginId.trim()}>
          {searching ? 'Searching…' : 'Look up'}
        </Button>
        {result && (
          <Button type="button" variant="outline" size="sm" className="!h-9" onClick={() => void search(true)} disabled={searching} title="Re-fetch from Concur and update the cache">
            Refresh
          </Button>
        )}
      </form>

      {error && (
        <div className="mx-4 mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:mx-6" role="alert">
          {error}
        </div>
      )}

      {result && (
        <div className="border-t px-4 py-3 sm:px-6">
          <p className="mb-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{result.loginId}</span> belongs to {result.count} group{result.count === 1 ? '' : 's'} · retrieved {timeAgo(result.retrievedAt)}
          </p>
          {result.groups.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No expense group configuration for this user.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[36rem] text-sm" aria-label={`Expense groups for ${result.loginId}`}>
                <tbody>
                  {result.groups.map((g, i) => (
                    <GroupRow
                      key={g.ID ?? i}
                      group={g}
                      query=""
                      expanded={expandedId === (g.ID ?? String(i))}
                      onToggle={() => setExpandedId((c) => (c === (g.ID ?? String(i)) ? null : g.ID ?? String(i)))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Display/sort name for a group — trimmed so leading spaces/symbols don't skew ordering. */
function groupName(g: ExpenseGroupConfiguration): string {
  return (g.Name ?? g.ID ?? '').trim();
}

type MatchCollection = 'policies' | 'paymentTypes' | 'attendeeTypes';

function matchingCollection(group: ExpenseGroupConfiguration, query: string): MatchCollection {
  const q = query.trim().toLowerCase();
  if (!q || [group.Name, group.ID].some((field) => (field ?? '').toLowerCase().includes(q))) return 'policies';
  if ((group.Policies ?? []).some((policy) =>
    [policy.Name, policy.ID, ...(policy.ExpenseTypes ?? []).flatMap((expenseType) => [expenseType.Name, expenseType.Code, expenseType.ExpenseCode])]
      .some((field) => (field ?? '').toLowerCase().includes(q))
  )) return 'policies';
  if ((group.PaymentTypes ?? []).some((paymentType) => (paymentType.Name ?? '').toLowerCase().includes(q))) return 'paymentTypes';
  return 'attendeeTypes';
}

function descendantMatchSummary(group: ExpenseGroupConfiguration, query: string): string | null {
  const q = query.trim().toLowerCase();
  if (!q || [group.Name, group.ID].some((field) => (field ?? '').toLowerCase().includes(q))) return null;

  const policy = (group.Policies ?? []).find((item) =>
    [item.Name, item.ID, ...(item.ExpenseTypes ?? []).flatMap((expenseType) => [expenseType.Name, expenseType.Code, expenseType.ExpenseCode])]
      .some((field) => (field ?? '').toLowerCase().includes(q))
  );
  if (policy) return `Matched in policy: ${policy.Name ?? policy.ID ?? 'Expense policy'}`;

  const paymentType = (group.PaymentTypes ?? []).find((item) => (item.Name ?? '').toLowerCase().includes(q));
  if (paymentType) return `Matched in payment type: ${paymentType.Name ?? 'Payment type'}`;

  const attendeeType = (group.AttendeeTypes ?? []).find((item) =>
    [item.Name, item.Code].some((field) => (field ?? '').toLowerCase().includes(q))
  );
  return attendeeType ? `Matched in attendee type: ${attendeeType.Name ?? attendeeType.Code ?? 'Attendee type'}` : null;
}

/** One expense-group row; expanding shows its children inline. */
function GroupRow({
  group,
  query,
  expanded,
  onToggle,
}: {
  group: ExpenseGroupConfiguration;
  query: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const match = (...fields: (string | undefined)[]) => !query || fields.some((f) => (f ?? '').toLowerCase().includes(query));
  const [activeCollection, setActiveCollection] = useState<MatchCollection>(() => matchingCollection(group, query));
  const paymentTypes = (group.PaymentTypes ?? []).filter((p) => match(p.Name));
  const attendeeTypes = (group.AttendeeTypes ?? []).filter((a) => match(a.Name, a.Code));
  const policies = (group.Policies ?? []).filter(
    (p) => match(p.Name, p.ID) || (p.ExpenseTypes ?? []).some((et) => match(et.Name, et.Code, et.ExpenseCode))
  );
  const matchSummary = descendantMatchSummary(group, query);

  useEffect(() => {
    if (expanded) setActiveCollection(matchingCollection(group, query));
  }, [expanded, group, query]);

  return (
    <Fragment>
      <tr className={`border-b transition-colors last:border-0 motion-reduce:transition-none ${expanded ? 'bg-primary/5' : 'hover:bg-accent/50'}`}>
        <td className="w-11 px-2 py-2 text-center">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggle}
            aria-label={expanded ? 'Collapse group details' : 'Inspect group details'}
            aria-expanded={expanded}
          >
            <CaretRightIcon size={16} aria-hidden="true" className={`shrink-0 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`} />
          </Button>
        </td>
        <td className="px-4 py-2 sm:px-6">
          <div className="text-xs font-medium leading-tight text-foreground">
            {groupName(group) || 'Expense group'}
            {matchSummary && <span className="ml-1.5 font-normal text-[11px] text-muted-foreground">· {matchSummary}</span>}
          </div>
        </td>
        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{(group.Policies ?? []).length}</td>
        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{(group.PaymentTypes ?? []).length}</td>
        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{(group.AttendeeTypes ?? []).length}</td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={5} className="border-t bg-muted/30 p-0">
            <div className="border-l-2 border-l-primary/40 px-4 py-3 sm:px-5">
              {/* Group meta */}
              <div className="mb-3 flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-muted-foreground">
                {group.AttendeeListFormName && (
                  <span>Attendee form: <span className="font-medium text-foreground">{group.AttendeeListFormName}</span></span>
                )}
                {group.CashAdvance?.Name && (
                  <span>Cash advance: <span className="font-medium text-foreground">{group.CashAdvance.Name}</span></span>
                )}
                {group.AllowUserRegisterYodlee !== undefined && (
                  <span>Yodlee: <span className="font-medium text-foreground">{group.AllowUserRegisterYodlee ? 'Allowed' : 'Not allowed'}</span></span>
                )}
              </div>

              <Tabs
                active={activeCollection}
                onChange={(id) => setActiveCollection(id as MatchCollection)}
                tabs={[
                  { id: 'policies', label: `Expense policies (${(group.Policies ?? []).length})` },
                  { id: 'paymentTypes', label: `Payment types (${(group.PaymentTypes ?? []).length})` },
                  { id: 'attendeeTypes', label: `Attendee types (${(group.AttendeeTypes ?? []).length})` },
                ]}
              />
              <TabPanel>
                {activeCollection === 'policies' && <PoliciesSection policies={policies} query={query} />}
                {activeCollection === 'paymentTypes' && <PaymentTypesSection items={paymentTypes} />}
                {activeCollection === 'attendeeTypes' && <AttendeeTypesSection items={attendeeTypes} />}
              </TabPanel>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function EmptyNote({ children }: { children: string }) {
  return <p className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function PaymentTypesSection({ items }: { items: NonNullable<ExpenseGroupConfiguration['PaymentTypes']> }) {
  if (!items.length) return <EmptyNote>No payment types match.</EmptyNote>;
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm" aria-label="Payment types">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-1.5">Name</th>
            <th scope="col" className="px-3 py-1.5 text-right">Default</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p, i) => (
            <tr key={p.ID ?? i} className="border-b last:border-0 hover:bg-accent/40">
              <td className="px-3 py-1.5 text-xs font-medium text-foreground">{p.Name ?? '—'}</td>
              <td className="px-3 py-1.5 text-right">{p.IsDefault ? <Badge>Default</Badge> : <span className="text-muted-foreground">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttendeeTypesSection({ items }: { items: NonNullable<ExpenseGroupConfiguration['AttendeeTypes']> }) {
  if (!items.length) return <EmptyNote>No attendee types match.</EmptyNote>;
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm" aria-label="Attendee types">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-1.5">Code</th>
            <th scope="col" className="px-3 py-1.5">Name</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a, i) => (
            <tr key={a.Code ?? i} className="border-b last:border-0 hover:bg-accent/40">
              <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{a.Code ?? '—'}</td>
              <td className="px-3 py-1.5 text-xs font-medium text-foreground">{a.Name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PoliciesSection({ policies, query }: { policies: Policy[]; query: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!policies.length) return <EmptyNote>No expense policies match.</EmptyNote>;

  const matches = (et: { Code?: string; Name?: string; ExpenseCode?: string }) =>
    !query || [et.Name, et.Code, et.ExpenseCode].some((f) => (f ?? '').toLowerCase().includes(query));

  return (
    <div className="space-y-2">
      {policies.map((p, i) => {
        const id = p.ID ?? String(i);
        const open = openId === id;
        const ets = (p.ExpenseTypes ?? []).filter(matches);
        return (
          <div key={id} className="overflow-hidden rounded-md border bg-card">
            <button
              onClick={() => setOpenId(open ? null : id)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:ring-inset motion-reduce:transition-none"
            >
              <CaretRightIcon size={16} aria-hidden="true" className={`shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{p.Name ?? '—'}</span>
                  {p.IsDefault && <Badge>Default</Badge>}
                  {p.IsInheritable && <Badge>Inheritable</Badge>}
                </div>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {(p.ExpenseTypes ?? []).length} expense types
              </span>
            </button>

            {open && (
              <div className="overflow-x-auto border-t bg-muted/30 px-3 py-2">
                {ets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No expense types match the filter.</p>
                ) : (
                  <table className="w-full text-sm" aria-label={`Expense types for ${p.Name ?? 'policy'}`}>
                    <thead>
                      <tr className="text-left text-xs font-medium text-muted-foreground">
                        <th scope="col" className="py-2 pr-4">Code</th>
                        <th scope="col" className="py-2 pr-4">Name</th>
                        <th scope="col" className="py-2">Expense code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ets.map((et, j) => (
                        <tr key={`${et.Code ?? j}-${j}`} className="border-t border-border/50">
                          <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{et.Code ?? '—'}</td>
                          <td className="py-2 pr-4 text-xs font-medium text-foreground">{et.Name ?? '—'}</td>
                          <td className="py-2 font-mono text-xs text-muted-foreground">{et.ExpenseCode ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
