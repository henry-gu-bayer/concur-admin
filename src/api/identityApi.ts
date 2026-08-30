/**
 * Identity v4.1 live API client. All calls go through the existing Concur
 * proxy via concurFetch/concurGet — no local snapshots are read here.
 * Callers need the appropriate Identity read scopes on the Concur token.
 */
import { IdentitySearchResponse, IdentityUserProfile, UserSearchCriterion } from '../types';
import { concurFetch, concurGet } from './concurFetch';

const SEARCH_PATH = '/profile/identity/v4.1/Users/.search';
const PROFILE_PATH = '/profile/identity/v4.1/Users';
const SEARCH_SCHEMA = 'urn:ietf:params:scim:api:messages:concur:2.0:SearchRequest';
const ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

const SUMMARY_ATTRIBUTES = [
  'id',
  'userName',
  'name',
  'displayName',
  'active',
  'emails',
  `${ENTERPRISE_USER_SCHEMA}:employeeNumber`,
];

function escapeScimValue(value: string): string {
  return value.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildUserSearchFilter(criterion: UserSearchCriterion, value: string): string {
  const escaped = escapeScimValue(value);
  if (!escaped) throw new Error('Search value is required');

  switch (criterion) {
    case 'loginId':
      return `active eq true and userName sw "${escaped}"`;
    case 'employeeId':
      return `${ENTERPRISE_USER_SCHEMA}[employeeNumber eq "${escaped}"]`;
    case 'email':
      return `emails[type eq "work" and value sw "${escaped}"]`;
    case 'userId':
      throw new Error('UUID searches retrieve the user directly.');
  }
}

export async function searchUsers(criterion: UserSearchCriterion, value: string): Promise<IdentitySearchResponse> {
  if (criterion === 'userId') {
    const profile = await getUserProfile(value);
    return { totalResults: 1, startIndex: 1, itemsPerPage: 1, Resources: [profile] };
  }
  const response = await concurFetch(SEARCH_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemas: [SEARCH_SCHEMA],
      filter: buildUserSearchFilter(criterion, value),
      attributes: SUMMARY_ATTRIBUTES,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Identity user search failed: HTTP ${response.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return (await response.json()) as IdentitySearchResponse;
}

export async function getUserProfile(userId: string): Promise<IdentityUserProfile> {
  const id = userId.trim();
  if (!id) throw new Error('User ID is required');
  return concurGet<IdentityUserProfile>(`${PROFILE_PATH}/${encodeURIComponent(id)}`);
}
