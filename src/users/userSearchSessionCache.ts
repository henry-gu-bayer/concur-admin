import { IdentitySearchResponse, IdentityUserProfile, SpendUserProfile, UserSearchCriterion } from '../types';

export interface UsersViewSessionState {
  criterion: UserSearchCriterion;
  value: string;
  response: IdentitySearchResponse | null;
  selectedUserId: string | null;
  profile: IdentityUserProfile | null;
  spendProfile: SpendUserProfile | null;
}

const STORAGE_PREFIX = 'concur-admin:users-view:';
const criteria: UserSearchCriterion[] = ['loginId', 'employeeId', 'email', 'userId'];

function storageKey(entityId: string): string {
  return `${STORAGE_PREFIX}${entityId.trim() || 'default'}`;
}

function isCriterion(value: unknown): value is UserSearchCriterion {
  return typeof value === 'string' && criteria.includes(value as UserSearchCriterion);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function loadUsersViewSession(entityId: string): UsersViewSessionState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(entityId));
    if (!raw) return null;
    const parsed = asObject(JSON.parse(raw));
    if (!parsed) return null;

    const selectedUserId = typeof parsed.selectedUserId === 'string' ? parsed.selectedUserId : null;
    const profile = asObject(parsed.profile) as IdentityUserProfile | null;
    const spendProfile = asObject(parsed.spendProfile) as SpendUserProfile | null;

    return {
      criterion: isCriterion(parsed.criterion) ? parsed.criterion : 'loginId',
      value: typeof parsed.value === 'string' ? parsed.value : '',
      response: asObject(parsed.response) as IdentitySearchResponse | null,
      selectedUserId,
      profile: profile && (!selectedUserId || profile.id === selectedUserId) ? profile : null,
      spendProfile: spendProfile && (!selectedUserId || spendProfile.id === selectedUserId) ? spendProfile : null,
    };
  } catch {
    return null;
  }
}

export function saveUsersViewSession(entityId: string, state: UsersViewSessionState): void {
  try {
    sessionStorage.setItem(storageKey(entityId), JSON.stringify(state));
  } catch {
    // sessionStorage can be unavailable or full; the page must remain usable.
  }
}
