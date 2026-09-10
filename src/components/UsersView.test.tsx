import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetActiveUsersWorkspaceSessions, UsersView } from './UsersView';

const { searchUsers, getUserProfile, getSpendUser, getTravelUser, refreshUserProfile, getSpendProfileLocalDetail, getActiveUsersSummary, getActiveUsersProgress, getActiveUsersBrowseProgress, getLocalActiveUsersByIds, queryActiveUsersLocal, refreshActiveUsersSnapshot, resumeActiveUsersSnapshot, restartActiveUsersSnapshot, resumeActiveUsersBrowseIndex, downloadActiveUsersCsv } = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  getUserProfile: vi.fn(),
  getSpendUser: vi.fn(),
  getTravelUser: vi.fn(),
  refreshUserProfile: vi.fn(),
  getSpendProfileLocalDetail: vi.fn(),
  getActiveUsersSummary: vi.fn(),
  getActiveUsersProgress: vi.fn(),
  getActiveUsersBrowseProgress: vi.fn(),
  getLocalActiveUsersByIds: vi.fn(),
  queryActiveUsersLocal: vi.fn(),
  refreshActiveUsersSnapshot: vi.fn(),
  resumeActiveUsersSnapshot: vi.fn(),
  restartActiveUsersSnapshot: vi.fn(),
  resumeActiveUsersBrowseIndex: vi.fn(),
  downloadActiveUsersCsv: vi.fn(),
}));

vi.mock('../api/identityApi', () => ({
  searchUsers,
  getUserProfile,
}));

vi.mock('../api/spendUserApi', () => ({
  getSpendUser,
}));

vi.mock('../api/travelUserApi', () => ({
  getTravelUser,
}));

vi.mock('../api/userProfileRefreshApi', () => ({
  refreshUserProfile,
}));

vi.mock('../api/spendProfilesApi', () => ({
  getSpendProfileLocalDetail,
}));

vi.mock('../api/activeUsersApi', () => ({
  getActiveUsersSummary,
  getActiveUsersProgress,
  getActiveUsersBrowseProgress,
  getLocalActiveUsersByIds,
  queryActiveUsersLocal,
  refreshActiveUsersSnapshot,
  resumeActiveUsersSnapshot,
  restartActiveUsersSnapshot,
  resumeActiveUsersBrowseIndex,
  downloadActiveUsersCsv,
}));

const enterpriseSchema = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const spendUserSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const spendApproverSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Approver';
const spendDelegateSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Delegate';
const spendRoleSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:Role';
const spendUserPreferenceSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:UserPreference';
const spendWorkflowPreferenceSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:WorkflowPreference';
const travelUserSchema = 'urn:ietf:params:scim:schemas:extension:travel:2.0:User';
const managerId = '1d915f4a-683f-42b0-acaa-16bfb8dc27ba';
const approverId = '9e8b3104-d799-4efb-b2a4-966a836024b7';
const delegateId = 'bc8d44d3-cc2e-49b1-8a95-ece83548b18b';

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
      [enterpriseSchema]: { employeeNumber: '08699477', companyId: 'ff0125e2-94ba-4368-ad5d-29eceb0ef06d', startDate: '2024-04-19', terminationDate: '2026-12-31' },
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
    biManager: { value: managerId },
    customData: [
      { id: 'custom11', value: '0882', syncGuid: '81788dba-94f7-fb4d-bbfb-aa9bfd1f6bdf' },
      { id: 'custom15', value: 'Y' },
    ],
  },
  [spendApproverSchema]: {
    report: [{ approver: { value: approverId }, primary: true }],
  },
  [spendDelegateSchema]: {
    expense: [{
      delegate: { value: delegateId }, canApprove: true, canPrepare: true,
      canReceiveEmail: true, canSubmit: false, canViewReceipt: true,
    }],
  },
  [spendRoleSchema]: {
    roles: [{ roleName: 'EXP_PROCESSOR_ADMIN', roleGroups: ['Global', 'Bayer China'] }],
  },
  [spendUserPreferenceSchema]: {
    expenseAuditRequired: 'REQUIRED',
  },
  [spendWorkflowPreferenceSchema]: {
    emailAwaitApprovalOnReport: true,
  },
};

