import type { TravelUserProfile } from '../types';
import { ProfileDataTable, ProfileDetailSection, ProfileSchemaTable, profileDataRows } from './ProfileDetailsUI';
import { UserReferenceDetails, useResolvedUserReferences } from './UserReferenceDetails';

const TRAVEL_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:travel:2.0:User';

export function TravelProfileDetailSections({
  profile,
  loading = false,
  error,
}: {
  profile: TravelUserProfile | null;
  loading?: boolean;
  error?: string | null;
}) {
  const extension = profile?.[TRAVEL_USER_SCHEMA];
  const ruleClass = extension?.ruleClass;
  const manager = extension?.manager;
  const managerId = manager?.value?.trim() ? manager.value.trim() : undefined;
  const name = extension?.name;
  const customFields = [...(extension?.customFields ?? [])]
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' }));

  const managerReferences = useResolvedUserReferences(managerId ? [managerId] : []);
  const resolvedManager = managerId ? managerReferences.get(managerId) : undefined;

  if (loading || error || !profile) {
    return (
      <ProfileDetailSection title="Travel profile">
        <div className="py-2.5">
          {loading ? <p className="text-xs text-muted-foreground">Loading travel profile…</p> : null}
          {error ? <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{error}</div> : null}
          {!loading && !error ? <p className="text-xs text-muted-foreground">Travel profile unavailable.</p> : null}
        </div>
      </ProfileDetailSection>
    );
  }

  const customRows = profileDataRows(
    Object.fromEntries(customFields.map((field) => [field.name, field.value ?? true]))
  );

  return (
    <ProfileDetailSection title="Travel profile">
      <div className="space-y-2.5 py-2.5">
        <ProfileDetailSection title="Travel user">
          <ProfileSchemaTable
            label="Travel user schema fields"
            value={extension}
            excludedKeys={['customFields', 'ruleClass', 'manager', 'name']}
          />
        </ProfileDetailSection>

        {ruleClass ? (
          <ProfileDetailSection title="Travel rule class">
            <ProfileDataTable label="Travel rule class fields" rows={profileDataRows(ruleClass)} />
          </ProfileDetailSection>
        ) : null}

        {name ? (
          <ProfileDetailSection title="Travel name">
            <ProfileDataTable label="Travel name fields" rows={profileDataRows(name)} />
          </ProfileDetailSection>
        ) : null}

        {manager ? (
          <ProfileDetailSection title="Travel manager">
            <div className="py-1">
              <UserReferenceDetails label="Manager" userId={managerId} resolution={resolvedManager} />
            </div>
            <ProfileDataTable label="Travel manager fields" rows={profileDataRows(manager)} />
          </ProfileDetailSection>
        ) : null}

        {customRows.length ? (
          <ProfileDetailSection title={`Travel custom fields (${customRows.length})`}>
            <ProfileDataTable label="Travel custom fields" rows={customRows} />
          </ProfileDetailSection>
        ) : null}
      </div>
    </ProfileDetailSection>
  );
}
