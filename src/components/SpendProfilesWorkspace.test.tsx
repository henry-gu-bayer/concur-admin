import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpendProfilesWorkspaceSessions, SpendProfilesWorkspace, TravelProfilesWorkspace } from './SpendProfilesWorkspace';

const { getSpendProfilesSummary, getSpendProfilesProgress, getSpendProfilesBrowseProgress, querySpendProfilesLocal, getSpendProfileLocalDetail, refreshUserProfile, refreshSpendProfilesSnapshot, resumeSpendProfilesSnapshot, restartSpendProfilesSnapshot, resumeSpendProfilesBrowseIndex, downloadSpendProfilesCsv } = vi.hoisted(() => ({
  getSpendProfilesSummary: vi.fn(),
  getSpendProfilesProgress: vi.fn(),
  getSpendProfilesBrowseProgress: vi.fn(),
  querySpendProfilesLocal: vi.fn(),
  getSpendProfileLocalDetail: vi.fn(),
  refreshUserProfile: vi.fn(),
  refreshSpendProfilesSnapshot: vi.fn(),
  resumeSpendProfilesSnapshot: vi.fn(),
  restartSpendProfilesSnapshot: vi.fn(),
  resumeSpendProfilesBrowseIndex: vi.fn(),
  downloadSpendProfilesCsv: vi.fn(),
}));
const { getTravelProfilesSummary, getTravelProfilesProgress, getTravelProfilesBrowseProgress, queryTravelProfilesLocal, getTravelProfileLocalDetail, refreshTravelProfilesSnapshot, resumeTravelProfilesSnapshot, restartTravelProfilesSnapshot, resumeTravelProfilesBrowseIndex, downloadTravelProfilesCsv } = vi.hoisted(() => ({
  getTravelProfilesSummary: vi.fn(), getTravelProfilesProgress: vi.fn(), getTravelProfilesBrowseProgress: vi.fn(), queryTravelProfilesLocal: vi.fn(), getTravelProfileLocalDetail: vi.fn(),
  refreshTravelProfilesSnapshot: vi.fn(), resumeTravelProfilesSnapshot: vi.fn(), restartTravelProfilesSnapshot: vi.fn(), resumeTravelProfilesBrowseIndex: vi.fn(), downloadTravelProfilesCsv: vi.fn(),
}));

vi.mock('../api/spendProfilesApi', () => ({
  getSpendProfilesSummary,
  getSpendProfilesProgress,
  getSpendProfilesBrowseProgress,
  querySpendProfilesLocal,
  getSpendProfileLocalDetail,
  refreshSpendProfilesSnapshot,
  resumeSpendProfilesSnapshot,
  restartSpendProfilesSnapshot,
  resumeSpendProfilesBrowseIndex,
  downloadSpendProfilesCsv,
}));

vi.mock('../api/userProfileRefreshApi', () => ({ refreshUserProfile }));
vi.mock('../api/travelProfilesApi', () => ({
  getTravelProfilesSummary, getTravelProfilesProgress, getTravelProfilesBrowseProgress, queryTravelProfilesLocal, getTravelProfileLocalDetail,
  refreshTravelProfilesSnapshot, resumeTravelProfilesSnapshot, restartTravelProfilesSnapshot, resumeTravelProfilesBrowseIndex, downloadTravelProfilesCsv,
}));

const spendSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const enterpriseSchema = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const identitySummary = { entityId: 'us-uat', retrievedAt: '2026-08-29T00:00:00Z', count: 100598, pageCount: 1006 };
const summary = { entityId: 'us-uat', retrievedAt: '2026-08-30T00:00:00Z', count: 94732, pageCount: 948, identityCount: 100598, spendFields: ['country', 'reimbursementCurrency', 'approverLoginId', 'approverCompanyCode', 'approverDifferentCompanyCode'], customFields: ['custom19', 'custom21'] };
const progress = { entityId: 'us-uat', state: 'complete', startedAt: '2026-08-30T00:00:00Z', updatedAt: '2026-08-30T00:18:42Z', retrievedCount: 94732, totalResults: 94732, pageCount: 948, startIndex: 94701, itemsPerPage: 100, percent: 100, elapsedMs: 1122000 };
const row = { id: 'user-one', loginId: 'sofia@example.com', employeeNumber: '10001', email: 'sofia@example.com', preferredName: 'Sofia Martins', values: { id: 'user-one', active: 'true', loginId: 'sofia@example.com', employeeNumber: '10001', email: 'sofia@example.com', preferredName: 'Sofia Martins', country: 'PT', reimbursementCurrency: 'EUR', approverLoginId: 'alex@example.com', approverCompanyCode: '2000', approverDifferentCompanyCode: 'true', custom19: '1344', custom21: 'Bayer Portugal' } };