const travelProfile = {
  id: '55b626dd-66a4-4722-af6d-d855ca8ded6c',
  [travelUserSchema]: {
    ruleClass: { name: 'Expense Only Employees', id: 123109 },
    name: { givenName: 'Henry', familyName: 'Gu', middleName: '' },
    manager: { value: managerId, employeeNumber: '08690000' },
    customFields: [{ name: 'Z_IsVIP' }],
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
    getTravelUser.mockReset();
    refreshUserProfile.mockReset();
    getSpendProfileLocalDetail.mockReset();
    getActiveUsersSummary.mockReset();
    getActiveUsersProgress.mockReset();
    getActiveUsersBrowseProgress.mockReset();
    getLocalActiveUsersByIds.mockReset();
    queryActiveUsersLocal.mockReset();
    refreshActiveUsersSnapshot.mockReset();
    resumeActiveUsersSnapshot.mockReset();
    restartActiveUsersSnapshot.mockReset();
    resumeActiveUsersBrowseIndex.mockReset();
    downloadActiveUsersCsv.mockReset();
    searchUsers.mockResolvedValue(searchResponse);
    getUserProfile.mockResolvedValue(profile);
    getSpendUser.mockResolvedValue(spendProfile);
    getTravelUser.mockResolvedValue(travelProfile);
    refreshUserProfile.mockResolvedValue({ identity: profile, spend: spendProfile, travel: travelProfile, errors: {}, snapshotUpdated: true, retrievedAt: '2026-09-08T08:30:00Z' });
    getSpendProfileLocalDetail.mockRejectedValue(new Error('No local record'));
    getActiveUsersSummary.mockResolvedValue(null);
    queryActiveUsersLocal.mockResolvedValue(null);
    getActiveUsersProgress.mockResolvedValue({
      entityId: 'us-uat', state: 'idle', startedAt: null, updatedAt: null,
      retrievedCount: 0, totalResults: null, pageCount: 0, startIndex: null,
      itemsPerPage: 100, percent: 0,
    });
    getActiveUsersBrowseProgress.mockResolvedValue({ state: 'missing', sourceGeneration: '', percent: 0 });
    getLocalActiveUsersByIds.mockResolvedValue({
      snapshotAvailable: true,
      generation: 'identity-1',
      users: [
        { id: managerId, userName: 'morgan.lee@example.com', displayName: 'Morgan Lee' },
        { id: approverId, userName: 'alex.chen@example.com', displayName: 'Alex Chen' },
        { id: delegateId, userName: 'jamie.wu@example.com', displayName: 'Jamie Wu' },
      ],
    });
    resumeActiveUsersBrowseIndex.mockResolvedValue({ state: 'running', sourceGeneration: 'identity-1', percent: 0 });
    refreshActiveUsersSnapshot.mockResolvedValue({
      entityId: 'us-uat', state: 'complete', startedAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z',
      retrievedCount: 2, totalResults: 2, pageCount: 2, startIndex: 101, itemsPerPage: 100, percent: 100,
    });
    downloadActiveUsersCsv.mockResolvedValue(undefined);
  });

  it('retrieves, filters, sorts, and resizes the all-active profile workspace', async () => {
    const user = userEvent.setup();
    getActiveUsersSummary.mockResolvedValueOnce(null).mockResolvedValue({ entityId: 'us-uat', retrievedAt: '2026-08-29T12:00:00.000Z', count: 2, pageCount: 2 });
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
    expect(screen.getByRole('status')).toHaveTextContent('Snapshot ready');
    expect(screen.queryByRole('progressbar', { name: 'Active user retrieval progress' })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Search filters' }));
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

    expect(await screen.findByText('Downloading profiles')).toBeInTheDocument();
    expect(screen.getByText(/500 of 1,200 profiles/)).toBeInTheDocument();
    expect(screen.getByText(/Page 5 · Start index 401 · 100 per request/)).toBeInTheDocument();
    expect(screen.getByText('41% downloaded')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Active user retrieval progress' })).toHaveAttribute('aria-valuenow', '41');
  });

  it('shows checkpointed incomplete profiles by default and disables export until commit', async () => {
    const user = userEvent.setup();
    getActiveUsersSummary.mockResolvedValue({ entityId: 'us-uat', retrievedAt: '2026-08-29T12:00:00.000Z', count: 1000, pageCount: 10 });
    getActiveUsersProgress.mockResolvedValue({
      entityId: 'us-uat', state: 'paused', startedAt: '2026-09-05T12:00:00.000Z', updatedAt: '2026-09-05T12:02:00.000Z',
      retrievedCount: 400, downloadedCount: 400, viewableCount: 300, materializedPageCount: 3,
      totalResults: 1200, pageCount: 4, startIndex: 301, itemsPerPage: 100, percent: 33,
      phase: 'downloading', phasePercent: 33, lastCheckpointAt: '2026-09-05T12:02:00.000Z',
    });
    queryActiveUsersLocal.mockResolvedValue({
      users: [searchResponse.Resources[0]], total: 300, snapshotCount: 300,
      retrievedAt: '2026-09-05T12:02:00.000Z', offset: 0, limit: 200, hasMore: true,
      complete: false, jobId: 'job-1', downloadedCount: 400, viewableCount: 300,
    });
    render(<UsersView />);

    await user.click(screen.getByRole('button', { name: 'User Profiles' }));

    expect(await screen.findByText(/Incomplete data — showing 300 searchable profiles/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Incomplete retrieval' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last complete snapshot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(queryActiveUsersLocal).toHaveBeenCalledWith(expect.objectContaining({ source: 'latest' }));

    await user.click(screen.getByRole('button', { name: 'Last complete snapshot' }));
    await waitFor(() => expect(queryActiveUsersLocal).toHaveBeenCalledWith(expect.objectContaining({ source: 'complete' })));
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  it('shows provisional rows immediately and switches to the ordered browse index when it is ready', async () => {
    const user = userEvent.setup();
    const browseReady = deferred<{ state: 'complete'; sourceGeneration: string; browseGeneration: string; percent: number }>();
    let indexReady = false;
    getActiveUsersSummary.mockResolvedValue({
      entityId: 'us-uat', retrievedAt: '2026-08-29T12:00:00.000Z', count: 364438, pageCount: 3645,
      generation: 'identity-1', browseIndexState: 'running', browseIndexPercent: 12, browseIndexPhase: 'rows',
    });
    getActiveUsersBrowseProgress.mockReturnValue(browseReady.promise);
    queryActiveUsersLocal.mockImplementation(() => Promise.resolve(indexReady ? {
        users: [{ id: 'ordered', displayName: 'Alice Ordered' }], total: 364438, snapshotCount: 364438,
        retrievedAt: '2026-08-29T12:00:00.000Z', offset: 0, limit: 200, hasMore: true,
        complete: true, sourceGeneration: 'identity-1', provisional: false, orderingReady: true,
      } : {
        users: [{ id: 'provisional', displayName: 'Shard Preview' }], total: 364438, snapshotCount: 364438,
        retrievedAt: '2026-08-29T12:00:00.000Z', offset: 0, limit: 200, hasMore: true,
        complete: true, sourceGeneration: 'identity-1', provisional: true, orderingReady: false,
      }));
    render(<UsersView />);

    await user.click(screen.getByRole('button', { name: 'User Profiles' }));

    expect((await screen.findAllByText('Shard Preview')).length).toBeGreaterThan(0);
    expect(screen.getByText('Preparing fast local browsing')).toBeInTheDocument();
    expect(screen.getByText(/immediate unsorted preview/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(within(screen.getByRole('table', { name: 'User Profiles' })).getByRole('button', { name: /^Name/ })).toBeDisabled();

    indexReady = true;
    await act(async () => browseReady.resolve({ state: 'complete', sourceGeneration: 'identity-1', browseGeneration: 'browse-1', percent: 100 }));

    expect((await screen.findAllByText('Alice Ordered')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('Preparing fast local browsing')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  it('uses Yes or No for Active conditions and date comparisons for Start Date', async () => {
    const user = userEvent.setup();
    getActiveUsersSummary.mockResolvedValue({ entityId: 'us-uat', retrievedAt: '2026-08-29T12:00:00.000Z', count: 1, pageCount: 1 });
    queryActiveUsersLocal.mockResolvedValue({
      users: [searchResponse.Resources[0]], total: 1, snapshotCount: 1,
      retrievedAt: '2026-08-29T12:00:00.000Z', offset: 0, limit: 200, hasMore: false,
    });
    render(<UsersView />);

    await user.click(screen.getByRole('button', { name: 'User Profiles' }));
    await screen.findByRole('table', { name: 'User Profiles' });
    await user.click(screen.getByRole('button', { name: 'Add condition' }));

    const field = screen.getByLabelText(/Field for condition/);
    await user.selectOptions(field, 'active');
    const activeOperator = screen.getByLabelText(/Operator for condition/) as HTMLSelectElement;
    const activeValue = screen.getByLabelText(/Value for condition/) as HTMLSelectElement;
    expect([...activeOperator.options].map((option) => [option.value, option.text])).toEqual([['eq', 'is']]);
    expect(activeValue.tagName).toBe('SELECT');
    expect([...activeValue.options].map((option) => [option.value, option.text])).toEqual([['true', 'Yes'], ['false', 'No']]);

    await user.selectOptions(field, 'startDate');
    const dateOperator = screen.getByLabelText(/Operator for condition/) as HTMLSelectElement;
    const dateValue = screen.getByLabelText(/Value for condition/) as HTMLInputElement;
    expect([...dateOperator.options].map((option) => option.value)).toEqual(['eq', 'before', 'after']);
    expect(dateValue).toHaveAttribute('type', 'date');
    await user.selectOptions(dateOperator, 'after');
    fireEvent.change(dateValue, { target: { value: '2026-01-15' } });
    await user.click(screen.getByRole('button', { name: 'Search filters' }));

    await waitFor(() => expect(queryActiveUsersLocal).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ field: 'startDate', operator: 'after', value: '2026-01-15' })]) }),
    })), { timeout: 1800 });
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

  it('keeps Login ID and Employee ID first and omits Preferred Name from User Profiles', async () => {
    const user = userEvent.setup();
    getActiveUsersSummary.mockResolvedValue({ entityId: 'us-uat', retrievedAt: '2026-08-29T12:00:00.000Z', count: 1, pageCount: 1 });
    queryActiveUsersLocal.mockResolvedValue({
      users: [searchResponse.Resources[0]], total: 1, snapshotCount: 1,
      retrievedAt: '2026-08-29T12:00:00.000Z', offset: 0, limit: 200, hasMore: false,
    });
    render(<UsersView />);

    await user.click(screen.getByRole('button', { name: 'User Profiles' }));

    const table = screen.getByRole('table', { name: 'User Profiles' });
    expect(within(table).getAllByRole('columnheader').slice(0, 2).map((header) => header.textContent)).toEqual([
      expect.stringContaining('Login ID'),
      expect.stringContaining('Employee ID'),
    ]);
    expect(within(table).queryByRole('columnheader', { name: /Preferred Name/i })).not.toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Login ID/i })).toHaveClass('z-40');
    expect(within(table).getByRole('columnheader', { name: /Employee ID/i })).toHaveClass('sticky-column-boundary');
    expect(within(table).getByRole('columnheader', { name: /Login ID/i })).not.toHaveTextContent('Required');
    expect(within(table).getByRole('columnheader', { name: /Employee ID/i })).not.toHaveTextContent('Required');

    const selectedRow = within(table).getByText('Henry Gu').closest('tr');
    expect(selectedRow).toHaveClass('bg-accent');
    const stickyCells = within(selectedRow!).getAllByRole('cell').slice(0, 2);
    stickyCells.forEach((cell) => {
      expect(cell).toHaveClass('sticky', 'z-10', 'bg-accent');
      expect(cell).not.toHaveClass('bg-primary/10');
    });
    expect(stickyCells[1]).toHaveClass('sticky-column-boundary');
  });

  it('uses the bulk snapshot loading state while opening User Profiles', async () => {
    const user = userEvent.setup();
    const initialRows = deferred<{
      users: typeof searchResponse.Resources;
      total: number;
      snapshotCount: number;
      retrievedAt: string;
      offset: number;
      limit: number;
      hasMore: boolean;
    } | null>();
    getActiveUsersSummary.mockResolvedValue({ entityId: 'us-uat', retrievedAt: '2026-08-29T12:00:00.000Z', count: 1, pageCount: 1 });
    queryActiveUsersLocal.mockReturnValue(initialRows.promise);
    render(<UsersView />);

    await user.click(screen.getByRole('button', { name: 'User Profiles' }));

    const loadingState = await screen.findByRole('status', { name: 'Loading local User Profiles snapshot' });
    expect(loadingState).toHaveTextContent('Loading local User Profiles snapshot…');
    expect(loadingState).toHaveTextContent('Checking the saved snapshot and loading the first active profiles.');

    await act(async () => initialRows.resolve(null));
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
    expect(screen.getByRole('button', { name: 'Search Users' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Travel Profiles' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Find one user' })).not.toBeInTheDocument();

    const searchButton = screen.getByRole('button', { name: 'Search' });
    expect(searchButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeDisabled();

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
    const results = screen.getByRole('table', { name: 'User search results' });
    expect(results.parentElement).toHaveClass('min-h-0', 'flex-1', 'overflow-auto');
    expect(results.querySelector('thead')).toHaveClass('sticky', 'top-0', 'z-20', 'bg-muted');
  });

  it('clears the selected profile when the search value is cleared', async () => {
    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'View profile for Henry Gu' }));
    const panel = screen.getByLabelText('User profile details');
    expect(await within(panel).findByRole('heading', { name: 'Henry Gu' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search user value'));

    expect(within(panel).getByText('No profile selected')).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { name: 'Henry Gu' })).not.toBeInTheDocument();
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

    expect(screen.queryByText('Local Identity and Spend Profile snapshots')).not.toBeInTheDocument();
    expect(getSpendProfileLocalDetail).toHaveBeenCalledWith('55b626dd-66a4-4722-af6d-d855ca8ded6c');
    expect(getUserProfile).not.toHaveBeenCalled();
    expect(getSpendUser).not.toHaveBeenCalled();
    expect(getTravelUser).not.toHaveBeenCalled();
  });

  it('refreshes a locally stored profile through the combined API endpoint', async () => {
    const user = userEvent.setup();
    getSpendProfileLocalDetail.mockResolvedValue({ identity: searchResponse.Resources[0], spend: spendProfile });
    const refreshedIdentity = { ...profile, displayName: 'Latest Henry' };
    refreshUserProfile.mockResolvedValue({ identity: refreshedIdentity, spend: spendProfile, travel: travelProfile, errors: {}, snapshotUpdated: true, retrievedAt: '2026-09-08T08:30:00Z' });
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'View profile for Henry Gu' }));
    await user.click(await screen.findByRole('button', { name: 'Refresh profile data' }));

    await waitFor(() => expect(refreshUserProfile).toHaveBeenCalledWith('55b626dd-66a4-4722-af6d-d855ca8ded6c'));
    expect(await screen.findByRole('heading', { name: 'Latest Henry' })).toBeInTheDocument();
  });

  it('keeps employee and employment dates in the profile header', async () => {
    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'View profile for Henry Gu' }));

    const panel = screen.getByLabelText('User profile details');
    const header = (await within(panel).findByRole('heading', { name: 'Henry Gu' })).closest('header');
    expect(header).not.toBeNull();
    const heading = within(header!).getByRole('heading', { name: 'Henry Gu' });
    const loginId = within(header!).getByText('Login ID');
    const employeeId = within(header!).getByText('Employee ID');
    expect(heading.compareDocumentPosition(loginId) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(loginId.compareDocumentPosition(employeeId) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(panel).getByText('2024-04-19:00:00')).toBeInTheDocument();
    expect(within(panel).getByText('2026-12-31:00:00')).toBeInTheDocument();
    expect(within(panel).getAllByText(/^\d{4}-\d{2}-\d{2}:\d{2}:\d{2}$/)).toHaveLength(3);
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
    expect(await within(panel).findAllByText('55b626dd-66a4-4722-af6d-d855ca8ded6c')).not.toHaveLength(0);
    const heading = within(panel).getByRole('heading', { name: 'Henry Gu' });
    expect(heading.closest('header')).toHaveClass('bg-muted/20');
    expect(heading.closest('header')?.querySelector('time[datetime="2026-07-30T23:08:09.610008528Z"]')).toBeInTheDocument();
    expect(heading.closest('header')).toHaveTextContent('Last modified');
    expect(heading.closest('header')).toHaveTextContent('USER UUID');
    expect(within(panel).getByText('Profile loaded')).toBeInTheDocument();
    expect(within(panel).queryByText('Active')).not.toBeInTheDocument();
    const identityToggle = within(panel).getByRole('button', { name: 'Identity' });
    expect(identityToggle).toHaveAttribute('aria-expanded', 'false');
    expect(identityToggle).toHaveClass('bg-muted/20', 'text-foreground');
    expect(within(panel).queryByRole('button', { name: 'Contact' })).not.toBeInTheDocument();
    await user.click(identityToggle);
    expect(within(panel).getByRole('table', { name: 'Identity schema fields' })).toBeInTheDocument();
    expect(within(panel).getByText('Active')).toBeInTheDocument();
    expect(within(panel).getByText('America/New_York')).toBeInTheDocument();
    const nameGroup = within(panel).getByRole('button', { name: 'Name' });
    const emailGroup = within(panel).getByRole('button', { name: 'Email 1' });
    expect(nameGroup).toHaveAttribute('aria-expanded', 'false');
    expect(emailGroup).toHaveAttribute('aria-expanded', 'false');
    await user.click(nameGroup);
    expect(within(panel).getByRole('table', { name: 'Name fields' })).toBeInTheDocument();
    await user.click(emailGroup);
    expect(within(panel).getByRole('table', { name: 'Email 1 fields' })).toBeInTheDocument();

    const enterpriseToggle = within(panel).getByRole('button', { name: 'Enterprise' });
    expect(enterpriseToggle).toHaveAttribute('aria-expanded', 'false');
    expect(enterpriseToggle).toHaveClass('bg-muted/20', 'text-foreground');
    expect(within(panel).queryByText('ff0125e2-94ba-4368-ad5d-29eceb0ef06d')).not.toBeInTheDocument();
    await user.click(enterpriseToggle);
    expect(await within(panel).findByText('ff0125e2-94ba-4368-ad5d-29eceb0ef06d')).toBeInTheDocument();
    expect(within(enterpriseToggle.closest('section')!).queryByText('Employee ID')).not.toBeInTheDocument();
    expect(within(enterpriseToggle.closest('section')!).queryByText('Start date')).not.toBeInTheDocument();

    const spendProfileToggle = within(panel).getByRole('button', { name: 'Spend profile' });
    expect(spendProfileToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(spendProfileToggle);
    const spendToggle = within(panel).getByRole('button', { name: 'Spend user' });
    expect(spendToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(spendToggle);
    expect(within(panel).getByText('CNY')).toBeInTheDocument();
    expect((await within(panel).findAllByText('Morgan Lee')).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('morgan.lee@example.com')).not.toHaveLength(0);
    expect(within(panel).getAllByText(managerId)).not.toHaveLength(0);
    expect(within(panel).queryByText('expenseAuditRequired')).not.toBeInTheDocument();
    expect(within(panel).queryByText('REQUIRED')).not.toBeInTheDocument();

    const customDataToggle = within(panel).getByRole('button', { name: 'Spend custom data (2)' });
    expect(customDataToggle).toHaveAttribute('aria-expanded', 'false');
    expect(customDataToggle).toHaveClass('bg-muted/20', 'text-foreground');
    await user.click(customDataToggle);
    expect(await within(panel).findByText('custom11')).toBeInTheDocument();
    expect(within(panel).getByText('0882')).toBeInTheDocument();
    expect(within(panel).getByRole('table', { name: 'Spend custom data fields' })).toBeInTheDocument();
    expect(within(panel).queryByText('81788dba-94f7-fb4d-bbfb-aa9bfd1f6bdf')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Spend resource' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Spend metadata' })).not.toBeInTheDocument();

    const approversToggle = within(panel).getByRole('button', { name: 'Approvers (1)' });
    expect(approversToggle).toHaveAttribute('aria-expanded', 'false');
    expect(approversToggle).toHaveClass('bg-muted/20', 'text-foreground');
    await user.click(approversToggle);
    expect(await within(panel).findByText('Primary')).toBeInTheDocument();
    expect(await within(panel).findByText('Alex Chen')).toBeInTheDocument();
    expect(within(panel).getByText('alex.chen@example.com')).toBeInTheDocument();
    expect(within(panel).getByText(approverId)).toBeInTheDocument();

    const delegatesToggle = within(panel).getByRole('button', { name: 'Delegates (1)' });
    expect(delegatesToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(delegatesToggle);
    expect(await within(panel).findByText('Jamie Wu')).toBeInTheDocument();
    expect(within(panel).getByText('jamie.wu@example.com')).toBeInTheDocument();
    expect(within(panel).getByText(delegateId)).toBeInTheDocument();
    expect(within(panel).getByText('Can approve')).toBeInTheDocument();
    expect(within(panel).getByText('Can prepare')).toBeInTheDocument();
    expect(within(panel).getByText('Can receive email')).toBeInTheDocument();
    expect(within(panel).getByText('Can view receipt')).toBeInTheDocument();
    expect(within(panel).queryByText('Can submit')).not.toBeInTheDocument();

    const rolesToggle = within(panel).getByRole('button', { name: 'Roles (1)' });
    expect(rolesToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(rolesToggle);
    expect(await within(panel).findByText('EXP_PROCESSOR_ADMIN')).toBeInTheDocument();
    const roleGroupsToggle = within(panel).getByRole('button', { name: 'Expand groups for EXP_PROCESSOR_ADMIN' });
    expect(roleGroupsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(panel).queryByText('Bayer China')).not.toBeInTheDocument();
    await user.click(roleGroupsToggle);
    expect(await within(panel).findByText('Bayer China')).toBeInTheDocument();
    expect(within(panel).getByText('Global')).toBeInTheDocument();

    const addressGroup = within(panel).getByRole('button', { name: 'Address 1' });
    const localeGroup = within(panel).getByRole('button', { name: 'Locale overrides' });
    expect(addressGroup).toHaveAttribute('aria-expanded', 'false');
    expect(localeGroup).toHaveAttribute('aria-expanded', 'false');
    expect(within(panel).queryByText('mm/dd/yyyy')).not.toBeInTheDocument();
    await user.click(localeGroup);
    expect(within(panel).getByText('mm/dd/yyyy')).toBeInTheDocument();
    expect(within(panel).queryByText('2024-04-19T06:38:03.694068Z')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Spend user preference' }));
    expect(within(panel).getByRole('table', { name: 'Spend user preference fields' })).toBeInTheDocument();
    expect(within(panel).getByText('REQUIRED')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Spend workflow preference' }));
    expect(within(panel).getByText('Email await approval on report')).toBeInTheDocument();
    expect(within(panel).queryByText(/[{}]/)).not.toBeInTheDocument();
  });

  it('falls back to the Identity API when referenced users are absent from the local snapshot', async () => {
    getLocalActiveUsersByIds.mockResolvedValue({ snapshotAvailable: true, generation: 'identity-1', users: [] });
    getUserProfile.mockImplementation((id: string) => {
      if (id === managerId) return Promise.resolve({ id, userName: 'live.manager@example.com', displayName: 'Live Manager' });
      if (id === approverId) return Promise.resolve({ id, userName: 'live.approver@example.com', displayName: 'Live Approver' });
      if (id === delegateId) return Promise.resolve({ id, userName: 'live.delegate@example.com', displayName: 'Live Delegate' });
      return Promise.resolve(profile);
    });
    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu@bayer.com.uat');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'View profile for Henry Gu' }));

    const panel = screen.getByLabelText('User profile details');
    await user.click(within(panel).getByRole('button', { name: 'Spend profile' }));
    await user.click(within(panel).getByRole('button', { name: 'Spend user' }));
    expect((await within(panel).findAllByText('Live Manager')).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('live.manager@example.com')).not.toHaveLength(0);
    expect(within(panel).getAllByText(managerId)).not.toHaveLength(0);
    await user.click(within(panel).getByRole('button', { name: 'Approvers (1)' }));
    expect(await within(panel).findByText('Live Approver')).toBeInTheDocument();
    expect(within(panel).getByText('live.approver@example.com')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Delegates (1)' }));
    expect(await within(panel).findByText('Live Delegate')).toBeInTheDocument();
    expect(within(panel).getByText('live.delegate@example.com')).toBeInTheDocument();
    expect(within(panel).getAllByText('Resolved from Identity API')).toHaveLength(3);
    expect(getUserProfile).toHaveBeenCalledWith(managerId);
    expect(getUserProfile).toHaveBeenCalledWith(approverId);
    expect(getUserProfile).toHaveBeenCalledWith(delegateId);
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
    await user.click(within(screen.getByLabelText('User profile details')).getByRole('button', { name: 'Spend profile' }));
    await user.click(within(screen.getByLabelText('User profile details')).getByRole('button', { name: 'Spend user' }));
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
    expect(within(panel).getAllByText('55b626dd-66a4-4722-af6d-d855ca8ded6c')).not.toHaveLength(0);
    await user.click(within(panel).getByRole('button', { name: 'Spend profile' }));
    await user.click(within(panel).getByRole('button', { name: 'Spend user' }));
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
      profileB.resolve({ ...profile, id: userB.id, userName: userB.userName, displayName: 'Jane Doe', name: { givenName: 'Jane', familyName: 'Doe', formatted: 'Jane Doe' } });
    });
    expect(within(panel).getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(within(panel).getAllByText(userB.id)).not.toHaveLength(0);
    expect(within(panel).queryByText('CNY')).not.toBeInTheDocument();

    await act(async () => {
      profileA.resolve(profile);
    });
    expect(within(panel).queryByText('Henry Gu')).not.toBeInTheDocument();
    expect(within(panel).queryByText('55b626dd-66a4-4722-af6d-d855ca8ded6c')).not.toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(within(panel).getAllByText(userB.id)).not.toHaveLength(0);
  });

  it('shows spend profile errors without hiding the identity profile', async () => {
    getSpendUser.mockRejectedValue(new Error('Forbidden: missing spend.user.general.read'));
    getTravelUser.mockResolvedValue(travelProfile);
    const user = userEvent.setup();
    render(<UsersView />);

    await user.type(screen.getByLabelText('Search user value'), 'henry.gu@bayer.com.uat');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'View profile for Henry Gu' }));

    const panel = screen.getByLabelText('User profile details');
    expect(await within(panel).findByRole('heading', { name: 'Henry Gu' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Spend profile' }));
    const alerts = await within(panel).findAllByRole('alert');
    expect(alerts.some((node) => node.textContent?.includes('Forbidden: missing spend.user.general.read'))).toBe(true);
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
