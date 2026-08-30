import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { downloadActiveUsersCsv, getActiveUsersProgress, getActiveUsersSummary, queryActiveUsersLocal, refreshActiveUsersSnapshot } from '../api/activeUsersApi';
import { getUserProfile, searchUsers } from '../api/identityApi';
import { getSpendUser } from '../api/spendUserApi';
import { getSpendProfileLocalDetail } from '../api/spendProfilesApi';
import { getActiveEntityId } from '../entities/entityStore';
import { createEntitySessionCache } from '../state/entitySessionCache';
import { loadUsersViewSession, saveUsersViewSession } from '../users/userSearchSessionCache';
import {
  ActiveUserSortKey,
  ActiveUsersProgress,
  ActiveUsersSummary,
  IdentityEmail,
  IdentityPhoneNumber,
  IdentitySearchResponse,
  IdentityUserProfile,
  IdentityUserSummary,
  SpendApproverEntry,
  SpendCustomData,
  SpendFilterGroup,
  SpendProfileLocalDetail,
  SpendRole,
  SpendUserProfile,
  UserSearchCriterion,
} from '../types';
import { SectionTone, sectionTones } from './sectionTones';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ColumnResizeHandle, ResizableDetailLayout, useColumnWidths, useKeyedColumnWidths } from './ui/Resizable';
import { EmptyPanel } from './ui/AsyncState';
import { cleanFilters, ColumnChooser, countConditions, countGroups, DisplayColumn, emptyFilters, filterExpression, FilterGroupEditor, LocalSpendDetail, SpendProfilesWorkspace } from './SpendProfilesWorkspace';
import { useVirtualTableRows, VIRTUAL_TABLE_ROW_HEIGHT } from './useVirtualTableRows';

const ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const SPEND_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const SPEND_APPROVER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Approver';
const SPEND_ROLE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Role';

const criteria: { id: UserSearchCriterion; label: string; placeholder: string }[] = [
  { id: 'loginId', label: 'Login ID starts with', placeholder: 'firstName.lastName' },
  { id: 'employeeId', label: 'Employee ID', placeholder: '08699477' },
  { id: 'email', label: 'Work email starts with', placeholder: 'firstName.lastName' },
  { id: 'userId', label: 'UUID', placeholder: '55b626dd-66a4-4722-af6d-d855ca8ded6c' },
];

