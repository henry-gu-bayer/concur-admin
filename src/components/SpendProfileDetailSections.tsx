import { useId, useState } from 'react';
import type { SpendApproverEntry, SpendCustomData, SpendDelegate, SpendRole, SpendUserProfile } from '../types';
import { ProfileDataTable, ProfileDetailSection, ProfileSchemaTable, humanizeProfileField, profileDataRows } from './ProfileDetailsUI';
import { UserReferenceDetails, useResolvedUserReferences, type UserReferenceResolution } from './UserReferenceDetails';
import { Badge } from './ui/Badge';

export const SPEND_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
export const SPEND_APPROVER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Approver';
export const SPEND_DELEGATE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Delegate';
export const SPEND_ROLE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Role';

const SPEND_USER_PREFERENCE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:UserPreference';
const SPEND_INVOICE_PREFERENCE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:InvoicePreference';
const SPEND_WORKFLOW_PREFERENCE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:spend:2.0:WorkflowPreference';

const PREFERENCE_SCHEMAS = [
  SPEND_USER_PREFERENCE_SCHEMA,
  SPEND_INVOICE_PREFERENCE_SCHEMA,
  SPEND_WORKFLOW_PREFERENCE_SCHEMA,
];

const KNOWN_SPEND_SCHEMAS = new Set([
  SPEND_USER_SCHEMA,
  SPEND_APPROVER_SCHEMA,
  SPEND_DELEGATE_SCHEMA,
  SPEND_ROLE_SCHEMA,
  ...PREFERENCE_SCHEMAS,
]);

export function SpendProfileDetailSections({
  profile,
  identityGeneration,
  companyCodeCustomField = 'custom11',
  approverCompanyCodes = {},
  loading = false,
  error,
}: {
  profile: SpendUserProfile | null;
  identityGeneration?: string;
  companyCodeCustomField?: string;
  approverCompanyCodes?: Record<string, string>;
  loading?: boolean;
  error?: string | null;
}) {
  const spend = profile?.[SPEND_USER_SCHEMA];
  const approvers = profile?.[SPEND_APPROVER_SCHEMA];
  const roles = profile?.[SPEND_ROLE_SCHEMA]?.roles ?? [];
  const delegateGroups = spendDelegates(profile);
  const delegates = delegateGroups.flatMap((group) => group.delegates);
  const approverEntries = [...(approvers?.report ?? []), ...(approvers?.request ?? []), ...(approvers?.cashAdvance ?? [])];
  const referenceIds = [
    spend?.biManager?.value,
    ...approverEntries.map((entry) => entry.approver?.value),
    ...delegates.map(delegateUserId),
  ];
  const resolvedReferences = useResolvedUserReferences(referenceIds, identityGeneration);
  const companyCode = spend?.customData?.find((item) => item.id?.toLocaleLowerCase() === companyCodeCustomField.toLocaleLowerCase())?.value?.trim() ?? '';

  if (loading || error || !profile) {
    return (
      <ProfileDetailSection title="Spend profile">
        <div className="py-2.5">
          {loading ? <p className="text-xs text-muted-foreground">Loading spend profile…</p> : null}
          {error ? <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{error}</div> : null}
          {!loading && !error ? <p className="text-xs text-muted-foreground">Spend profile unavailable.</p> : null}
        </div>
      </ProfileDetailSection>
    );
  }

  const profileRecord = profile as unknown as Record<string, unknown>;
  const otherSchemas = Object.entries(profileRecord)
    .filter(([key, value]) => key.startsWith('urn:') && !KNOWN_SPEND_SCHEMAS.has(key) && !key.endsWith(':ScimResource') && isRecord(value))
    .map(([schema, value]) => ({ schema, value, rows: profileDataRows(value) }))
    .filter(({ rows }) => rows.length);

  const preferenceSchemas = PREFERENCE_SCHEMAS
    .map((schema) => ({ schema, value: profileRecord[schema], rows: profileDataRows(profileRecord[schema]) }))
    .filter(({ value, rows }) => isRecord(value) && rows.length);

  return (
    <ProfileDetailSection title="Spend profile">
      <div className="space-y-2.5 py-2.5">
        <ProfileDetailSection title="Spend user">
          <ProfileSchemaTable label="Spend user schema fields" value={spend} excludedKeys={['biManager', 'customData']} />
          <UserReferenceDetails label="BI manager" userId={spend?.biManager?.value} resolution={spend?.biManager?.value ? resolvedReferences.get(spend.biManager.value) : undefined} />
        </ProfileDetailSection>

        {spend?.customData?.length ? (
          <ProfileDetailSection title={`Spend custom data (${spend?.customData?.length ?? 0})`}>
            <CustomDataTable items={spend.customData} />
          </ProfileDetailSection>
        ) : null}

        {approverEntries.length ? (
          <ProfileDetailSection title={`Approvers (${approverEntries.length})`}>
            <ApproverList approvers={approvers} resolvedReferences={resolvedReferences} companyCode={companyCode} approverCompanyCodes={approverCompanyCodes} />
          </ProfileDetailSection>
        ) : null}

        {delegates.length ? (
          <ProfileDetailSection title={`Delegates (${delegates.length})`}>
            <div className="grid gap-2 py-2.5">
              {delegateGroups.flatMap((group) => group.delegates.map((delegate, index) => (
                <DelegateItem
                  key={`${group.key}-${delegateUserId(delegate) ?? index}`}
                  delegate={delegate}
                  label={`${group.label} delegate${group.delegates.length > 1 ? ` ${index + 1}` : ''}`}
                  resolution={delegateUserId(delegate) ? resolvedReferences.get(delegateUserId(delegate)!) : undefined}
                />
              )))}
            </div>
          </ProfileDetailSection>
        ) : null}

        {roles.length ? (
          <ProfileDetailSection title={`Roles (${roles.length})`}>
            <div className="grid gap-1.5 py-2.5">
              {roles.map((role, index) => <RoleItem key={`${role.roleName ?? 'role'}-${index}`} role={role} />)}
            </div>
          </ProfileDetailSection>
        ) : null}

        {preferenceSchemas.map(({ schema, value }) => (
          <ProfileDetailSection key={schema} title={schemaLabel(schema)}>
            <ProfileSchemaTable label={`${schemaLabel(schema)} fields`} value={value} />
          </ProfileDetailSection>
        ))}

        {otherSchemas.map(({ schema, value }) => (
          <ProfileDetailSection key={schema} title={schemaLabel(schema)}>
            <ProfileSchemaTable label={`${schemaLabel(schema)} fields`} value={value} />
          </ProfileDetailSection>
        ))}
      </div>
    </ProfileDetailSection>
  );
}

