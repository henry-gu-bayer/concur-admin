import { Fragment, useEffect, useMemo, useState } from 'react';
import { getExpenseGroups, getUserExpenseGroups, refreshExpenseGroups } from '../api/expenseGroupsApi';
import { timeAgo } from '../api/listsApi';
import { ExpenseGroupConfiguration, ExpenseGroupsSnapshot, Policy, UserExpenseGroupsData } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

/**
 * Expense Group Configurations (v3) — presented like Lists / list items.
 *
 * Each expense GROUP is a row (a "foundation data" parent). Expanding a row
 * reveals its CHILDREN: the four collections it owns — payment types, expense
 * policies (each expandable to its expense types), and attendee types. The
 * whole snapshot arrives in one fetch (no lazy loading needed — it's a single
 * small document), and a Refresh re-retrieves all pages from Concur.
 */

export function ExpenseGroupsView() {
  const [snapshot, setSnapshot] = useState<ExpenseGroupsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getExpenseGroups()
      .then((d) => !cancelled && setSnapshot(d))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

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

  const q = query.trim().toLowerCase();
  const match = (...fields: (string | undefined)[]) => !q || fields.some((f) => (f ?? '').toLowerCase().includes(q));

  /* A group matches if it or ANY of its children match the filter; sorted A→Z by name. */
  const filtered = useMemo(
    () =>
      groups
        .filter(
          (g) =>
            match(g.Name, g.ID) ||
            (g.PaymentTypes ?? []).some((p) => match(p.Name)) ||
            (g.AttendeeTypes ?? []).some((a) => match(a.Name, a.Code)) ||
            (g.Policies ?? []).some(
              (p) => match(p.Name, p.ID) || (p.ExpenseTypes ?? []).some((et) => match(et.Name, et.Code, et.ExpenseCode))
            )
        )
        .sort((a, b) => groupName(a).localeCompare(groupName(b), undefined, { sensitivity: 'base' })),
    [groups, q]
  );

  if (loading) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card" aria-busy="true" aria-label="Loading expense groups">
        <div className="border-b bg-muted/50 px-4 py-3 sm:px-6">
          <div className="h-3 w-56 rounded bg-muted-foreground/20 animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0 sm:px-6">
            <div className="h-4 flex-1 rounded bg-muted animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]" />
          </div>
        ))}
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-16 text-center" role="alert">
        <h2 className="text-base font-semibold text-destructive">Couldn't load expense groups</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" className="mt-5" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* ── Toolbar: search + refresh ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search groups, policies, types…" aria-label="Search expense groups" className="pl-9" />
        </div>

        <div className="ml-auto flex items-center gap-3">
          {snapshot && (
            <span className="hidden text-xs text-muted-foreground sm:block" title={new Date(snapshot.retrievedAt).toLocaleString()}>
              {filtered.length} of {snapshot.count} groups · retrieved {timeAgo(snapshot.retrievedAt)}
            </span>
          )}
          <Button variant="outline" size="sm" loading={refreshing} onClick={doRefresh}>
            {refreshing ? 'Retrieving…' : 'Retrieve again'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          Refresh failed: {error}
        </div>
      )}

      {/* ── Per-user lookup ── */}
      <UserLookupPanel />

      {/* ── Groups table (parents) ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
          <h2 className="text-base font-semibold">{groups.length === 0 ? 'No expense group configurations' : 'No groups match'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{groups.length === 0 ? 'Retrieve to pull the configuration from Concur.' : 'Try a different search.'}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <table className="w-full text-sm" aria-label="Expense groups">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3 sm:px-6">Group</th>
                <th scope="col" className="px-4 py-3 text-right">Policies</th>
                <th scope="col" className="hidden px-4 py-3 text-right sm:table-cell">Payment types</th>
                <th scope="col" className="hidden px-4 py-3 text-right md:table-cell">Attendee types</th>
                <th scope="col" className="px-4 py-3 text-right sm:px-6"><span className="sr-only">Expand</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g, i) => (
                <GroupRow
                  key={g.ID ?? i}
                  group={g}
                  query={q}
                  expanded={expandedId === (g.ID ?? String(i))}
                  onToggle={() => setExpandedId((c) => (c === (g.ID ?? String(i)) ? null : g.ID ?? String(i)))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
    <div className="mb-3 rounded-lg border bg-card shadow-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(false);
        }}
        className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6"
      >
        <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <label htmlFor="user-lookup" className="text-sm font-medium">
          Find by user
        </label>
        <Input
          id="user-lookup"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="User login ID (e.g. jsmith)…"
          className="min-w-[220px] flex-1 sm:max-w-sm"
        />
        <Button type="submit" size="sm" loading={searching} disabled={!loginId.trim()}>
          {searching ? 'Searching…' : 'Look up'}
        </Button>
        {result && (
          <Button type="button" variant="outline" size="sm" onClick={() => void search(true)} disabled={searching} title="Re-fetch from Concur and update the cache">
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
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm" aria-label={`Expense groups for ${result.loginId}`}>
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
  const paymentTypes = (group.PaymentTypes ?? []).filter((p) => match(p.Name));
  const attendeeTypes = (group.AttendeeTypes ?? []).filter((a) => match(a.Name, a.Code));
  const policies = (group.Policies ?? []).filter(
    (p) => match(p.Name, p.ID) || (p.ExpenseTypes ?? []).some((et) => match(et.Name, et.Code, et.ExpenseCode))
  );

  return (
    <Fragment>
      <tr onClick={onToggle} aria-expanded={expanded} className={`cursor-pointer border-b transition-colors last:border-0 hover:bg-accent/50 ${expanded ? 'bg-accent/40' : ''}`}>
        <td className="px-4 py-3 sm:px-6">
          <div className="font-medium leading-tight text-primary">{groupName(group) || 'Expense group'}</div>
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{(group.Policies ?? []).length}</td>
        <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">{(group.PaymentTypes ?? []).length}</td>
        <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground md:table-cell">{(group.AttendeeTypes ?? []).length}</td>
        <td className="px-4 py-3 text-right sm:px-6">
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            aria-label={expanded ? 'Collapse children' : 'Expand children'}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={5} className="border-t bg-muted/40 p-0">
            {/* Left accent bar ties the children to the parent group row. */}
            <div className="border-l-2 border-primary/40 px-4 py-3 sm:ml-2 sm:px-5 animate-fade-in">
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

              <div className="space-y-3">
                <ChildrenSection title="Expense policies" count={policies.length}>
                  <PoliciesSection policies={policies} query={query} />
                </ChildrenSection>

                <ChildrenSection title="Payment types" count={paymentTypes.length}>
                  <PaymentTypesSection items={paymentTypes} />
                </ChildrenSection>

                <ChildrenSection title="Attendee types" count={attendeeTypes.length}>
                  <AttendeeTypesSection items={attendeeTypes} />
                </ChildrenSection>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** A labelled child-collection block, indented with a tree guide line. */
function ChildrenSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="relative pl-3.5">
      {/* Vertical guide line connecting this section's children. */}
      <span className="absolute left-0 top-1 bottom-1 w-px bg-border" aria-hidden="true" />
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function EmptyNote({ children }: { children: string }) {
  return <p className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function PaymentTypesSection({ items }: { items: NonNullable<ExpenseGroupConfiguration['PaymentTypes']> }) {
  if (!items.length) return <EmptyNote>No payment types match.</EmptyNote>;
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <table className="w-full text-sm" aria-label="Payment types">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-3 py-1.5">Name</th>
            <th scope="col" className="px-3 py-1.5 text-right">Default</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p, i) => (
            <tr key={p.ID ?? i} className="border-b last:border-0 hover:bg-accent/40">
              <td className="px-3 py-1.5 font-medium text-emerald-600 dark:text-emerald-400">{p.Name ?? '—'}</td>
              <td className="px-3 py-1.5 text-right">{p.IsDefault ? <Badge tone="primary">Default</Badge> : <span className="text-muted-foreground">—</span>}</td>
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
    <div className="overflow-hidden rounded-md border bg-card">
      <table className="w-full text-sm" aria-label="Attendee types">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-3 py-1.5">Code</th>
            <th scope="col" className="px-3 py-1.5">Name</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a, i) => (
            <tr key={a.Code ?? i} className="border-b last:border-0 hover:bg-accent/40">
              <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{a.Code ?? '—'}</td>
              <td className="px-3 py-1.5 font-medium text-sky-600 dark:text-sky-400">{a.Name ?? '—'}</td>
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
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
            >
              <svg className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-violet-600 dark:text-violet-400">{p.Name ?? '—'}</span>
                  {p.IsDefault && <Badge tone="primary">Default</Badge>}
                  {p.IsInheritable && <Badge>Inheritable</Badge>}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                {(p.ExpenseTypes ?? []).length} expense types
              </span>
            </button>

            {open && (
              <div className="border-t bg-muted/40 px-4 py-3 animate-fade-in">
                {ets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No expense types match the filter.</p>
                ) : (
                  <table className="w-full text-sm" aria-label={`Expense types for ${p.Name ?? 'policy'}`}>
                    <thead>
                      <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="py-2 pr-4">Code</th>
                        <th scope="col" className="py-2 pr-4">Name</th>
                        <th scope="col" className="py-2">Expense code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ets.map((et, j) => (
                        <tr key={`${et.Code ?? j}-${j}`} className="border-t border-border/50">
                          <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{et.Code ?? '—'}</td>
                          <td className="py-2 pr-4 font-medium text-amber-600 dark:text-amber-400">{et.Name ?? '—'}</td>
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
