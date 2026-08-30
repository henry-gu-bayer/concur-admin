import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetActiveUsersWorkspaceSessions, UsersView } from './UsersView';

const { searchUsers, getUserProfile, getSpendUser, getSpendProfileLocalDetail, getActiveUsersSummary, getActiveUsersProgress, queryActiveUsersLocal, refreshActiveUsersSnapshot, downloadActiveUsersCsv } = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  getUserProfile: vi.fn(),
  getSpendUser: vi.fn(),
  getSpendProfileLocalDetail: vi.fn(),
  getActiveUsersSummary: vi.fn(),
  getActiveUsersProgress: vi.fn(),
  queryActiveUsersLocal: vi.fn(),
  refreshActiveUsersSnapshot: vi.fn(),
  downloadActiveUsersCsv: vi.fn(),
}));

vi.mock('../api/identityApi', () => ({
  searchUsers,
  getUserProfile,
}));

vi.mock('../api/spendUserApi', () => ({
  getSpendUser,
}));

vi.mock('../api/spendProfilesApi', () => ({
  getSpendProfileLocalDetail,
}));

vi.mock('../api/activeUsersApi', () => ({
  getActiveUsersSummary,
  getActiveUsersProgress,
  queryActiveUsersLocal,
  refreshActiveUsersSnapshot,
  downloadActiveUsersCsv,
}));

const enterpriseSchema = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const spendUserSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const spendApproverSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Approver';
const spendRoleSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Role';
const spendUserPreferenceSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:UserPreference';

const searchResponse = {
  totalResults: 1,
  Resources: [
    {
      id: '55b626dd-66a4-4722-af6d-d855ca8ded6c',
      userName: 'henry.gu@bayer.com.uat',
      displayName: 'Henry Gu',
      name: { givenName: 'Henry', familyName: 'Gu', formatted: 'Henry Gu' },
      active: true,
      emails: [{ value: 'HENRY.GU@BAYER.COM', type: 'work', verified: false, notifications: true }],
      [enterpriseSchema]: { employeeNumber: '08699477', companyId: 'ff0125e2-94ba-4368-ad5d-29eceb0ef06d' },
    },
  ],
};

const profile = {
  ...searchResponse.Resources[0],
  timezone: 'America/New_York',
  preferredLanguage: 'en-US',
  phoneNumbers: [],
  localeOverrides: {
    preferenceDateFormat: 'mm/dd/yyyy',
    preferenceDistance: 'mile',
    preferenceFirstDayOfWeek: 'Sunday',
  },
  addresses: [
    { type: 'home', country: 'US' },
    { type: 'work', country: 'US' },
  ],
  meta: {
    resourceType: 'User',
    created: '2024-04-19T06:38:03.694068Z',
    lastModified: '2026-07-30T23:08:09.610008528Z',
    version: 18,
  },
};

