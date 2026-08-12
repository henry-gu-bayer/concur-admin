import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsView } from './ReportsView';
import type { EntriesResult, ExpenseEntry, ExpenseReport, ReportSearchResult } from '../types';

const { searchReports, fetchAllReports, fetchReportEntries } = vi.hoisted(() => ({
  searchReports: vi.fn(),
  fetchAllReports: vi.fn(),
  fetchReportEntries: vi.fn(),
}));

vi.mock('../api/reportsApi', () => ({
  searchReports,
  fetchAllReports,
  fetchReportEntries,
}));

const REPORT1: ExpenseReport = {
  ID: 'rpt-1',
  Name: 'Berlin trip',
  Total: 1900,
  CurrencyCode: 'EUR',
  Country: 'DE',
  CountrySubdivision: 'DE-BE',
  CreateDate: '2026-01-05T10:00:00',
  SubmitDate: '2026-01-08T09:30:00',
  ProcessingPaymentDate: '2026-01-20T00:00:00',
  PaidDate: '2026-02-01T00:00:00',
  OwnerLoginID: 'jane.doe@example.com',
  OwnerName: 'Jane Doe',
  ApproverLoginID: 'max.manager@example.com',
  ApproverName: 'Max Manager',
  ApprovalStatusName: 'Approved',
  ApprovalStatusCode: 'A_APPR',
  PaymentStatusName: 'Paid',
  PaymentStatusCode: 'P_PAID',
  LastModifiedDate: '2026-02-01T01:00:00',
  PersonalAmount: 50,
  AmountDueEmployee: 1800,
  AmountDueCompanyCard: 50,
  TotalClaimedAmount: 1870,
  TotalApprovedAmount: 1850,
  LedgerName: 'DEFAULT',
  PolicyID: 'policy-1',
  EverSentBack: false,
  HasException: false,
  ReceiptsReceived: true,
  URI: 'https://us.api.concursolutions.com/api/v3.0/expense/reports/rpt-1',
};

const REPORT2: ExpenseReport = {
  ID: 'rpt-2',
  Name: 'Office supplies',
  Total: 42.5,
  CurrencyCode: 'USD',
  Country: 'US',
  OwnerLoginID: 'john.smith@example.com',
  OwnerName: 'John Smith',
  ApprovalStatusName: 'Not Submitted',
  ApprovalStatusCode: 'A_NOTF',
  PaymentStatusName: 'Not Paid',
  PaymentStatusCode: 'P_NOTP',
};

const ENTRY1: ExpenseEntry = {
  ID: 'e1',
  ExpenseTypeName: 'Hotel',
  ExpenseTypeCode: 'HOTEL',
  TransactionDate: '2026-01-06',
  TransactionAmount: 800,
  TransactionCurrencyCode: 'EUR',
  PostedAmount: 820,
  VendorDescription: 'Hotel Berlin Mitte',
  Description: 'Two nights',
  PaymentTypeName: 'Cash',
  LocationName: 'Berlin',
  LocationCountry: 'DE',
  SpendCategoryName: 'Lodging',
  AllocationType: 'N',
  IsPersonal: false,
  HasExceptions: true,
  HasImage: true,
  LastModified: '2026-01-09T12:30:00',
  Comment: '',
  VendorListItemName: null,
  Custom1: { Type: 'Text', Value: 'Cost center 42', Code: 'CC42' },
  Custom2: { Type: 'Text', Value: '' },
};

const ENTRY2: ExpenseEntry = {
  ID: 'e2',
  ExpenseTypeName: 'Dinner',
  TransactionDate: '2026-01-07',
  TransactionAmount: 65.5,
  TransactionCurrencyCode: 'EUR',
  PostedAmount: 65.5,
  VendorDescription: 'Restaurant',
  PaymentTypeName: 'Cash',
  IsPersonal: true,
};

function reportsResult(reports: ExpenseReport[], hasMore = false): ReportSearchResult {
  return { reports, hasMore };
}

function entriesResult(entries: ExpenseEntry[], hasMore = false): EntriesResult {
  return { entries, hasMore };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

async function searchByLoginId(loginId = 'jane') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Login ID'), loginId);
  await user.click(screen.getByRole('button', { name: /^search$/i }));
  return user;
}

/** Select the first report and open the entries dialog. */
async function openEntriesDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('Berlin trip'));
  await user.click(screen.getByRole('button', { name: /retrieve entries/i }));
  return screen.findByRole('dialog', { name: /expense entries/i });
}

