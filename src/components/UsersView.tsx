import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { getUserProfile, searchUsers } from '../api/identityApi';
import { getSpendUser } from '../api/spendUserApi';
import { getActiveEntityId } from '../entities/entityStore';
import { loadUsersViewSession, saveUsersViewSession } from '../users/userSearchSessionCache';
import {
  IdentityEmail,
  IdentityPhoneNumber,
  IdentitySearchResponse,
  IdentityUserProfile,
  IdentityUserSummary,
  SpendApproverEntry,
  SpendCustomData,
  SpendRole,
  SpendUserProfile,
  UserSearchCriterion,
} from '../types';
import { SectionTone, sectionTones } from './sectionTones';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

const ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const SPEND_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const SPEND_APPROVER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Approver';
const SPEND_ROLE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Role';

const criteria: { id: UserSearchCriterion; label: string; placeholder: string }[] = [
  { id: 'loginId', label: 'Login ID', placeholder: 'henry.gu@bayer.com.uat' },
  { id: 'employeeId', label: 'Employee ID', placeholder: '08699477' },
  { id: 'email', label: 'Email', placeholder: 'HENRY.GU@BAYER.COM' },
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
    setProfileError(null);
    setSpendError(null);
    setProfileLoading(true);
    setSpendLoading(true);

    void getSpendUser(user.id)
      .then((result) => {
        if (seq !== profileSeq.current) return;
        setSpendProfile(result);
      })
      .catch((error: unknown) => {
        if (seq !== profileSeq.current) return;
        setSpendError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (seq === profileSeq.current) setSpendLoading(false);
      });

    try {
      const result = await getUserProfile(user.id);
      if (seq !== profileSeq.current) return;
      setProfile(result);
    } catch (error) {
      if (seq !== profileSeq.current) return;
      setProfileError(error instanceof Error ? error.message : String(error));
    } finally {
      if (seq === profileSeq.current) setProfileLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={search} className="mb-3 flex max-w-3xl">
        <div className="flex h-10 w-full rounded-md border border-input bg-card shadow-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
          <div className="relative w-32 shrink-0 border-r border-input">
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <section aria-label="User search results" className="min-w-0">
          {response === null ? (
            <EmptyPanel
              title="Search Concur users"
              message="Find Identity profiles by Login ID, Employee ID, or Email. Select a user to inspect the full profile."
            />
          ) : users.length === 0 ? (
            <EmptyPanel title="No users found" message="Try a different value or search criterion." />
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
                {response.totalResults ?? users.length} result{(response.totalResults ?? users.length) === 1 ? '' : 's'}
              </div>
              <table className="w-full text-sm" aria-label="User search results">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-2">Name</th>
                    <th scope="col" className="px-3 py-2">Login ID</th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">Employee ID</th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">Email</th>
                    <th scope="col" className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const loadingThisProfile = profileLoading && selectedUserId === user.id;
                    return (
                      <tr key={user.id} className="border-b last:border-0 hover:bg-accent/40">
                        <td className="px-3 py-2 text-xs font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void showProfile(user)}
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
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {user.userName ? (
                            <button
                              type="button"
                              onClick={() => void showProfile(user)}
                              disabled={loadingThisProfile}
                              aria-label={`View profile for ${user.userName}`}
                              className="rounded-sm text-left font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
                            >
                              {user.userName}
                            </button>
                          ) : '—'}
                        </td>
                        <td className="hidden px-3 py-2 text-xs text-muted-foreground md:table-cell">{employeeNumber(user)}</td>
                        <td className="hidden px-3 py-2 text-xs text-muted-foreground lg:table-cell">{primaryEmail(user.emails)}</td>
                        <td className="px-3 py-2">
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
          )}
        </section>

        <ProfilePanel
          profile={profile}
          spendProfile={spendProfile}
          loading={profileLoading}
          spendLoading={spendLoading}
          error={profileError}
          spendError={spendError}
          selectedUserId={selectedUserId}
        />
      </div>
    </div>
  );
}

function EmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
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
      className="min-w-0 rounded-lg border bg-card p-4 shadow-sm"
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