function CustomDataTable({ items }: { items: SpendCustomData[] }) {
  return (
    <div className="overflow-x-auto py-2.5">
      <table aria-label="Spend custom data fields" className="w-full table-fixed border-separate border-spacing-0 text-left text-xs">
        <colgroup><col className="w-[38%]" /><col /></colgroup>
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="border-b border-border/70 px-2 py-1.5 font-medium">ID</th>
            <th scope="col" className="border-b border-border/70 px-2 py-1.5 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.id ?? 'custom'}-${index}`} className="align-top">
              <td className={`break-all px-2 py-1.5 font-mono text-[11px] text-muted-foreground ${index === items.length - 1 ? '' : 'border-b border-border/50'}`}>{item.id ?? '—'}</td>
              <td className={`break-all px-2 py-1.5 text-foreground ${index === items.length - 1 ? '' : 'border-b border-border/50'}`}>{item.value?.trim() || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function spendDelegates(profile: SpendUserProfile | null): Array<{ key: string; label: string; delegates: SpendDelegate[] }> {
  const extension = profile?.[SPEND_DELEGATE_SCHEMA];
  return [
    { key: 'expense', label: 'Expense', delegates: extension?.expense ?? [] },
    { key: 'payment', label: 'Payment', delegates: extension?.payment ?? [] },
    { key: 'purchase-request', label: 'Purchase request', delegates: extension?.purchaseRequest ?? [] },
  ].filter((group) => group.delegates.length);
}

function delegateUserId(delegate: SpendDelegate): string | undefined {
  const value = delegate.delegate?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function DelegateItem({ delegate, label, resolution }: { delegate: SpendDelegate; label: string; resolution?: UserReferenceResolution }) {
  const userId = delegateUserId(delegate);
  const permissions = Object.entries(delegate)
    .filter(([key, value]) => /^can[A-Z0-9_]/.test(key) && value === true)
    .map(([key]) => humanizeProfileField(key));
  const additionalRows = profileDataRows(Object.fromEntries(Object.entries(delegate).filter(([key]) => key !== 'delegate' && key !== 'temporaryDelegation' && !key.startsWith('can'))));
  return (
    <article className="overflow-hidden rounded-md border border-border/70 bg-muted/10">
      <div className="px-2.5"><UserReferenceDetails label={label} userId={userId} resolution={resolution} /></div>
      <div className="border-t border-border/60 px-2.5 py-2">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Granted permissions</p>
        <div className="flex flex-wrap gap-1.5">
          {permissions.length ? permissions.map((permission) => <Badge key={permission} tone="primary">{permission}</Badge>) : <span className="text-xs text-muted-foreground">No enabled permissions returned.</span>}
        </div>
      </div>
      {delegate.temporaryDelegation ? <div className="border-t border-border/60 px-2.5"><ProfileDataTable label={`${label} temporary delegation`} rows={profileDataRows(delegate.temporaryDelegation)} /></div> : null}
      {additionalRows.length ? <div className="border-t border-border/60 px-2.5"><ProfileDataTable label={`${label} additional fields`} rows={additionalRows} /></div> : null}
    </article>
  );
}

function ApproverList({ approvers, resolvedReferences, companyCode, approverCompanyCodes }: { approvers?: SpendUserProfile[typeof SPEND_APPROVER_SCHEMA]; resolvedReferences: Map<string, UserReferenceResolution>; companyCode: string; approverCompanyCodes: Record<string, string> }) {
  return (
    <div className="py-1">
      <ApproverGroup label="Report" entries={approvers?.report} resolvedReferences={resolvedReferences} companyCode={companyCode} approverCompanyCodes={approverCompanyCodes} />
      <ApproverGroup label="Request" entries={approvers?.request} resolvedReferences={resolvedReferences} companyCode={companyCode} approverCompanyCodes={approverCompanyCodes} />
      <ApproverGroup label="Cash advance" entries={approvers?.cashAdvance} resolvedReferences={resolvedReferences} companyCode={companyCode} approverCompanyCodes={approverCompanyCodes} />
    </div>
  );
}

function ApproverGroup({ label, entries, resolvedReferences, companyCode, approverCompanyCodes }: { label: string; entries?: SpendApproverEntry[]; resolvedReferences: Map<string, UserReferenceResolution>; companyCode: string; approverCompanyCodes: Record<string, string> }) {
  if (!entries?.length) return null;
  return <>{entries.map((entry, index) => {
    const userId = entry.approver?.value;
    const approverCompanyCode = userId ? approverCompanyCodes[userId] : '';
    const differentCompany = Boolean(companyCode && approverCompanyCode && companyCode !== approverCompanyCode);
    return <div key={`${userId ?? 'approver'}-${index}`} className={differentCompany ? 'rounded-md border border-amber-300 bg-amber-50/60 px-2' : ''}>
      <UserReferenceDetails label={entries.length > 1 ? `${label} ${index + 1}` : label} userId={userId} resolution={userId ? resolvedReferences.get(userId) : undefined} primary={entry.primary} />
      {approverCompanyCode ? <div className={`mb-2 ml-[124px] flex items-center gap-2 text-[11px] ${differentCompany ? 'text-amber-950' : 'text-muted-foreground'}`}><span className="font-medium uppercase tracking-wide">Company code</span><span className="font-mono">{approverCompanyCode}</span>{differentCompany ? <Badge tone="warning">Different from user ({companyCode})</Badge> : null}</div> : null}
    </div>;
  })}</>;
}

function RoleItem({ role }: { role: SpendRole }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const groups = role.roleGroups?.filter((group) => group.trim()) ?? [];
  const roleName = role.roleName ?? '—';

  return (
    <article className="overflow-hidden rounded-md border border-border/60 bg-muted/10">
      <div className="flex min-w-0 items-center justify-between gap-3 px-2.5 py-2">
        <span className="min-w-0 break-all font-mono text-xs font-medium text-foreground">{roleName}</span>
        {!groups.length ? <span className="shrink-0 text-[11px] text-muted-foreground">No groups</span> : groups.length === 1 ? <Badge tone="muted">{groups[0]}</Badge> : (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls={contentId}
            aria-label={`${open ? 'Collapse' : 'Expand'} groups for ${roleName}`}
            className="shrink-0 rounded px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open ? 'Hide' : 'Show'} {groups.length} groups
          </button>
        )}
      </div>
      {groups.length > 1 && open ? (
        <div id={contentId} className="flex flex-wrap gap-1.5 border-t border-border/60 px-2.5 py-2">
          {groups.map((group, index) => <Badge key={`${group}-${index}`} tone="muted">{group}</Badge>)}
        </div>
      ) : null}
    </article>
  );
}

function schemaLabel(schema: string): string {
  const explicit = spendPreferenceLabel(schema);
  if (explicit) return explicit;

  const parts = schema.split(':');
  const name = parts[parts.length - 1] || schema;
  const prefix = schema.includes(':spend:') ? 'Spend ' : schema.includes(':enterprise:') ? 'Enterprise ' : '';
  const label = humanizeProfileField(name).replace(/\b\w/g, (character) => character.toUpperCase());
  return `${prefix}${label}`;
}

function spendPreferenceLabel(schema: string): string | null {
  switch (schema) {
    case SPEND_USER_PREFERENCE_SCHEMA: return 'Spend user preference';
    case SPEND_INVOICE_PREFERENCE_SCHEMA: return 'Spend invoice preference';
    case SPEND_WORKFLOW_PREFERENCE_SCHEMA: return 'Spend workflow preference';
    default: return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