const spendProfile = {
  id: '55b626dd-66a4-4722-af6d-d855ca8ded6c',
  [spendUserSchema]: {
    reimbursementCurrency: 'CNY',
    ledgerCode: 'GLOBALCOA',
    country: 'CN',
    locale: 'en-US',
    cashAdvanceAccountCode: '0882Q2RM508',
    testEmployee: false,
    nonEmployee: false,
    customData: [
      { id: 'custom11', value: '0882', syncGuid: '81788dba-94f7-fb4d-bbfb-aa9bfd1f6bdf' },
      { id: 'custom15', value: 'Y' },
    ],
  },
  [spendApproverSchema]: {
    report: [{ approver: { value: '9e8b3104-d799-4efb-b2a4-966a836024b7' }, primary: true }],
  },
  [spendRoleSchema]: {
    roles: [{ roleName: 'EXP_PROCESSOR_ADMIN', roleGroups: ['', 'Bayer China'] }],
  },
  [spendUserPreferenceSchema]: {
    expenseAuditRequired: 'REQUIRED',
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('UsersView', () => {
  afterEach(cleanup);

  beforeEach(() => {
    sessionStorage.clear();
    resetActiveUsersWorkspaceSessions();
    searchUsers.mockReset();
    getUserProfile.mockReset();
    getSpendUser.mockReset();
    getSpendProfileLocalDetail.mockReset();
    getActiveUsersSummary.mockReset();
    getActiveUsersProgress.mockReset();
    queryActiveUsersLocal.mockReset();
    refreshActiveUsersSnapshot.mockReset();
    downloadActiveUsersCsv.mockReset();
    searchUsers.mockResolvedValue(searchResponse);
    getUserProfile.mockResolvedValue(profile);
    getSpendUser.mockResolvedValue(spendProfile);
    getSpendProfileLocalDetail.mockRejectedValue(new Error('No local record'));
    getActiveUsersSummary.mockResolvedValue(null);
    queryActiveUsersLocal.mockResolvedValue(null);
    getActiveUsersProgress.mockResolvedValue({
      entityId: 'us-uat', state: 'idle', startedAt: null, updatedAt: null,
      retrievedCount: 0, totalResults: null, pageCount: 0, startIndex: null,
      itemsPerPage: 100, percent: 0,
    });
    refreshActiveUsersSnapshot.mockResolvedValue({
      entityId: 'us-uat',
      retrievedAt: '2026-08-29T12:00:00.000Z',
      count: 2,
      pageCount: 2,
    });
    downloadActiveUsersCsv.mockResolvedValue(undefined);
  });

  it('retrieves, filters, sorts, and resizes the all-active profile workspace', async () => {
    const user = userEvent.setup();
    const alice = {
      id: 'user-two', userName: 'alice@example.com', displayName: 'Alice Chen',
      name: { givenName: 'Alice', familyName: 'Chen', formatted: 'Alice Chen' },
      emails: [{ value: 'alice@example.com', type: 'work' }],
      [enterpriseSchema]: { employeeNumber: '10002', costCenter: 'CN-002', startDate: '2025-02-01' },
    };
    queryActiveUsersLocal.mockImplementation(({ filters, sortDir }: { filters: { items: Array<{ value?: string }> }; sortDir: string }) => {
      const filtered = filters.items[0]?.value === 'alice' ? [alice] : sortDir === 'desc' ? [searchResponse.Resources[0], alice] : [alice, searchResponse.Resources[0]];
      return Promise.resolve({
        users: filtered, total: filtered.length, snapshotCount: 2,
        retrievedAt: '2026-08-29T12:00:00.000Z', offset: 0, limit: 200, hasMore: false,
      });
    });
    render(<UsersView />);

    await user.click(screen.getByRole('button', { name: 'User Profiles' }));
    expect(await screen.findByText('Build the User Profiles snapshot')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retrieve All' }));

    expect(await within(screen.getByRole('table', { name: 'User Profiles' })).findByText('Alice Chen')).toBeInTheDocument();
    expect(screen.getByText(/2 local user profiles/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    expect(screen.getByRole('columnheader', { name: /First Name/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Last Name/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Cost center/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Start date/i })).not.toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize active user results and profile details' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize Name column' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Manage columns' }));
    const chooser = screen.getByRole('dialog', { name: 'Manage User Profile columns' });
    expect(within(chooser).getByLabelText(/Login ID/)).toBeDisabled();
    expect(within(chooser).getByLabelText(/Employee ID/)).toBeDisabled();
    expect(within(chooser).getByLabelText(/UUID/)).toBeEnabled();
    await user.click(within(chooser).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    await user.selectOptions(screen.getByLabelText(/Field for condition/), 'login');
    await user.selectOptions(screen.getByLabelText(/Operator for condition/), 'contains');
    await user.type(screen.getByLabelText(/Value for condition/), 'alice');
    await waitFor(() => expect(queryActiveUsersLocal).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ field: 'login', value: 'alice' })]) }) })), { timeout: 1800 });
    expect(screen.getByText(/1 matches/)).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'User Profiles' })).queryByText('Henry Gu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(screen.getByText(/0 conditions/)).toBeInTheDocument(), { timeout: 1500 });
    await user.click(screen.getByRole('button', { name: /First Name/ }));
    await waitFor(() => expect(queryActiveUsersLocal).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'firstName', sortDir: 'asc' })));
    await user.click(screen.getByRole('button', { name: /First Name/ }));
    await waitFor(() => expect(queryActiveUsersLocal).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'firstName', sortDir: 'desc' })));
    await waitFor(() => expect(screen.getAllByRole('row')[1]).toHaveTextContent('Henry Gu'));
  });

  it('shows live page, record, and percentage progress while profiles are being retrieved', async () => {
    const user = userEvent.setup();
    getActiveUsersProgress.mockResolvedValue({
      entityId: 'us-uat', state: 'running', startedAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:02.000Z',
      retrievedCount: 500, totalResults: 1200, pageCount: 5, startIndex: 401,
      itemsPerPage: 100, percent: 41,
    });
    render(<UsersView />);

    await user.click(screen.getByRole('button', { name: 'User Profiles' }));

    expect(await screen.findByText('Retrieving active profiles')).toBeInTheDocument();
    expect(screen.getByText(/500 of 1,200 profiles/)).toBeInTheDocument();
    expect(screen.getByText(/Page 5 · Start index 401 · 100 per request/)).toBeInTheDocument();
    expect(screen.getByText('41%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Active user retrieval progress' })).toHaveAttribute('aria-valuenow', '41');
  });

  it('renders only visible rows and loads the next 200-user page near the scroll boundary', async () => {
    const user = userEvent.setup();
    getActiveUsersSummary.mockResolvedValue({ entityId: 'us-uat', retrievedAt: '2026-08-29T12:00:00.000Z', count: 100000, pageCount: 1000 });
    queryActiveUsersLocal.mockImplementation(({ offset }: { offset: number }) => Promise.resolve({
      users: Array.from({ length: 200 }, (_, index) => ({ id: `user-${offset + index}`, displayName: `User ${offset + index}` })),
      total: 100000,
      snapshotCount: 100000,
      retrievedAt: '2026-08-29T12:00:00.000Z',
      offset,
      limit: 200,
      hasMore: true,
    }));
    render(<UsersView />);

    await user.click(screen.getByRole('button', { name: 'User Profiles' }));
    expect(await within(screen.getByRole('table', { name: 'User Profiles' })).findByText('User 0')).toBeInTheDocument();
    expect(screen.queryByText('User 150')).not.toBeInTheDocument();

    const scroller = screen.getByLabelText('User Profiles result list');
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 7400 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 6901 },
    });
    fireEvent.scroll(scroller);

    await waitFor(() => expect(queryActiveUsersLocal).toHaveBeenCalledWith(expect.objectContaining({ offset: 200, limit: 200 })));
    expect(screen.getByText(/100,000 local user profiles/)).toBeInTheDocument();
  });

  it('reuses loaded local rows when returning to the Identity page', async () => {
    const user = userEvent.setup();
    getActiveUsersSummary.mockResolvedValue({ entityId: 'us-uat', retrievedAt: '2026-08-29T12:00:00.000Z', count: 1, pageCount: 1 });
    queryActiveUsersLocal.mockResolvedValue({
      users: [{ id: 'cached-user', displayName: 'Cached User' }], total: 1, snapshotCount: 1,
      retrievedAt: '2026-08-29T12:00:00.000Z', offset: 0, limit: 200, hasMore: false,
    });
    const first = render(<UsersView />);
    await user.click(screen.getByRole('button', { name: 'User Profiles' }));
    expect(await within(screen.getByRole('table', { name: 'User Profiles' })).findByText('Cached User')).toBeInTheDocument();
    expect(queryActiveUsersLocal).toHaveBeenCalledTimes(1);

    first.unmount();
    render(<UsersView />);
    await user.click(screen.getByRole('button', { name: 'User Profiles' }));

    expect(await within(screen.getByRole('table', { name: 'User Profiles' })).findByText('Cached User')).toBeInTheDocument();
    expect(queryActiveUsersLocal).toHaveBeenCalledTimes(1);
  });

  it('searches by Login ID and renders the basic user profile', async () => {
    const user = userEvent.setup();
    render(<UsersView />);

    expect(screen.getByText('Search Concur users')).toBeInTheDocument();

    const searchButton = screen.getByRole('button', { name: 'Search' });
    expect(searchButton).toBeDisabled();

    const criterionSelect = screen.getByLabelText('Search criterion');
    const searchInput = screen.getByLabelText('Search user value');
    const joinedBar = criterionSelect.parentElement?.parentElement;
    expect(criterionSelect.closest('form')).toHaveClass('mb-3', 'flex', 'max-w-3xl');
    expect(joinedBar).toHaveClass('flex', 'h-10', 'w-full', 'rounded-md', 'border', 'focus-within:ring-2');
    expect(criterionSelect.parentElement).toHaveClass('relative', 'w-48', 'shrink-0', 'border-r');
    expect(criterionSelect).toHaveClass('h-full', 'w-full', 'appearance-none', 'bg-transparent', 'outline-none');
    expect(searchInput).toHaveClass('min-w-0', 'flex-1', 'bg-transparent', 'outline-none');
    expect(searchButton).toHaveClass('m-1', 'shrink-0');
    expect(searchButton).toHaveAttribute('aria-label', 'Search');

    await user.type(searchInput, ' henry.gu@bayer.com.uat ');
    await user.click(searchButton);

    await waitFor(() => expect(searchUsers).toHaveBeenCalledWith('loginId', 'henry.gu@bayer.com.uat'));
    expect(await screen.findByText('Henry Gu')).toBeInTheDocument();
    expect(screen.getByText('henry.gu@bayer.com.uat')).toBeInTheDocument();
    expect(screen.getByText('08699477')).toBeInTheDocument();
    expect(screen.getByText('HENRY.GU@BAYER.COM')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Details' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View profile for Henry Gu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View profile for henry.gu@bayer.com.uat' })).toBeInTheDocument();
  });

  it('passes the selected Employee ID criterion to the API', async () => {
    const user = userEvent.setup();
    render(<UsersView />);

    await user.selectOptions(screen.getByLabelText('Search criterion'), 'employeeId');
    await user.type(screen.getByLabelText('Search user value'), '08699477');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(searchUsers).toHaveBeenCalledWith('employeeId', '08699477'));
  });

  it('passes the selected Email criterion to the API', async () => {
    const user = userEvent.setup();
    render(<UsersView />);

    await user.selectOptions(screen.getByLabelText('Search criterion'), 'email');
    await user.type(screen.getByLabelText('Search user value'), 'HENRY.GU@BAYER.COM');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(searchUsers).toHaveBeenCalledWith('email', 'HENRY.GU@BAYER.COM'));
  });

  it('passes the selected UUID criterion to the direct profile search', async () => {
    const user = userEvent.setup();
    render(<UsersView />);

    await user.selectOptions(screen.getByLabelText('Search criterion'), 'userId');
    await user.type(screen.getByLabelText('Search user value'), '55b626dd-66a4-4722-af6d-d855ca8ded6c');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(searchUsers).toHaveBeenCalledWith('userId', '55b626dd-66a4-4722-af6d-d855ca8ded6c'));
  });

  it('uses local Identity and Spend snapshots before calling live profile APIs', async () => {
    const user = userEvent.setup();
    getSpendProfileLocalDetail.mockResolvedValue({ identity: searchResponse.Resources[0], spend: spendProfile });
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'View profile for Henry Gu' }));

    expect(await screen.findByText('Local snapshots · no Concur API call on selection')).toBeInTheDocument();
    expect(getSpendProfileLocalDetail).toHaveBeenCalledWith('55b626dd-66a4-4722-af6d-d855ca8ded6c');
    expect(getUserProfile).not.toHaveBeenCalled();
    expect(getSpendUser).not.toHaveBeenCalled();
  });

  it('loads the selected user profile into the right panel', async () => {
    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu@bayer.com.uat');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'View profile for Henry Gu' }));

    await waitFor(() => expect(getUserProfile).toHaveBeenCalledWith('55b626dd-66a4-4722-af6d-d855ca8ded6c'));
    await waitFor(() => expect(getSpendUser).toHaveBeenCalledWith('55b626dd-66a4-4722-af6d-d855ca8ded6c'));
    const panel = screen.getByLabelText('User profile details');
    expect(await within(panel).findByText('55b626dd-66a4-4722-af6d-d855ca8ded6c')).toBeInTheDocument();
    const heading = within(panel).getByRole('heading', { name: 'Henry Gu' });
    expect(heading.parentElement).toHaveClass('flex', 'items-baseline');
    expect(heading.parentElement).toHaveTextContent('55b626dd-66a4-4722-af6d-d855ca8ded6c');
    expect(within(panel).queryByText('Active')).not.toBeInTheDocument();
    const identityToggle = within(panel).getByRole('button', { name: 'Identity' });
    expect(identityToggle).toHaveAttribute('aria-expanded', 'true');
    expect(identityToggle).toHaveClass('bg-blue-50');
    expect(within(panel).getByRole('button', { name: 'Contact' })).toHaveClass('bg-emerald-50');
    expect(within(panel).getByText('America/New_York')).toBeInTheDocument();

    const enterpriseToggle = within(panel).getByRole('button', { name: 'Enterprise' });
    expect(enterpriseToggle).toHaveAttribute('aria-expanded', 'false');
    expect(enterpriseToggle).toHaveClass('bg-violet-50');
    expect(within(panel).queryByText('ff0125e2-94ba-4368-ad5d-29eceb0ef06d')).not.toBeInTheDocument();
    await user.click(enterpriseToggle);
    expect(await within(panel).findByText('ff0125e2-94ba-4368-ad5d-29eceb0ef06d')).toBeInTheDocument();

    const spendToggle = within(panel).getByRole('button', { name: 'Spend profile' });
    expect(spendToggle).toHaveAttribute('aria-expanded', 'true');
    expect(spendToggle).toHaveClass('bg-amber-50');
    expect(within(panel).getByText('CNY')).toBeInTheDocument();
    expect(within(panel).queryByText('expenseAuditRequired')).not.toBeInTheDocument();
    expect(within(panel).queryByText('REQUIRED')).not.toBeInTheDocument();

    const customDataToggle = within(panel).getByRole('button', { name: 'Custom data (2)' });
    expect(customDataToggle).toHaveAttribute('aria-expanded', 'false');
    expect(customDataToggle).toHaveClass('bg-sky-50');
    await user.click(customDataToggle);
    expect(await within(panel).findByText('custom11')).toBeInTheDocument();
    expect(within(panel).getByText('0882')).toBeInTheDocument();
    expect(within(panel).queryByText('81788dba-94f7-fb4d-bbfb-aa9bfd1f6bdf')).not.toBeInTheDocument();

    const approversToggle = within(panel).getByRole('button', { name: 'Approvers (1)' });
    expect(approversToggle).toHaveAttribute('aria-expanded', 'false');
    expect(approversToggle).toHaveClass('bg-rose-50');
    await user.click(approversToggle);
    expect(await within(panel).findByText('Primary')).toBeInTheDocument();

    const rolesToggle = within(panel).getByRole('button', { name: 'Roles (1)' });
    expect(rolesToggle).toHaveAttribute('aria-expanded', 'false');
    expect(rolesToggle).toHaveClass('bg-indigo-50');
    await user.click(rolesToggle);
    expect(await within(panel).findByText('EXP_PROCESSOR_ADMIN')).toBeInTheDocument();
    const roleGroupsToggle = within(panel).getByRole('button', { name: 'Toggle role groups for EXP_PROCESSOR_ADMIN' });
    expect(roleGroupsToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(roleGroupsToggle);
    expect(await within(panel).findByText('Bayer China')).toBeInTheDocument();

    const timezoneLabel = within(panel).getByText('Timezone');
    expect(timezoneLabel.parentElement).toHaveClass('grid', 'grid-cols-[112px_minmax(0,1fr)]', 'items-baseline');
    expect(within(panel).queryByRole('button', { name: 'Addresses' })).not.toBeInTheDocument();
    expect(within(panel).queryByText(/home:/)).not.toBeInTheDocument();

    expect(within(panel).queryByText('Preferences')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Meta')).not.toBeInTheDocument();
    expect(within(panel).queryByText('mm/dd/yyyy')).not.toBeInTheDocument();
    expect(within(panel).queryByText('2024-04-19T06:38:03.694068Z')).not.toBeInTheDocument();
  });

  it('opens the profile from the Login ID button', async () => {
    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu@bayer.com.uat');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'View profile for henry.gu@bayer.com.uat' }));

    await waitFor(() => expect(getUserProfile).toHaveBeenCalledWith('55b626dd-66a4-4722-af6d-d855ca8ded6c'));
    const panel = screen.getByLabelText('User profile details');
    expect(await within(panel).findByRole('heading', { name: 'Henry Gu' })).toBeInTheDocument();
  });

  it('restores the latest search results and selected profile after a page switch remount', async () => {
    const user = userEvent.setup();
    const first = render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu@bayer.com.uat');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'View profile for Henry Gu' }));
    expect(await within(screen.getByLabelText('User profile details')).findByRole('heading', { name: 'Henry Gu' })).toBeInTheDocument();
    expect(await within(screen.getByLabelText('User profile details')).findByText('CNY')).toBeInTheDocument();
    expect(searchUsers).toHaveBeenCalledTimes(1);
    expect(getUserProfile).toHaveBeenCalledTimes(1);
    expect(getSpendUser).toHaveBeenCalledTimes(1);

    first.unmount();
    render(<UsersView />);

    expect(screen.getByLabelText('Search user value')).toHaveValue('henry.gu@bayer.com.uat');
    const results = screen.getByRole('table', { name: 'User search results' });
    expect(within(results).getByText('Henry Gu')).toBeInTheDocument();
    expect(within(results).getByText('henry.gu@bayer.com.uat')).toBeInTheDocument();
    const panel = screen.getByLabelText('User profile details');
    expect(within(panel).getByRole('heading', { name: 'Henry Gu' })).toBeInTheDocument();
    expect(within(panel).getByText('55b626dd-66a4-4722-af6d-d855ca8ded6c')).toBeInTheDocument();
    expect(within(panel).getByText('CNY')).toBeInTheDocument();
    expect(searchUsers).toHaveBeenCalledTimes(1);
    expect(getUserProfile).toHaveBeenCalledTimes(1);
    expect(getSpendUser).toHaveBeenCalledTimes(1);
  });

  it('ignores a slower profile response once a newer user is selected', async () => {
    const userB = {
      id: 'aa10d3f4-1111-4a2b-8c3d-4e5f6a7b8c9d',
      userName: 'jane.doe@bayer.com.uat',
      displayName: 'Jane Doe',
      active: false,
      emails: [{ value: 'JANE.DOE@BAYER.COM', type: 'work', verified: true, notifications: false }],
    };
    searchUsers.mockResolvedValue({ totalResults: 2, Resources: [searchResponse.Resources[0], userB] });

    const profileA = deferred<typeof profile>();
    const profileB = deferred<typeof profile>();
    getUserProfile.mockImplementation((id: string) => (id === userB.id ? profileB.promise : profileA.promise));

    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'bayer.com.uat');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Henry Gu');

    await user.click(screen.getByRole('button', { name: 'View profile for Henry Gu' }));
    await user.click(screen.getByRole('button', { name: 'View profile for Jane Doe' }));

    const panel = screen.getByLabelText('User profile details');

    await act(async () => {
      profileB.resolve({ ...profile, id: userB.id, userName: userB.userName, displayName: 'Jane Doe' });
    });
    expect(within(panel).getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(within(panel).getByText(userB.id)).toBeInTheDocument();
    expect(within(panel).queryByText('CNY')).not.toBeInTheDocument();

    await act(async () => {
      profileA.resolve(profile);
    });
    expect(within(panel).queryByText('Henry Gu')).not.toBeInTheDocument();
    expect(within(panel).queryByText('55b626dd-66a4-4722-af6d-d855ca8ded6c')).not.toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(within(panel).getByText(userB.id)).toBeInTheDocument();
  });

  it('shows spend profile errors without hiding the identity profile', async () => {
    getSpendUser.mockRejectedValue(new Error('Forbidden: missing spend.user.general.read'));
    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu@bayer.com.uat');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'View profile for Henry Gu' }));

    const panel = screen.getByLabelText('User profile details');
    expect(await within(panel).findByRole('heading', { name: 'Henry Gu' })).toBeInTheDocument();
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Forbidden: missing spend.user.general.read');
    expect(within(panel).queryByText('CNY')).not.toBeInTheDocument();
  });

  it('shows an empty state when no users match', async () => {
    searchUsers.mockResolvedValue({ totalResults: 0, Resources: [] });
    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'missing-user');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No users found')).toBeInTheDocument();
  });

  it('shows profile errors without clearing search results', async () => {
    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu@bayer.com.uat');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Henry Gu');

    getUserProfile.mockRejectedValue(new Error('Profile scope missing'));
    await user.click(screen.getByRole('button', { name: 'View profile for Henry Gu' }));

    const panel = screen.getByLabelText('User profile details');
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Profile scope missing');
    expect(screen.getByText('henry.gu@bayer.com.uat')).toBeInTheDocument();
  });

  it('shows search API errors', async () => {
    searchUsers.mockRejectedValue(new Error('Identity scope missing'));
    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Identity scope missing');
  });
});
