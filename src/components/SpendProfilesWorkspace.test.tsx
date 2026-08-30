import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpendProfilesWorkspaceSessions, SpendProfilesWorkspace } from './SpendProfilesWorkspace';

const { getSpendProfilesSummary, getSpendProfilesProgress, querySpendProfilesLocal, getSpendProfileLocalDetail, refreshSpendProfilesSnapshot, downloadSpendProfilesCsv } = vi.hoisted(() => ({
  getSpendProfilesSummary: vi.fn(),
  getSpendProfilesProgress: vi.fn(),
  querySpendProfilesLocal: vi.fn(),
  getSpendProfileLocalDetail: vi.fn(),
  refreshSpendProfilesSnapshot: vi.fn(),
  downloadSpendProfilesCsv: vi.fn(),
}));

vi.mock('../api/spendProfilesApi', () => ({
  getSpendProfilesSummary,
  getSpendProfilesProgress,
  querySpendProfilesLocal,
  getSpendProfileLocalDetail,
  refreshSpendProfilesSnapshot,
  downloadSpendProfilesCsv,
}));

const spendSchema = 'urn:ietf:params:scim:schemas:extension:spend:2.0:User';
const enterpriseSchema = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const identitySummary = { entityId: 'us-uat', retrievedAt: '2026-08-29T00:00:00Z', count: 100598, pageCount: 1006 };
const summary = { entityId: 'us-uat', retrievedAt: '2026-08-30T00:00:00Z', count: 94732, pageCount: 948, identityCount: 100598, spendFields: ['country', 'reimbursementCurrency'], customFields: ['custom19', 'custom21'] };
const progress = { entityId: 'us-uat', state: 'complete', startedAt: '2026-08-30T00:00:00Z', updatedAt: '2026-08-30T00:18:42Z', retrievedCount: 94732, totalResults: 94732, pageCount: 948, startIndex: 94701, itemsPerPage: 100, percent: 100, elapsedMs: 1122000 };
const row = { id: 'user-one', loginId: 'sofia@example.com', employeeNumber: '10001', email: 'sofia@example.com', preferredName: 'Sofia Martins', values: { id: 'user-one', loginId: 'sofia@example.com', employeeNumber: '10001', email: 'sofia@example.com', preferredName: 'Sofia Martins', country: 'PT', reimbursementCurrency: 'EUR', custom19: '1344', custom21: 'Bayer Portugal' } };

beforeEach(() => {
  resetSpendProfilesWorkspaceSessions();
  vi.clearAllMocks();
  getSpendProfilesSummary.mockResolvedValue({ summary, identitySummary });
  getSpendProfilesProgress.mockResolvedValue(progress);
  querySpendProfilesLocal.mockResolvedValue({ rows: [row], total: 1, snapshotCount: 94732, retrievedAt: summary.retrievedAt, offset: 0, limit: 200, hasMore: false });
  getSpendProfileLocalDetail.mockResolvedValue({
    identity: { id: 'user-one', userName: 'sofia@example.com', preferredName: 'Sofia Martins', emails: [{ value: 'sofia@example.com', type: 'work' }], [enterpriseSchema]: { employeeNumber: '10001' } },
    spend: { id: 'user-one', [spendSchema]: { country: 'PT', reimbursementCurrency: 'EUR', customData: [{ id: 'custom19', value: '1344' }] } },
  });
  refreshSpendProfilesSnapshot.mockResolvedValue(summary);
  downloadSpendProfilesCsv.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('SpendProfilesWorkspace', () => {
  it('requires the local All Active Users snapshot before retrieval', async () => {
    getSpendProfilesSummary.mockResolvedValue({ summary: null, identitySummary: null });
    getSpendProfilesProgress.mockResolvedValue({ ...progress, state: 'idle', retrievedCount: 0, totalResults: null, pageCount: 0, percent: 0, elapsedMs: 0 });
    render(<SpendProfilesWorkspace entityId="us-uat" />);

    expect(await screen.findByRole('heading', { name: 'User Profiles snapshot required' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retrieve All' })).toBeDisabled();
  });

  it('renders frozen columns, elapsed progress, and local-only detail', async () => {
    const user = userEvent.setup();
    render(<SpendProfilesWorkspace entityId="us-uat" />);

    const table = await screen.findByRole('table', { name: 'Spend Profiles' });
    expect(within(table).getByRole('columnheader', { name: /Login ID/ })).not.toHaveTextContent('Required');
    expect(within(table).getByRole('columnheader', { name: /Employee ID/ })).not.toHaveTextContent('Required');
    expect(screen.getByRole('status')).toHaveTextContent('Snapshot ready');
    expect(screen.queryByRole('progressbar', { name: 'Spend Profile retrieval progress' })).not.toBeInTheDocument();
    expect(await screen.findAllByText('Sofia Martins')).not.toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Manage columns' }));
    const dialog = screen.getByRole('dialog', { name: 'Manage Spend Profile columns' });
    expect(within(dialog).getByLabelText(/Login ID/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/Employee ID/)).toBeDisabled();
    expect(within(dialog).getAllByRole('checkbox')[0]).toBeEnabled();

    const selectedRow = within(table).getAllByText('sofia@example.com')[0].closest('tr');
    await user.click(within(table).getAllByText('sofia@example.com')[0]);
    await waitFor(() => expect(getSpendProfileLocalDetail).toHaveBeenCalledWith('user-one'));
    expect(selectedRow).toHaveClass('bg-primary/10');
    within(selectedRow!).getAllByRole('cell').slice(0, 2).forEach((cell) => expect(cell).toHaveClass('bg-primary/10'));
    expect(await within(screen.getByLabelText('Local Spend Profile details')).findByText('Local snapshots · no Concur API call on selection')).toBeInTheDocument();
  });

  it('hides orphan Spend Profiles by default and can include them explicitly', async () => {
    const user = userEvent.setup();
    render(<SpendProfilesWorkspace entityId="us-uat" />);
    await screen.findByRole('table', { name: 'Spend Profiles' });

    expect(querySpendProfilesLocal).toHaveBeenCalledWith(expect.objectContaining({ includeOrphans: false }));
    await user.click(screen.getByLabelText('Show profiles without User Profile'));
    await waitFor(() => expect(querySpendProfilesLocal).toHaveBeenCalledWith(expect.objectContaining({ includeOrphans: true })));
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

  it('builds Country = PT AND (custom19 = 1344 OR custom19 = 0913)', async () => {
    const user = userEvent.setup();
    render(<SpendProfilesWorkspace entityId="us-uat" />);
    await screen.findByRole('table', { name: 'Spend Profiles' });

    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    await user.click(screen.getByRole('button', { name: 'Add group' }));
    const fields = screen.getAllByLabelText(/Field for condition/);
    const values = screen.getAllByLabelText(/Value for condition/);
    await user.selectOptions(fields[0], 'country');
    await user.type(values[0], 'PT');
    await user.selectOptions(fields[1], 'custom19');
    await user.type(values[1], '1344');
    await user.selectOptions(fields[2], 'custom19');
    await user.type(values[2], '0913');

    expect(await screen.findByText('COUNTRY = "PT" AND (CUSTOM19 = "1344" OR CUSTOM19 = "0913")', {}, { timeout: 1500 })).toBeInTheDocument();
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