export function UsersView() {
  const [entityId] = useState(() => getActiveEntityId());
  const [cached] = useState(() => loadUsersViewSession(entityId));
  const [criterion, setCriterion] = useState<UserSearchCriterion>(cached?.criterion ?? 'loginId');
  const [value, setValue] = useState(cached?.value ?? '');
  const [response, setResponse] = useState<IdentitySearchResponse | null>(cached?.response ?? null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(cached?.selectedUserId ?? null);
  const [profile, setProfile] = useState<IdentityUserProfile | null>(cached?.profile ?? null);
  const [spendProfile, setSpendProfile] = useState<SpendUserProfile | null>(cached?.spendProfile ?? null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [spendLoading, setSpendLoading] = useState(false);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [localDetail, setLocalDetail] = useState<SpendProfileLocalDetail | null>(null);
  const [mode, setMode] = useState<'find-one' | 'all-active' | 'spend-profiles'>('find-one');
  const findColumns = useColumnWidths([190, 230, 150, 230, 100]);

  useEffect(() => {
    saveUsersViewSession(entityId, { criterion, value, response, selectedUserId, profile, spendProfile });
  }, [criterion, entityId, profile, response, selectedUserId, spendProfile, value]);

  // Monotonic request ids: a response is applied only if no newer request
  // of the same kind has started since it was issued.
  const searchSeq = useRef(0);
  const profileSeq = useRef(0);

  const users = response?.Resources ?? [];
  const activeCriterion = criteria.find((item) => item.id === criterion) ?? criteria[0];
  const trimmedValue = value.trim();

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedValue || searching) return;

    const seq = ++searchSeq.current;
    profileSeq.current += 1;
    setSearching(true);
    setSearchError(null);
    setSelectedUserId(null);
    setProfile(null);
    setSpendProfile(null);
    setLocalDetail(null);
    setProfileError(null);
    setSpendError(null);
    setProfileLoading(false);
    setSpendLoading(false);
    try {
      const result = await searchUsers(criterion, trimmedValue);
      if (seq !== searchSeq.current) return;
      setResponse(result);
    } catch (error) {
      if (seq !== searchSeq.current) return;
      setResponse(null);
      setSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const showProfile = async (user: IdentityUserSummary) => {
    const seq = ++profileSeq.current;
    setSelectedUserId(user.id);
    setProfile(null);
    setSpendProfile(null);
    setLocalDetail(null);
    setProfileError(null);
    setSpendError(null);
    setProfileLoading(true);
    try {
      const cachedDetail = await getSpendProfileLocalDetail(user.id);
      if (seq !== profileSeq.current) return;
      setLocalDetail(cachedDetail);
      setProfileLoading(false);
      setSpendLoading(false);
      return;
    } catch {
      // A user absent from the local snapshots falls back to the live APIs.
    }

    setSpendLoading(true);
    const [identityResult, spendResult] = await Promise.allSettled([getUserProfile(user.id), getSpendUser(user.id)]);
    if (seq !== profileSeq.current) return;
    if (identityResult.status === 'fulfilled') setProfile(identityResult.value);
    else setProfileError(identityResult.reason instanceof Error ? identityResult.reason.message : String(identityResult.reason));
    if (spendResult.status === 'fulfilled') setSpendProfile(spendResult.value);
    else setSpendError(spendResult.reason instanceof Error ? spendResult.reason.message : String(spendResult.reason));
    setProfileLoading(false);
    setSpendLoading(false);
  };

  const liveDetailPanel = localDetail
    ? <LocalSpendDetail detail={localDetail} loading={false} />
    : <ProfilePanel profile={profile} spendProfile={spendProfile} loading={profileLoading} spendLoading={spendLoading} error={profileError} spendError={spendError} selectedUserId={selectedUserId} />;

  return (
    <div className="flex min-h-0 flex-col xl:h-full">
      <div className="mb-4 flex w-fit rounded-lg border bg-muted/40 p-1" aria-label="User retrieval mode">
        <button type="button" onClick={() => setMode('find-one')} aria-pressed={mode === 'find-one'} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'find-one' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Search Users</button>
        <button type="button" onClick={() => setMode('all-active')} aria-pressed={mode === 'all-active'} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'all-active' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>User Profiles</button>
        <button type="button" onClick={() => setMode('spend-profiles')} aria-pressed={mode === 'spend-profiles'} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'spend-profiles' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Spend Profiles</button>
      </div>

      {mode === 'find-one' ? <>
      <form onSubmit={search} className="mb-3 flex max-w-3xl">
        <div className="flex h-10 w-full rounded-md border border-input bg-card shadow-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
          <div className="relative w-48 shrink-0 border-r border-input">
            <select
              aria-label="Search criterion"
              value={criterion}
              onChange={(event) => setCriterion(event.target.value as UserSearchCriterion)}
              className="h-full w-full appearance-none rounded-l-md bg-transparent pl-3 pr-8 text-sm text-foreground outline-none"
            >
              {criteria.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <input
            aria-label="Search user value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={activeCriterion.placeholder}
            className="min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="sm" loading={searching} disabled={!trimmedValue} aria-label={searching ? 'Searching' : 'Search'} className="m-1 shrink-0">
            {!searching && (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.8-3.8" strokeLinecap="round" />
              </svg>
            )}
            <span className="hidden sm:inline">{searching ? 'Searching…' : 'Search'}</span>
          </Button>
        </div>
      </form>

      {searchError && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {searchError}
        </div>
      )}

      <ResizableDetailLayout list={
        <section aria-label="User search results" className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm xl:min-h-0">
          {response === null ? (
            <EmptyPanel
              title="Search Concur users"
              message="Find Identity profiles by Login ID prefix, Employee ID, work email prefix, or UUID. Select a result to inspect local snapshots first."
            />
          ) : users.length === 0 ? (
            <EmptyPanel title="No users found" message="Try a different value or search criterion." />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                {response.totalResults ?? users.length} result{(response.totalResults ?? users.length) === 1 ? '' : 's'}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
              <table className="table-fixed text-xs" style={{ width: Math.max(findColumns.totalWidth, 900) }} aria-label="User search results">
                <colgroup>{findColumns.widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
                <thead className="sticky top-0 z-20 bg-muted">
                  <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                    {['Name', 'Login ID', 'Employee ID', 'Email', 'Status'].map((label, index) => <th key={label} scope="col" className="relative border-r px-3 py-2 font-medium">{label}<ColumnResizeHandle label={label} width={findColumns.widths[index]} onChange={(width) => findColumns.setWidth(index, width)} onReset={() => findColumns.resetWidth(index)} /></th>)}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const loadingThisProfile = profileLoading && selectedUserId === user.id;
                    const selected = selectedUserId === user.id;
                    return (
                      <tr
                        key={user.id}
                        className={`cursor-pointer border-b last:border-0 ${selected ? 'bg-primary/10' : 'hover:bg-accent/50'}`}
                        onClick={() => void showProfile(user)}
                      >
                        <td className="truncate border-r px-3 py-2 font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); void showProfile(user); }}
                              disabled={loadingThisProfile}
                              aria-label={`View profile for ${displayName(user)}`}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
                            >
                              {loadingThisProfile ? (
                                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
                                </svg>
                              ) : (
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" strokeLinejoin="round" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              )}
                            </button>
                            <span className="truncate">{displayName(user)}</span>
                          </div>
                        </td>
                        <td className="truncate border-r px-3 py-2 text-muted-foreground">
                          {user.userName ? (
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); void showProfile(user); }}
                              disabled={loadingThisProfile}
                              aria-label={`View profile for ${user.userName}`}
                              className="rounded-sm text-left font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
                            >
                              {user.userName}
                            </button>
                          ) : '—'}
                        </td>
                        <td className="truncate border-r px-3 py-2 text-muted-foreground">{employeeNumber(user)}</td>
                        <td className="truncate border-r px-3 py-2 text-muted-foreground">{primaryEmail(user.emails)}</td>
                        <td className="border-r px-3 py-2">
                          {user.active === undefined ? '—' : (
                            <Badge tone={user.active ? 'success' : 'muted'} dot>
                              {user.active ? 'Active' : 'Inactive'}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
        </section>
      } detail={liveDetailPanel} label="Resize user search results and profile details" initialListPercent={60} />
      </> : mode === 'all-active' ? (
        <ActiveUsersWorkspace entityId={entityId} onShowProfile={showProfile} detailPanel={liveDetailPanel} selectedUserId={selectedUserId} />
      ) : <SpendProfilesWorkspace entityId={entityId} />}
    </div>
  );
}

type ActiveSort = { key: ActiveUserSortKey; direction: 1 | -1 };
const ACTIVE_USER_COLUMNS: DisplayColumn[] = [
  { key: 'login', label: 'Login ID', group: 'identity', required: true },
  { key: 'employee', label: 'Employee ID', group: 'enterprise', required: true },
  { key: 'id', label: 'UUID', group: 'identity' },
  { key: 'name', label: 'Name', group: 'identity' },
  { key: 'firstName', label: 'First Name', group: 'identity' },
  { key: 'lastName', label: 'Last Name', group: 'identity' },
  { key: 'email', label: 'Email', group: 'identity' },
  { key: 'active', label: 'Active', group: 'identity' },
  { key: 'costCenter', label: 'Cost Center', group: 'enterprise' },
  { key: 'startDate', label: 'Start Date', group: 'enterprise' },
];
const ACTIVE_REQUIRED_COLUMNS = ['login', 'employee'];
const ACTIVE_USER_PAGE_SIZE = 200;

interface ActiveUsersWorkspaceSession {
  summary: ActiveUsersSummary | null;
  users: IdentityUserSummary[];
  total: number;
  hasMore: boolean;
  filters: SpendFilterGroup;
  debouncedFilters: SpendFilterGroup;
  sort: ActiveSort;
  selectedSnapshotUser: IdentityUserSummary | null;
  scrollTop: number;
}

const activeUsersWorkspaceSessions = createEntitySessionCache<ActiveUsersWorkspaceSession>();

export function resetActiveUsersWorkspaceSessions(): void {
  activeUsersWorkspaceSessions.clear();
}

function ActiveUsersWorkspace({
  entityId, onShowProfile, detailPanel, selectedUserId,
}: {
  entityId: string;
  onShowProfile: (user: IdentityUserSummary) => Promise<void>;
  detailPanel: ReactNode;
  selectedUserId: string | null;
}) {
  const [cached] = useState(() => activeUsersWorkspaceSessions.get(entityId));
  const [summary, setSummary] = useState<ActiveUsersSummary | null>(cached?.summary ?? null);
  const [users, setUsers] = useState<IdentityUserSummary[]>(cached?.users ?? []);
  const [total, setTotal] = useState(cached?.total ?? 0);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(!cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ActiveUsersProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SpendFilterGroup>(cached?.filters ?? emptyFilters());
  const [debouncedFilters, setDebouncedFilters] = useState<SpendFilterGroup>(cached?.debouncedFilters ?? emptyFilters());
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => ACTIVE_USER_COLUMNS.filter((column) => column.key !== 'id' && column.key !== 'costCenter' && column.key !== 'startDate').map((column) => column.key));
  const activeWidths = useKeyedColumnWidths();
  const [sort, setSort] = useState<ActiveSort>(cached?.sort ?? { key: 'name', direction: 1 });
  const [selectedSnapshotUser, setSelectedSnapshotUser] = useState<IdentityUserSummary | null>(cached?.selectedSnapshotUser ?? null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const querySequence = useRef(0);
  const loadMorePending = useRef(false);
  const loadMoreRef = useRef<() => void>(() => undefined);
  const reuseCachedRows = useRef(Boolean(cached));
  const virtualRows = useVirtualTableRows({
    rowCount: users.length,
    headerHeight: 33,
    initialScrollTop: cached?.scrollTop ?? 0,
    onNearEnd: () => loadMoreRef.current(),
  });

  useEffect(() => {
    let current = true;
    void getActiveUsersSummary()
      .then((result) => {
        if (!current) return;
        setSummary(result);
      })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); })
    return () => { current = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFilters(cleanFilters(filters)), 1000);
    return () => window.clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    let current = true;
    const sequence = ++querySequence.current;
    if (reuseCachedRows.current) {
      reuseCachedRows.current = false;
      setLoadingSnapshot(false);
      return () => { current = false; };
    }
    setLoadingSnapshot(true);
    setLoadingMore(false);
    loadMorePending.current = false;
    setError(null);
    void queryActiveUsersLocal({
      offset: 0,
      limit: ACTIVE_USER_PAGE_SIZE,
      filters: debouncedFilters,
      sortBy: sort.key,
      sortDir: sort.direction === 1 ? 'asc' : 'desc',
    }).then((result) => {
      if (!current || sequence !== querySequence.current) return;
      setUsers(result?.users ?? []);
      setTotal(result?.total ?? 0);
      setHasMore(result?.hasMore ?? false);
      setSelectedSnapshotUser(result?.users[0] ?? null);
      virtualRows.resetScroll();
    }).catch((reason: unknown) => {
      if (current && sequence === querySequence.current) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (current && sequence === querySequence.current) setLoadingSnapshot(false);
    });
    return () => { current = false; };
  }, [debouncedFilters, reloadVersion, sort]);

  useEffect(() => {
    activeUsersWorkspaceSessions.set(entityId, {
      summary, users, total, hasMore, filters, debouncedFilters, sort, selectedSnapshotUser, scrollTop: virtualRows.scrollTop,
    });
  }, [debouncedFilters, entityId, filters, hasMore, selectedSnapshotUser, sort, summary, total, users, virtualRows.scrollTop]);

  useEffect(() => {
    if (!cached?.scrollTop) return;
    const timer = window.setTimeout(() => {
      if (virtualRows.scrollRef.current) virtualRows.scrollRef.current.scrollTop = cached.scrollTop;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cached, virtualRows.scrollRef]);

  useEffect(() => {
    let current = true;
    void getActiveUsersProgress()
      .then((result) => {
        if (!current) return;
        setProgress(result);
        if (result.state === 'running') setRefreshing(true);
      })
      .catch(() => { /* Snapshot browsing remains available if progress status cannot be read. */ });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!refreshing) return;
    let current = true;
    const poll = async () => {
      try {
        const result = await getActiveUsersProgress();
        if (!current) return;
        setProgress(result);
        if (result.state === 'complete') {
          const latest = await getActiveUsersSummary();
          if (!current) return;
          setSummary(latest);
          setReloadVersion((version) => version + 1);
          setRefreshing(false);
        } else if (result.state === 'error') {
          setError(result.error ?? 'Active user retrieval failed.');
          setRefreshing(false);
        }
      } catch {
        // The refresh request still owns the final success/error result. A
        // transient progress polling failure must not cancel that request.
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 500);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [refreshing]);

  const retrieve = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const refreshed = await refreshActiveUsersSnapshot();
      setSummary(refreshed);
      setReloadVersion((version) => version + 1);
      const latestProgress = await getActiveUsersProgress().catch(() => null);
      if (latestProgress) setProgress(latestProgress);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRefreshing(false);
    }
  };

  const changeSort = (key: ActiveUserSortKey) => setSort((current) => ({
    key,
    direction: current.key === key ? (current.direction === 1 ? -1 : 1) : 1,
  }));

  const loadMore = async () => {
    if (!hasMore || loadMorePending.current || loadingSnapshot) return;
    const sequence = querySequence.current;
    loadMorePending.current = true;
    setLoadingMore(true);
    try {
      const result = await queryActiveUsersLocal({
        offset: users.length,
        limit: ACTIVE_USER_PAGE_SIZE,
        filters: debouncedFilters,
        sortBy: sort.key,
        sortDir: sort.direction === 1 ? 'asc' : 'desc',
      });
      if (sequence !== querySequence.current || !result) return;
      setUsers((current) => [...current, ...result.users]);
      setTotal(result.total);
      setHasMore(result.hasMore);
    } catch (reason) {
      if (sequence === querySequence.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      loadMorePending.current = false;
      if (sequence === querySequence.current) setLoadingMore(false);
    }
  };

  loadMoreRef.current = () => { void loadMore(); };

  const exportCsv = async () => {
    if (!summary || exporting) return;
    setExporting(true);
    setError(null);
    try {
      await downloadActiveUsersCsv({ filters: debouncedFilters, sortBy: sort.key, sortDir: sort.direction === 1 ? 'asc' : 'desc', columns: visibleKeys });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  };

  const activeColumns = ACTIVE_USER_COLUMNS.filter((column) => visibleKeys.includes(column.key));
  const widths = activeColumns.map((column) => activeWidths.widths[column.key] ?? activeUserColumnWidth(column.key));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const requiredLeft = ACTIVE_REQUIRED_COLUMNS.reduce<Record<string, number>>((positions, key, index) => {
    positions[key] = ACTIVE_REQUIRED_COLUMNS.slice(0, index).reduce((sum, preceding) => sum + (activeWidths.widths[preceding] ?? activeUserColumnWidth(preceding)), 0);
    return positions;
  }, {});
  const conditionCount = countConditions(debouncedFilters);
  const groupCount = countGroups(debouncedFilters);

  const visibleUsers = users.slice(virtualRows.range.start, virtualRows.range.end);

  const list = (
    <section aria-label="User Profiles" className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm xl:min-h-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-3">
        <Button type="button" size="sm" loading={refreshing} onClick={() => void retrieve()}>{refreshing ? 'Retrieving…' : 'Retrieve All'}</Button>
        <Button type="button" size="sm" variant="outline" loading={exporting} disabled={!summary || total === 0} onClick={() => void exportCsv()}>{exporting ? 'Exporting…' : 'Export CSV'}</Button>
        {summary ? <>
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{summary.count.toLocaleString()} local user profiles · {formatSnapshotDate(summary.retrievedAt)}</span>
          <span role="status" className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-emerald-700"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Snapshot ready</span>
        </> : <span className="whitespace-nowrap text-[11px] text-muted-foreground">No local snapshot</span>}
        <div className="relative ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setFiltersOpen((open) => !open)}>{filtersOpen ? 'Collapse filters' : 'Edit filters'}</Button>
          <Button size="sm" variant="outline" onClick={() => setColumnsOpen((open) => !open)}>Manage columns</Button>
          {columnsOpen ? <ColumnChooser columns={ACTIVE_USER_COLUMNS} visibleKeys={visibleKeys} onChange={setVisibleKeys} onClose={() => setColumnsOpen(false)} label="Manage User Profile columns" /> : null}
        </div>
      </div>
      <div className="border-b bg-muted/10 px-3 py-2.5">
        {filtersOpen ? <FilterGroupEditor root={filters} group={filters} fields={ACTIVE_USER_COLUMNS} depth={0} onChange={setFilters} /> : <div className="flex min-h-7 items-center gap-2 text-xs"><span className="font-medium text-muted-foreground">Filter</span><span className="rounded-md border bg-background px-2 py-1 font-mono text-[11px]">{filterExpression(debouncedFilters) || 'No conditions'}</span></div>}
        <div className="mt-2 flex items-center gap-3 border-t pt-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate font-mono">{filterExpression(cleanFilters(filters)) || 'Add conditions to filter any available User Profile field.'}</span>
          <span>{conditionCount} condition{conditionCount === 1 ? '' : 's'} · {groupCount} group{groupCount === 1 ? '' : 's'} · {total.toLocaleString()} matches</span>
          {filters.items.length ? <button type="button" className="font-medium text-primary hover:underline" onClick={() => setFilters(emptyFilters())}>Clear all</button> : null}
        </div>
      </div>
      {progress && progress.state !== 'idle' && progress.state !== 'complete' && <ActiveUsersProgressPanel progress={progress} />}
      {error && <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{error}</div>}
      {loadingSnapshot ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">Loading local snapshot…</div>
      ) : !summary ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <h2 className="text-sm font-semibold">Build the User Profiles snapshot</h2>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">Retrieve every active Identity profile. The complete User Profiles snapshot is saved in this entity’s data folder for filtered browsing and export.</p>
        </div>
      ) : (
        <>
        <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          {(['identity', 'enterprise'] as const).map((group) => {
            const groupColumns = ACTIVE_USER_COLUMNS.filter((column) => column.group === group);
            const allVisible = groupColumns.every((column) => visibleKeys.includes(column.key));
            return <button key={group} type="button" className={`rounded px-1.5 py-0.5 font-medium ${allVisible ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`} onClick={() => setVisibleKeys((current) => {
              const keys = new Set(groupColumns.map((column) => column.key));
              return allVisible ? current.filter((key) => !keys.has(key) || ACTIVE_REQUIRED_COLUMNS.includes(key)) : [...new Set([...current, ...keys])];
            })}>{group === 'identity' ? 'Identity' : 'Enterprise'} {activeColumns.filter((column) => column.group === group).length}</button>;
          })}
          <span>{activeColumns.length} of {ACTIVE_USER_COLUMNS.length} columns visible</span>
          <span className="ml-auto">Login ID and Employee ID stay visible</span>
        </div>
        <div
          ref={virtualRows.scrollRef}
          aria-label="User Profiles result list"
          className="min-h-0 flex-1 overflow-auto"
          onScroll={virtualRows.onScroll}
        >
          <table className="table-fixed text-xs" style={{ width: Math.max(totalWidth, 900) }} aria-label="User Profiles">
            <colgroup>{activeColumns.map((column, index) => <col key={column.key} style={{ width: widths[index] }} />)}</colgroup>
            <thead className="sticky top-0 z-30 bg-muted">
              <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                {activeColumns.map((column, index) => (
                  <th key={column.key} scope="col" className={`relative border-r px-3 py-2 font-medium ${column.required ? 'sticky z-40 bg-muted' : ''}`} style={column.required ? { left: requiredLeft[column.key] } : undefined}>
                    <button type="button" onClick={() => changeSort(column.key as ActiveUserSortKey)} className="inline-flex items-center gap-1 hover:text-foreground">{column.label}<SortMark active={sort.key === column.key} direction={sort.direction} /></button>
                    <ColumnResizeHandle label={column.label} width={widths[index]} onChange={(width) => activeWidths.setWidth(column.key, width)} onReset={() => activeWidths.resetWidth(column.key)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {virtualRows.range.topSpacerHeight > 0 && <tr aria-hidden="true" style={{ height: virtualRows.range.topSpacerHeight }}><td colSpan={activeColumns.length} /></tr>}
              {visibleUsers.map((user) => {
                const enterprise = user[ENTERPRISE_USER_SCHEMA];
                const selected = (selectedUserId ?? selectedSnapshotUser?.id) === user.id;
                return (
                  <tr key={user.id} style={{ height: VIRTUAL_TABLE_ROW_HEIGHT }} className={`cursor-pointer border-b last:border-0 ${selected ? 'bg-primary/10' : 'hover:bg-accent/50'}`} onClick={() => { setSelectedSnapshotUser(user); void onShowProfile(user); }}>
                    {activeColumns.map((column) => <td key={column.key} className={`truncate border-r px-3 py-2.5 ${column.required ? `sticky z-10 ${selected ? 'bg-primary/10' : 'bg-card'} font-mono text-[11px] text-primary` : 'text-muted-foreground'}`} style={column.required ? { left: requiredLeft[column.key] } : undefined}>{activeUserCell(user, column.key, enterprise)}</td>)}
                  </tr>
                );
              })}
              {virtualRows.range.bottomSpacerHeight > 0 && <tr aria-hidden="true" style={{ height: virtualRows.range.bottomSpacerHeight }}><td colSpan={activeColumns.length} /></tr>}
              {loadingMore && <tr><td colSpan={activeColumns.length} className="px-3 py-3 text-center text-xs text-muted-foreground">Loading more users…</td></tr>}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );

  const detail = selectedUserId ? detailPanel : <SnapshotProfilePanel user={selectedSnapshotUser} />;
  return <ResizableDetailLayout list={list} detail={detail} label="Resize active user results and profile details" initialListPercent={60} />;
}

function activeUserColumnWidth(key: string): number {
  if (key === 'id') return 220;
  if (key === 'login' || key === 'email') return 230;
  if (key === 'employee') return 150;
  if (key === 'name') return 180;
  return 145;
}

function activeUserCell(user: IdentityUserSummary, key: string, enterprise: IdentityUserSummary[typeof ENTERPRISE_USER_SCHEMA]): string {
  switch (key) {
    case 'id': return user.id;
    case 'name': return displayName(user);
    case 'firstName': return user.name?.givenName ?? '—';
    case 'lastName': return user.name?.familyName ?? '—';
    case 'login': return user.userName ?? '—';
    case 'employee': return enterprise?.employeeNumber ?? '—';
    case 'email': return primaryEmail(user.emails);
    case 'active': return user.active === undefined ? '—' : user.active ? 'Active' : 'Inactive';
    case 'costCenter': return enterprise?.costCenter ?? '—';
    case 'startDate': return enterprise?.startDate ?? '—';
    default: return '—';
  }
}

function ActiveUsersProgressPanel({ progress }: { progress: ActiveUsersProgress }) {
  const complete = progress.state === 'complete';
  const failed = progress.state === 'error';
  const knownTotal = progress.totalResults !== null;
  const status = failed ? 'Retrieval failed' : complete ? 'Snapshot complete' : 'Retrieving active profiles';
  const count = knownTotal
    ? `${progress.retrievedCount.toLocaleString()} of ${progress.totalResults!.toLocaleString()} profiles`
    : `${progress.retrievedCount.toLocaleString()} profiles retrieved`;
  const details = [
    progress.pageCount ? `Page ${progress.pageCount}` : null,
    progress.startIndex !== null ? `Start index ${progress.startIndex.toLocaleString()}` : null,
    `${progress.itemsPerPage} per request`,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`border-b px-3 py-2.5 ${failed ? 'bg-destructive/5' : complete ? 'bg-emerald-50/70' : 'bg-blue-50/70'}`} role="status" aria-live="polite">
      <div className="mb-1.5 flex items-baseline justify-between gap-4 text-[11px]">
        <div className="min-w-0">
          <span className={`font-semibold ${failed ? 'text-destructive' : complete ? 'text-emerald-700' : 'text-blue-700'}`}>{status}</span>
          <span className="ml-2 text-muted-foreground">{count}{details ? ` · ${details}` : ''}</span>
        </div>
        <span className={`shrink-0 font-semibold tabular-nums ${failed ? 'text-destructive' : complete ? 'text-emerald-700' : 'text-blue-700'}`}>{knownTotal || complete ? `${progress.percent}%` : 'In progress'}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label="Active user retrieval progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={knownTotal || complete ? progress.percent : undefined} role="progressbar">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${failed ? 'bg-destructive' : complete ? 'bg-emerald-500' : 'bg-primary'} ${knownTotal ? '' : 'animate-pulse'}`}
          style={{ width: knownTotal || complete ? `${progress.percent}%` : '34%' }}
        />
      </div>
    </div>
  );
}

function SnapshotProfilePanel({ user }: { user: IdentityUserSummary | null }) {
  if (!user) {
    return <ProfilePanel profile={null} spendProfile={null} loading={false} spendLoading={false} error={null} spendError={null} selectedUserId={null} />;
  }
  const enterprise = user[ENTERPRISE_USER_SCHEMA];
  return (
    <aside aria-label="User profile details" className="min-h-[360px] min-w-0 overflow-auto rounded-lg border bg-card p-4 shadow-sm xl:min-h-0">
      <div className="mb-4 border-b pb-4">
        <h2 className="text-base font-semibold">{displayName(user)}</h2>
        <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{user.id}</p>
      </div>
      <div className="space-y-3">
        <ProfileSection title="Identity snapshot" defaultOpen tone="blue">
          <Field label="Login ID" value={user.userName} />
          <Field label="Display name" value={user.displayName ?? user.name?.formatted} />
          <Field label="Email" value={primaryEmail(user.emails)} />
        </ProfileSection>
        <ProfileSection title="Enterprise snapshot" defaultOpen tone="violet">
          <Field label="Employee ID" value={enterprise?.employeeNumber} />
          <Field label="Cost center" value={enterprise?.costCenter} />
          <Field label="Start date" value={enterprise?.startDate} />
        </ProfileSection>
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">Select a row to load the local Identity and Spend Profile snapshots. Live APIs are used only when no local record exists.</p>
      </div>
    </aside>
  );
}

function SortMark({ active, direction }: { active: boolean; direction: 1 | -1 }) {
  return <span aria-hidden="true" className={active ? 'text-primary' : 'text-muted-foreground/50'}>{active ? (direction === 1 ? '↑' : '↓') : '↕'}</span>;
}

function formatSnapshotDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function ProfilePanel({
  profile,
  spendProfile,
  loading,
  spendLoading,
  error,
  spendError,
  selectedUserId,
}: {
  profile: IdentityUserProfile | null;
  spendProfile: SpendUserProfile | null;
  loading: boolean;
  spendLoading: boolean;
  error: string | null;
  spendError: string | null;
  selectedUserId: string | null;
}) {
  return (
    <aside
      aria-label="User profile details"
      aria-busy={loading}
      className="min-h-[360px] min-w-0 overflow-auto rounded-lg border bg-card p-4 shadow-sm xl:min-h-0"
    >
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">Loading profile…</p>}
      {!loading && !error && !profile && (
        <div className="flex min-h-56 flex-col items-center justify-center text-center">
          <h2 className="text-base font-semibold">No profile selected</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {selectedUserId ? 'Select the user again to retry.' : 'Choose a user from the search results to inspect the full Identity profile.'}
          </p>
        </div>
      )}
      {!loading && profile && profile.id === selectedUserId && (
        <ProfileDetails
          profile={profile}
          spendProfile={spendProfile?.id === selectedUserId ? spendProfile : null}
          spendLoading={spendLoading}
          spendError={spendError}
        />
      )}
    </aside>
  );
}

function ProfileDetails({
  profile,
  spendProfile,
  spendLoading,
  spendError,
}: {
  profile: IdentityUserProfile;
  spendProfile: SpendUserProfile | null;
  spendLoading: boolean;
  spendError: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex min-w-0 items-baseline gap-x-2">
        <h2 className="shrink-0 text-sm font-semibold text-foreground">{displayName(profile)}</h2>
        <p className="min-w-0 break-all font-mono text-xs text-muted-foreground">{profile.id}</p>
      </div>

      <ProfileSection title="Identity" defaultOpen tone="blue">
        <Field label="Login ID" value={profile.userName} />
        <Field label="Display name" value={profile.displayName ?? profile.name?.formatted} />
        <Field label="Preferred language" value={profile.preferredLanguage} />
        <Field label="Timezone" value={profile.timezone} />
        <Field label="Title" value={profile.title} />
        <Field label="Nickname" value={profile.nickName} />
        <Field label="Date of birth" value={profile.dateOfBirth} />
      </ProfileSection>

      <ProfileSection title="Contact" tone="emerald">
        <EmailList emails={profile.emails} />
        <PhoneList phoneNumbers={profile.phoneNumbers} />
      </ProfileSection>

      <ProfileSection title="Enterprise" tone="violet">
        <Field label="Employee ID" value={profile[ENTERPRISE_USER_SCHEMA]?.employeeNumber} />
        <Field label="Company ID" value={profile[ENTERPRISE_USER_SCHEMA]?.companyId} mono />
        <Field label="Cost center" value={profile[ENTERPRISE_USER_SCHEMA]?.costCenter} />
        <Field label="Start date" value={profile[ENTERPRISE_USER_SCHEMA]?.startDate} />
        <Field label="Termination date" value={profile[ENTERPRISE_USER_SCHEMA]?.terminationDate} />
      </ProfileSection>

      <SpendProfileSection spendProfile={spendProfile} loading={spendLoading} error={spendError} />
    </div>
  );
}

function SpendProfileSection({
  spendProfile,
  loading,
  error,
}: {
  spendProfile: SpendUserProfile | null;
  loading: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(true);
  const contentId = useId();
  const spend = spendProfile?.[SPEND_USER_SCHEMA];
  const approvers = spendProfile?.[SPEND_APPROVER_SCHEMA];
  const roles = spendProfile?.[SPEND_ROLE_SCHEMA]?.roles ?? [];
  const tone = sectionTones.amber;
  const approverCount = (approvers?.report?.length ?? 0) + (approvers?.request?.length ?? 0) + (approvers?.cashAdvance?.length ?? 0);

  return (
    <section className={`overflow-hidden rounded-md border ${tone.section}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${tone.header}`}
      >
        <span className={`text-xs font-semibold uppercase tracking-wide ${tone.title}`}>Spend profile</span>
        <svg
          className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''} ${tone.title}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={contentId} className={`space-y-2 border-t p-3 ${tone.body}`}>
          {loading && <p className="text-xs text-muted-foreground">Loading spend profile…</p>}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
              {error}
            </div>
          )}
          {!loading && !error && !spendProfile && <p className="text-xs text-muted-foreground">Spend profile unavailable.</p>}
          {!loading && !error && spendProfile && (
            <>
              <dl className="grid gap-1.5">
                <Field label="Currency" value={spend?.reimbursementCurrency} />
                <Field label="Reimbursement type" value={spend?.reimbursementType} />
                <Field label="Ledger code" value={spend?.ledgerCode} />
                <Field label="Country" value={spend?.country} />
                <Field label="Budget country" value={spend?.budgetCountryCode} />
                <Field label="State/Province" value={spend?.stateProvince} />
                <Field label="Locale" value={spend?.locale} />
                <Field label="Cash advance account" value={spend?.cashAdvanceAccountCode} />
                <Field label="Test employee" value={booleanLabel(spend?.testEmployee)} />
                <Field label="Non-employee" value={booleanLabel(spend?.nonEmployee)} />
                <Field label="BI manager" value={spend?.biManager?.value} mono />
              </dl>

              {spend?.customData?.length ? (
                <SpendSubsection title={`Custom data (${spend.customData.length})`} tone="sky">
                  <CustomDataList items={spend.customData} />
                </SpendSubsection>
              ) : null}

              {approvers && hasApprovers(approvers) ? (
                <SpendSubsection title={`Approvers (${approverCount})`} tone="rose">
                  <ApproverList approvers={approvers} />
                </SpendSubsection>
              ) : null}

              {roles.length ? (
                <SpendSubsection title={`Roles (${roles.length})`} tone="indigo">
                  <div className="grid gap-1">
                    {roles.map((role, index) => (
                      <RoleItem key={`${role.roleName ?? 'role'}-${index}`} role={role} />
                    ))}
                  </div>
                </SpendSubsection>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function SpendSubsection({ title, children, tone }: { title: string; children: ReactNode; tone: SectionTone }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const toneCls = sectionTones[tone];
  return (
    <div className={`overflow-hidden rounded-md border ${toneCls.section}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
        className={`flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${toneCls.header}`}
      >
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${toneCls.title}`}>{title}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''} ${toneCls.title}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div id={contentId} className={`border-t p-2.5 ${toneCls.body}`}>{children}</div>}
    </div>
  );
}

function CustomDataList({ items }: { items: SpendCustomData[] }) {
  return (
    <div className="grid gap-1.5">
      {items.map((item, index) => (
        <div key={`${item.id ?? 'custom'}-${index}`} className="grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-3">
          <span className="font-mono text-[11px] text-muted-foreground">{item.id ?? '—'}</span>
          <span className="min-w-0 break-all text-xs text-foreground">
            {item.value?.trim() ? item.value : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function hasApprovers(approvers: SpendUserProfile[typeof SPEND_APPROVER_SCHEMA]): boolean {
  return Boolean(approvers?.report?.length || approvers?.request?.length || approvers?.cashAdvance?.length);
}

function ApproverList({ approvers }: { approvers: NonNullable<SpendUserProfile[typeof SPEND_APPROVER_SCHEMA]> }) {
  return (
    <div className="grid gap-1.5">
      <ApproverRow label="Report" entries={approvers.report} />
      <ApproverRow label="Request" entries={approvers.request} />
      <ApproverRow label="Cash advance" entries={approvers.cashAdvance} />
    </div>
  );
}

function ApproverRow({ label, entries }: { label: string; entries?: SpendApproverEntry[] }) {
  if (!entries?.length) return null;
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0">
        <span className="flex flex-wrap gap-1.5">
          {entries.map((entry, index) => (
            <span key={`${entry.approver?.value ?? 'approver'}-${index}`} className="inline-flex min-w-0 items-center gap-1">
              <span className="break-all font-mono text-xs text-foreground">{entry.approver?.value ?? '—'}</span>
              {entry.primary && <Badge tone="muted">Primary</Badge>}
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}

function RoleItem({ role }: { role: SpendRole }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const groups = role.roleGroups?.filter((group) => group.trim()) ?? [];

  if (!groups.length) {
    return (
      <div className="flex items-baseline justify-between gap-3 rounded-md px-1 py-0.5">
        <span className="min-w-0 break-all font-mono text-xs text-foreground">{role.roleName ?? '—'}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">No groups</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={`Toggle role groups for ${role.roleName ?? 'role'}`}
        className="flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="min-w-0 break-all font-mono text-xs text-foreground">{role.roleName ?? '—'}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{groups.length} group{groups.length === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div id={contentId} className="border-t border-border/60 p-2">
          <div className="flex flex-wrap gap-1">
            {groups.map((group, index) => (
              <Badge key={`${group}-${index}`} tone="muted">{group}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileSection({ title, children, defaultOpen = false, tone }: { title: string; children: ReactNode; defaultOpen?: boolean; tone?: SectionTone }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const toneCls = tone ? sectionTones[tone] : null;
  return (
    <section className={`overflow-hidden rounded-md border ${toneCls ? toneCls.section : 'bg-muted/30'}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${toneCls ? toneCls.header : 'hover:bg-accent/50'}`}
      >
        <span className={`text-xs font-semibold uppercase tracking-wide ${toneCls ? toneCls.title : 'text-muted-foreground'}`}>{title}</span>
        <svg
          className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''} ${toneCls ? toneCls.title : 'text-muted-foreground'}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={contentId} className={`border-t p-3 ${toneCls ? toneCls.body : 'border-border/60'}`}>
          <dl className="grid gap-1.5">{children}</dl>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-all text-xs text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function EmailList({ emails }: { emails?: IdentityEmail[] }) {
  if (!emails?.length) return null;
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Emails</dt>
      <dd className="min-w-0">
        <ul className="space-y-0.5">
          {emails.map((email, index) => (
            <li key={`${email.value ?? 'email'}-${index}`} className="break-all text-xs text-foreground">
              {email.value ?? '—'} <span className="text-muted-foreground">({email.type ?? 'unknown'}{email.verified ? ', verified' : ''})</span>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function PhoneList({ phoneNumbers }: { phoneNumbers?: IdentityPhoneNumber[] }) {
  if (!phoneNumbers?.length) return null;
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Phone numbers</dt>
      <dd className="min-w-0">
        <ul className="space-y-0.5">
          {phoneNumbers.map((phone, index) => (
            <li key={`${phone.value ?? 'phone'}-${index}`} className="break-all text-xs text-foreground">
              {phone.value ?? '—'} <span className="text-muted-foreground">({phone.type ?? 'unknown'})</span>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function booleanLabel(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ? 'Yes' : 'No';
}

function displayName(user: IdentityUserSummary): string {
  const name = user.displayName ?? user.name?.formatted ?? [user.name?.givenName, user.name?.familyName].filter(Boolean).join(' ');
  return name || user.userName || 'Unknown user';
}

function employeeNumber(user: IdentityUserSummary): string {
  return user[ENTERPRISE_USER_SCHEMA]?.employeeNumber ?? '—';
}

function primaryEmail(emails?: IdentityEmail[]): string {
  return emails?.find((email) => email.type === 'work')?.value ?? emails?.[0]?.value ?? '—';
}
