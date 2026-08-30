import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUserSearchFilter, getUserProfile, searchUsers } from './identityApi';

const { concurFetch, concurGet } = vi.hoisted(() => ({
  concurFetch: vi.fn(),
  concurGet: vi.fn(),
}));

vi.mock('./concurFetch', () => ({
  concurFetch,
  concurGet,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('identityApi', () => {
  beforeEach(() => {
    concurFetch.mockReset();
    concurGet.mockReset();
  });

  it('builds a Login ID user search request', async () => {
    concurFetch.mockResolvedValue(jsonResponse({ totalResults: 1, Resources: [] }));

    await searchUsers('loginId', ' henry.gu@bayer.com.uat ');

    expect(concurFetch).toHaveBeenCalledWith(
      '/profile/identity/v4.1/Users/.search',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const init = concurFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:concur:2.0:SearchRequest'],
      filter: 'active eq true and userName sw "henry.gu@bayer.com.uat"',
      attributes: [
        'id',
        'userName',
        'name',
        'displayName',
        'active',
        'emails',
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber',
      ],
    });
  });

  it('builds Employee ID and Email filters', () => {
    expect(buildUserSearchFilter('employeeId', '08699477')).toBe(
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User[employeeNumber eq "08699477"]'
    );
    expect(buildUserSearchFilter('email', 'HENRY.GU@BAYER.COM')).toBe(
      'emails[type eq "work" and value sw "HENRY.GU@BAYER.COM"]'
    );
  });

  it('escapes quotes and backslashes in SCIM values', () => {
    expect(buildUserSearchFilter('loginId', ' domain\\user"name ')).toBe(
      'active eq true and userName sw "domain\\\\user\\"name"'
    );
  });

  it('rejects a blank search value', () => {
    expect(() => buildUserSearchFilter('email', '   ')).toThrow('Search value is required');
  });

  it('gets a full profile by user UUID', async () => {
    const profile = { id: '55b626dd-66a4-4722-af6d-d855ca8ded6c', displayName: 'Henry Gu' };
    concurGet.mockResolvedValue(profile);

    await expect(getUserProfile('55b626dd-66a4-4722-af6d-d855ca8ded6c')).resolves.toEqual(profile);
    expect(concurGet).toHaveBeenCalledWith(
      '/profile/identity/v4.1/Users/55b626dd-66a4-4722-af6d-d855ca8ded6c'
    );
  });

  it('uses the direct profile endpoint for a UUID search', async () => {
    const profile = { id: '55b626dd-66a4-4722-af6d-d855ca8ded6c', displayName: 'Henry Gu' };
    concurGet.mockResolvedValue(profile);

    await expect(searchUsers('userId', profile.id)).resolves.toMatchObject({ totalResults: 1, Resources: [profile] });
    expect(concurFetch).not.toHaveBeenCalled();
  });

  it('rejects a blank user ID before requesting a profile', async () => {
    await expect(getUserProfile('   ')).rejects.toThrow('User ID is required');
    expect(concurGet).not.toHaveBeenCalled();
  });

  it('throws a descriptive search error for non-OK responses', async () => {
    concurFetch.mockResolvedValue(new Response('identity scope missing', { status: 403 }));

    await expect(searchUsers('loginId', 'henry')).rejects.toThrow(
      'Identity user search failed: HTTP 403 — identity scope missing'
    );
  });
});
