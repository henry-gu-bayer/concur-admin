import { beforeEach, describe, expect, it } from 'vitest';
import { loadUsersViewSession, saveUsersViewSession, UsersViewSessionState } from './userSearchSessionCache';

const state: UsersViewSessionState = {
  criterion: 'employeeId',
  value: '08699477',
  response: {
    totalResults: 1,
    Resources: [{ id: 'user-1', userName: 'henry.gu@bayer.com.uat' }],
  },
  selectedUserId: 'user-1',
  profile: { id: 'user-1', userName: 'henry.gu@bayer.com.uat' },
  spendProfile: {
    id: 'user-1',
    'urn:ietf:params:scim:schemas:extension:spend:2.0:User': { reimbursementCurrency: 'CNY' },
  },
};

describe('userSearchSessionCache', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('saves and loads the latest Users view state per entity', () => {
    saveUsersViewSession('us-uat', state);
    saveUsersViewSession('eu-uat', { ...state, value: 'eu-user', selectedUserId: null, profile: null });

    expect(loadUsersViewSession('us-uat')).toEqual(state);
    expect(loadUsersViewSession('eu-uat')?.value).toBe('eu-user');
    expect(loadUsersViewSession('missing')).toBeNull();
  });

  it('returns null for invalid JSON and drops a profile that does not match the selected user', () => {
    sessionStorage.setItem('concur-admin:users-view:us-uat', '{not json');
    expect(loadUsersViewSession('us-uat')).toBeNull();

    saveUsersViewSession('us-uat', { ...state, profile: { id: 'other-user' } });
    expect(loadUsersViewSession('us-uat')).toMatchObject({ selectedUserId: 'user-1', profile: null });

    saveUsersViewSession('us-uat', { ...state, spendProfile: { id: 'other-user' } });
    expect(loadUsersViewSession('us-uat')).toMatchObject({ selectedUserId: 'user-1', spendProfile: null });
  });

  it('restores UUID as the selected search criterion', () => {
    const uuidState: UsersViewSessionState = {
      criterion: 'userId',
      value: '32C2FCC3-B2E8-4907-9672-5B3F49B1C643',
      response: null,
      selectedUserId: null,
      profile: null,
      spendProfile: null,
    };

    saveUsersViewSession('us-uat', uuidState);
    expect(loadUsersViewSession('us-uat')).toEqual(uuidState);
  });
});