describe('ReportsView', () => {
  it('renders the dropdown filters on one row and the date ranges on another', () => {
    render(<ReportsView />);

    const filterRow = screen.getByTestId('report-filter-row');
    expect(within(filterRow).getByLabelText('Login ID')).toBeInTheDocument();
    expect(within(filterRow).getByLabelText('Approval status')).toBeInTheDocument();
    expect(within(filterRow).getByLabelText('Payment status')).toBeInTheDocument();
    expect(within(filterRow).getByLabelText('Country/Region')).toBeInTheDocument();
    expect(within(filterRow).getByRole('button', { name: /^search$/i })).toBeDisabled();
    expect(filterRow).toHaveClass('flex-nowrap', 'min-w-0');
    // Each filter sits in an equal-share flex slot so the row stays within the page.
    const flexSlots = filterRow.querySelectorAll(':scope > .min-w-0.flex-1.basis-0');
    expect(flexSlots).toHaveLength(4);

    const dateRow = screen.getByTestId('report-date-row');
    expect(within(dateRow).getByLabelText('Created from')).toBeInTheDocument();
    expect(within(dateRow).getByLabelText('Created to')).toBeInTheDocument();
    expect(within(dateRow).getByLabelText('Submitted from')).toBeInTheDocument();
    expect(within(dateRow).getByLabelText('Submitted to')).toBeInTheDocument();
    expect(within(dateRow).getByLabelText('Paid from')).toBeInTheDocument();
    expect(within(dateRow).getByLabelText('Paid to')).toBeInTheDocument();
    expect(dateRow).toHaveClass('flex-nowrap');

    expect(screen.getByText(/search expense reports/i)).toBeInTheDocument();
  });

  it('searches with the combined filters and renders the result list', async () => {
    const user = userEvent.setup();
    searchReports.mockResolvedValue(reportsResult([REPORT1, REPORT2]));
    render(<ReportsView />);

    await user.type(screen.getByLabelText('Login ID'), 'jane.doe@example.com');
    await user.selectOptions(screen.getByLabelText('Approval status'), 'A_APPR');
    await user.selectOptions(screen.getByLabelText('Payment status'), 'P_PAID');
    await user.selectOptions(screen.getByLabelText('Country/Region'), 'DE');
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Created to'), { target: { value: '2026-01-31' } });
    fireEvent.change(screen.getByLabelText('Submitted from'), { target: { value: '2026-01-05' } });
    fireEvent.change(screen.getByLabelText('Submitted to'), { target: { value: '2026-01-15' } });
    fireEvent.change(screen.getByLabelText('Paid from'), { target: { value: '2026-02-01' } });
    fireEvent.change(screen.getByLabelText('Paid to'), { target: { value: '2026-02-28' } });
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() =>
      expect(searchReports).toHaveBeenCalledWith({
        loginId: 'jane.doe@example.com',
        approvalStatusCode: 'A_APPR',
        paymentStatusCode: 'P_PAID',
        countryCode: 'DE',
        createdAfter: '2026-01-01',
        createdBefore: '2026-01-31',
        submittedAfter: '2026-01-05',
        submittedBefore: '2026-01-15',
        paidAfter: '2026-02-01',
        paidBefore: '2026-02-28',
      }),
    );

    const table = await screen.findByRole('table', { name: /report search results/i });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Berlin trip')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Approved')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Paid')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/1,900\.00 EUR/)).toBeInTheDocument();
    expect(within(rows[0]).getByText('2026-01-08')).toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();
  });

  it('enables search with any single criterion', async () => {
    const user = userEvent.setup();
    searchReports.mockResolvedValue(reportsResult([]));
    render(<ReportsView />);

    await user.selectOptions(screen.getByLabelText('Payment status'), 'P_NOTP');
    expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(searchReports).toHaveBeenCalledWith({ paymentStatusCode: 'P_NOTP' }));
    expect(await screen.findByText(/no reports found/i)).toBeInTheDocument();
  });

  it('shows the report header details with a highlighted entries button on top', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    render(<ReportsView />);
    const user = await searchByLoginId();

    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    const entriesButton = within(panel).getByRole('button', { name: /retrieve entries/i });
    expect(entriesButton).toHaveClass('bg-blue-600');
    // The button sits above the report header details.
    expect(entriesButton.compareDocumentPosition(within(panel).getByRole('heading', { name: 'Berlin trip' })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    expect(within(panel).getByText('rpt-1')).toBeInTheDocument();
    expect(within(panel).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(panel).getByText('jane.doe@example.com')).toBeInTheDocument();
    expect(within(panel).getByText('Max Manager')).toBeInTheDocument();
    expect(within(panel).getByText(/Germany \(DE\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/1,900\.00 EUR/)).toBeInTheDocument();
    expect(within(panel).getByText('DEFAULT')).toBeInTheDocument();
  });

  it('retrieves entries and lists all of them in a dialog', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1, ENTRY2]));
    render(<ReportsView />);
    const user = await searchByLoginId();

    const dialog = await openEntriesDialog(user);

    await waitFor(() => expect(fetchReportEntries).toHaveBeenCalledWith('rpt-1', 'jane.doe@example.com'));
    expect(within(dialog).getByText(/2 entries/)).toBeInTheDocument();

    const table = within(dialog).getByRole('table', { name: /entries for berlin trip/i });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Hotel')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Hotel Berlin Mitte')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/800\.00 EUR/)).toBeInTheDocument();
    expect(within(rows[0]).getByText('2026-01-06')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Dinner')).toBeInTheDocument();
  });

  it('shows every populated field of a clicked entry and hides empty ones', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1, ENTRY2]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    const dialog = await openEntriesDialog(user);

    await user.click(within(dialog).getByRole('button', { name: /view entry hotel/i }));

    const details = within(dialog).getByRole('group', { name: /entry details/i });
    expect(within(details).getByText('Entry ID')).toBeInTheDocument();
    expect(within(details).getByText('e1')).toBeInTheDocument();
    expect(within(details).getByText('Expense type code')).toBeInTheDocument();
    expect(within(details).getByText('HOTEL')).toBeInTheDocument();
    expect(within(details).getByText('Spend category')).toBeInTheDocument();
    expect(within(details).getByText('Lodging')).toBeInTheDocument();
    expect(within(details).getByText('Allocation type')).toBeInTheDocument();
    expect(within(details).getByText('Custom 1')).toBeInTheDocument();
    expect(within(details).getByText('Cost center 42 (CC42)')).toBeInTheDocument();
    expect(within(details).getByText('Has exceptions')).toBeInTheDocument();
    expect(within(details).getByText('2026-01-09 12:30')).toBeInTheDocument();

    // Empty, null, and blank-value fields are omitted.
    expect(within(details).queryByText('Comment')).not.toBeInTheDocument();
    expect(within(details).queryByText('Vendor list item name')).not.toBeInTheDocument();
    expect(within(details).queryByText('Custom 2')).not.toBeInTheDocument();
    expect(within(details).queryByText('Trip ID')).not.toBeInTheDocument();

    // Switching entries swaps the details.
    await user.click(within(dialog).getByRole('button', { name: /view entry dinner/i }));
    expect(within(within(dialog).getByRole('group', { name: /entry details/i })).getByText('e2')).toBeInTheDocument();
  });

  it('closes the entries dialog and reopens it without refetching', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    const dialog = await openEntriesDialog(user);

    await user.click(within(dialog).getByRole('button', { name: /^close$/i }));
    expect(screen.queryByRole('dialog', { name: /expense entries/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view entries \(1\)/i }));
    expect(await screen.findByRole('dialog', { name: /expense entries/i })).toBeInTheDocument();
    expect(fetchReportEntries).toHaveBeenCalledTimes(1);
  });

  it('clears loaded entries when another report is selected', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1, REPORT2]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    const dialog = await openEntriesDialog(user);
    await user.click(within(dialog).getByRole('button', { name: /^close$/i }));

    await user.click(screen.getByText('Office supplies'));
    const panel = screen.getByRole('complementary', { name: /report details/i });
    expect(within(panel).getByRole('heading', { name: 'Office supplies' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /retrieve entries/i })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /view entries/i })).not.toBeInTheDocument();
  });

  it('shows an entries error when retrieval fails', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockRejectedValue(new Error('HTTP 403'));
    render(<ReportsView />);
    const user = await searchByLoginId();

    await user.click(await screen.findByText('Berlin trip'));
    await user.click(screen.getByRole('button', { name: /retrieve entries/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403');
    expect(screen.queryByRole('dialog', { name: /expense entries/i })).not.toBeInTheDocument();
  });

  it('shows a search error when the query fails', async () => {
    searchReports.mockRejectedValue(new Error('HTTP 500'));
    render(<ReportsView />);
    await searchByLoginId();
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500');
  });

  it('offers loading all reports when the first page has more on the server', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1], true));
    fetchAllReports.mockResolvedValue(reportsResult([REPORT1, REPORT2]));
    render(<ReportsView />);
    const user = await searchByLoginId();

    expect(await screen.findByText(/more reports match/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /load all/i }));

    await waitFor(() => expect(fetchAllReports).toHaveBeenCalledWith({ loginId: 'jane' }));
    expect(await screen.findByText('Office supplies')).toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();
  });
});