beforeEach(() => {
  resetSpendProfilesWorkspaceSessions();
  vi.clearAllMocks();
  getSpendProfilesSummary.mockResolvedValue({ summary, identitySummary });
  getSpendProfilesProgress.mockResolvedValue(progress);
  getSpendProfilesBrowseProgress.mockResolvedValue({ state: 'complete', sourceGeneration: 'spend-1', browseGeneration: 'browse-1', phase: 'complete', percent: 100 });
  querySpendProfilesLocal.mockResolvedValue({ rows: [row], total: 1, snapshotCount: 94732, retrievedAt: summary.retrievedAt, offset: 0, limit: 200, hasMore: false });
  getSpendProfileLocalDetail.mockResolvedValue({
    identity: { id: 'user-one', userName: 'sofia@example.com', preferredName: 'Sofia Martins', emails: [{ value: 'sofia@example.com', type: 'work' }], [enterpriseSchema]: { employeeNumber: '10001' } },
    spend: { id: 'user-one', [spendSchema]: { country: 'PT', reimbursementCurrency: 'EUR', customData: [{ id: 'custom19', value: '1344' }] } },
  });
  refreshUserProfile.mockResolvedValue({ identity: { id: 'user-one', userName: 'sofia@example.com', preferredName: 'Sofia Martins' }, spend: { id: 'user-one' }, travel: { id: 'user-one' }, errors: {}, snapshotUpdated: true, retrievedAt: '2026-09-08T08:30:00Z' });
  refreshSpendProfilesSnapshot.mockResolvedValue(progress);
  downloadSpendProfilesCsv.mockResolvedValue(undefined);
  resumeSpendProfilesBrowseIndex.mockResolvedValue({ state: 'running', sourceGeneration: 'spend-1', phase: 'rows', percent: 20 });
  getTravelProfilesSummary.mockResolvedValue({ summary: { ...summary, travelFields: undefined, spendFields: ['ruleClass', 'eReceiptOptIn'] }, identitySummary });
  getTravelProfilesProgress.mockResolvedValue({ ...progress, travelFields: ['ruleClass', 'eReceiptOptIn'] });
  getTravelProfilesBrowseProgress.mockResolvedValue({ state: 'complete', sourceGeneration: 'travel-1', phase: 'complete', percent: 100 });
  queryTravelProfilesLocal.mockResolvedValue({ rows: [row], total: 1, snapshotCount: 94732, retrievedAt: summary.retrievedAt, offset: 0, limit: 200, hasMore: false });
  getTravelProfileLocalDetail.mockResolvedValue({ identity: { id: 'user-one', userName: 'sofia@example.com', preferredName: 'Sofia Martins', [enterpriseSchema]: { employeeNumber: '10001' } }, spend: null, travel: { id: 'user-one', [spendSchema]: { eReceiptOptIn: true } } });
  refreshTravelProfilesSnapshot.mockResolvedValue(progress);
  resumeTravelProfilesSnapshot.mockResolvedValue(progress);
  restartTravelProfilesSnapshot.mockResolvedValue(progress);
  resumeTravelProfilesBrowseIndex.mockResolvedValue({ state: 'complete', sourceGeneration: 'travel-1', phase: 'complete', percent: 100 });
  downloadTravelProfilesCsv.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('SpendProfilesWorkspace', () => {
  it.each([
    ['Spend Profile', SpendProfilesWorkspace],
    ['Travel Profile', TravelProfilesWorkspace],
  ])('shows a loading state while the local %s snapshot is opening', async (profileName, Workspace) => {
    if (profileName === 'Spend Profile') getSpendProfilesSummary.mockReturnValue(new Promise(() => undefined));
    else getTravelProfilesSummary.mockReturnValue(new Promise(() => undefined));

    render(<Workspace entityId="us-uat" />);

    const loadingState = await screen.findByRole('status', { name: `Loading local ${profileName} snapshot` });
    expect(loadingState).toHaveTextContent(`Loading local ${profileName} snapshot…`);
    expect(loadingState).toHaveTextContent('Checking the saved snapshot and loading the first active profiles.');
  });

  it('requires the local All Active Users snapshot before retrieval', async () => {
    getSpendProfilesSummary.mockResolvedValue({ summary: null, identitySummary: null });
    getSpendProfilesProgress.mockResolvedValue({ ...progress, state: 'idle', retrievedCount: 0, totalResults: null, pageCount: 0, percent: 0, elapsedMs: 0 });
    render(<SpendProfilesWorkspace entityId="us-uat" />);

    expect(await screen.findByRole('heading', { name: 'User Profiles snapshot required' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retrieve All' })).toBeDisabled();
  });

  it('uses the Spend Profile workspace pattern for Travel Profiles', async () => {
    const user = userEvent.setup();
    render(<TravelProfilesWorkspace entityId="us-uat" />);

    const table = await screen.findByRole('table', { name: 'Travel Profiles' });
    expect(screen.getByText('Search criteria:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retrieve All' })).toBeEnabled();
    await user.click((await within(table).findAllByText('sofia@example.com'))[0]);
    const details = await screen.findByLabelText('Local Travel Profile details');
    expect(within(details).getByRole('button', { name: 'Travel profile' })).toBeInTheDocument();
    expect(within(details).queryByRole('button', { name: 'Spend profile' })).not.toBeInTheDocument();
  });

  it('renders frozen columns, elapsed progress, and local-only detail', async () => {
    const user = userEvent.setup();
    render(<SpendProfilesWorkspace entityId="us-uat" />);

    const table = await screen.findByRole('table', { name: 'Spend Profiles' });
    expect(await within(table).findByRole('columnheader', { name: /^Login ID/ })).not.toHaveTextContent('Required');
    expect(within(table).getByRole('columnheader', { name: /Employee ID/ })).not.toHaveTextContent('Required');
    expect(within(table).getByRole('columnheader', { name: /Employee ID/ })).toHaveClass('sticky-column-boundary');
    expect(screen.getByRole('status')).toHaveTextContent('Snapshot ready');
    expect(screen.getByRole('button', { name: 'Active users' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Inactive users' }));
    await waitFor(() => expect(querySpendProfilesLocal).toHaveBeenLastCalledWith(expect.objectContaining({ filters: expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ field: 'active', value: 'false' })]) }) })));
    expect(screen.queryByRole('progressbar', { name: 'Spend Profile retrieval progress' })).not.toBeInTheDocument();
    expect(await screen.findAllByText('Sofia Martins')).not.toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Manage columns' }));
    const dialog = screen.getByRole('dialog', { name: 'Manage Spend Profile columns' });
    expect(within(dialog).getByLabelText(/^Login ID$/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/Employee ID/)).toBeDisabled();
    expect(within(dialog).getAllByRole('checkbox')[0]).toBeEnabled();

    const selectedRow = within(table).getAllByText('sofia@example.com')[0].closest('tr');
    await user.click(within(table).getAllByText('sofia@example.com')[0]);
    await waitFor(() => expect(getSpendProfileLocalDetail).toHaveBeenCalledWith('user-one', 'latest'));
    expect(selectedRow).toHaveClass('bg-primary/10');
    within(selectedRow!).getAllByRole('cell').slice(0, 2).forEach((cell) => expect(cell).toHaveClass('bg-primary/10'));
    const detailPanel = screen.getByLabelText('Local Spend Profile details');
    expect(within(detailPanel).queryByText('Local Identity and Spend Profile snapshots')).not.toBeInTheDocument();
    expect(within(detailPanel).getByText('Profile details')).toHaveClass('text-primary');
    expect(within(detailPanel).getByText('USER UUID')).toBeInTheDocument();
    expect(within(detailPanel).getByRole('button', { name: 'Identity profile' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(detailPanel).getByRole('button', { name: 'Enterprise profile' })).toHaveClass('bg-muted/20', 'text-foreground');
    expect(within(detailPanel).getByRole('button', { name: 'Spend profile' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(detailPanel).getByRole('button', { name: 'Travel profile' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('refreshes the selected Spend Profile detail through the live profile endpoint', async () => {
    const user = userEvent.setup();
    render(<SpendProfilesWorkspace entityId="us-uat" />);
    const table = await screen.findByRole('table', { name: 'Spend Profiles' });

    await user.click(within(table).getAllByText('sofia@example.com')[0]);
    await user.click(await screen.findByRole('button', { name: 'Refresh profile data' }));

    await waitFor(() => expect(refreshUserProfile).toHaveBeenCalledWith('user-one'));
  });

  it('hides orphan Spend Profiles by default and can include them explicitly', async () => {
    const user = userEvent.setup();
    render(<SpendProfilesWorkspace entityId="us-uat" />);
    await screen.findByRole('table', { name: 'Spend Profiles' });

    expect(querySpendProfilesLocal).toHaveBeenCalledWith(expect.objectContaining({ includeOrphans: false }));
    await user.click(screen.getByLabelText('Show profiles without User Profile'));
    await waitFor(() => expect(querySpendProfilesLocal).toHaveBeenCalledWith(expect.objectContaining({ includeOrphans: true })));
  });

  it('browses incomplete Spend checkpoints and keeps partial export disabled', async () => {
    const user = userEvent.setup();
    getSpendProfilesProgress.mockResolvedValue({
      ...progress, state: 'paused', retrievedCount: 400, downloadedCount: 400, viewableCount: 300,
      totalResults: 1200, pageCount: 4, percent: 33, phase: 'downloading', phasePercent: 33,
      materializedPageCount: 3, lastCheckpointAt: '2026-09-05T12:02:00.000Z',
    });
    querySpendProfilesLocal.mockResolvedValue({
      rows: [row], total: 300, snapshotCount: 300, retrievedAt: '2026-09-05T12:02:00.000Z',
      offset: 0, limit: 200, hasMore: true, complete: false, jobId: 'job-1', downloadedCount: 400, viewableCount: 300,
    });
    render(<SpendProfilesWorkspace entityId="us-uat" />);

    expect(await screen.findByText(/Incomplete data — showing 300 searchable profiles/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Incomplete retrieval' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last complete snapshot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(querySpendProfilesLocal).toHaveBeenCalledWith(expect.objectContaining({ source: 'latest' }));

    await user.click(screen.getByRole('button', { name: 'Last complete snapshot' }));
    await waitFor(() => expect(querySpendProfilesLocal).toHaveBeenCalledWith(expect.objectContaining({ source: 'complete' })));
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  it('shows snapshot readiness after Retrieve All completes', async () => {
    const user = userEvent.setup();
    getSpendProfilesProgress.mockResolvedValueOnce({ ...progress, percent: 99 }).mockResolvedValue(progress);
    render(<SpendProfilesWorkspace entityId="us-uat" />);
    await screen.findByRole('table', { name: 'Spend Profiles' });

    await user.click(screen.getByRole('button', { name: 'Retrieve All' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Snapshot ready'));
    expect(screen.queryByRole('progressbar', { name: 'Spend Profile retrieval progress' })).not.toBeInTheDocument();
    expect(getSpendProfilesProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('shows provisional rows while indexing and refreshes to stable ordering without replacing the selected detail', async () => {
    getSpendProfilesSummary.mockResolvedValue({ summary: { ...summary, generation: 'spend-1', browseIndexState: 'running', browseIndexPercent: 25, browseIndexPhase: 'rows' }, identitySummary });
    querySpendProfilesLocal
      .mockResolvedValueOnce({ rows: [row], total: 94732, snapshotCount: 94732, retrievedAt: summary.retrievedAt, offset: 0, limit: 200, hasMore: false, provisional: true, orderingReady: false })
      .mockResolvedValue({ rows: [row], total: 94732, snapshotCount: 94732, retrievedAt: summary.retrievedAt, offset: 0, limit: 200, hasMore: true, provisional: false, orderingReady: true });
    render(<SpendProfilesWorkspace entityId="us-uat" />);

    expect(await screen.findByText(/Optimizing the local browse index/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(screen.getByLabelText('Show profiles without User Profile')).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: 'Spend Profile browse index progress' })).toHaveAttribute('aria-valuenow', '25');

    await waitFor(() => expect(getSpendProfilesBrowseProgress).toHaveBeenCalled(), { timeout: 2500 });
    await waitFor(() => expect(screen.queryByText(/Optimizing the local browse index/)).not.toBeInTheDocument());
    expect(querySpendProfilesLocal.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getSpendProfileLocalDetail).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  it('builds Country = PT AND (custom19 = 1344 OR custom19 = 0913)', async () => {
    const user = userEvent.setup();
    render(<SpendProfilesWorkspace entityId="us-uat" />);
    await screen.findByRole('table', { name: 'Spend Profiles' });

    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    await user.click(screen.getByRole('button', { name: 'Add group' }));
    expect(screen.getByText('Search criteria:')).toBeInTheDocument();
    const fields = screen.getAllByLabelText(/Field for condition/);
    const values = screen.getAllByLabelText(/Value for condition/);
    await user.selectOptions(fields[0], 'country');
    await user.type(values[0], 'PT');
    await user.selectOptions(fields[1], 'custom19');
    await user.type(values[1], '1344');
    await user.selectOptions(fields[2], 'custom19');
    await user.type(values[2], '0913');

    expect(await screen.findByText('COUNTRY = "PT" AND (CUSTOM19 = "1344" OR CUSTOM19 = "0913")', {}, { timeout: 1500 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search filters' }));
    await waitFor(() => expect(querySpendProfilesLocal).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({ logic: 'and', items: expect.arrayContaining([
        expect.objectContaining({ field: 'country', value: 'PT' }),
        expect.objectContaining({ kind: 'group', logic: 'or', items: expect.arrayContaining([
          expect.objectContaining({ field: 'custom19', value: '1344' }),
          expect.objectContaining({ field: 'custom19', value: '0913' }),
        ]) }),
      ]) }),
    })), { timeout: 1800 });
  });
});
