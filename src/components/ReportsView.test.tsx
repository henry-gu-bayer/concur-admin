import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customFieldTypeCode, ReportsView } from './ReportsView';
import type { EntriesResult, ExpenseEntry, ExpenseReport, ReportSearchResult, TravelRequestExpectedExpenseV4 } from '../types';

const {
  searchReports,
  fetchAllReports,
  fetchReportEntries,
  fetchReportById,
  resolveReportOwnerLoginId,
  fetchReportV4,
  fetchReportExceptionsV4,
  fetchReportCommentsV4,
  fetchReportRequestAssociations,
  fetchTravelRequestV4,
  fetchTravelRequestExpectedExpenseV4,
  fetchReportExpensesV4,
  fetchExpenseExceptionsV4,
  fetchExpenseCommentsV4,
  fetchExpenseAttendeesV4,
  resolveIdentityUserIdV4,
  getUserProfile,
  references,
  loadReportReferences,
  ensureLocationsLoaded,
  getReportReferences,
} = vi.hoisted(() => ({
  searchReports: vi.fn(),
  fetchAllReports: vi.fn(),
  fetchReportEntries: vi.fn(),
  fetchReportById: vi.fn(),
  resolveReportOwnerLoginId: vi.fn(),
  fetchReportV4: vi.fn(),
  fetchReportExceptionsV4: vi.fn(),
  fetchReportCommentsV4: vi.fn(),
  fetchReportRequestAssociations: vi.fn(),
  fetchTravelRequestV4: vi.fn(),
  fetchTravelRequestExpectedExpenseV4: vi.fn(),
  fetchReportExpensesV4: vi.fn(),
  fetchExpenseExceptionsV4: vi.fn(),
  fetchExpenseCommentsV4: vi.fn(),
  fetchExpenseAttendeesV4: vi.fn(),
  resolveIdentityUserIdV4: vi.fn(),
  getUserProfile: vi.fn(),
  references: {
    policyNameById: new Map<string, string>(),
    paymentTypeNameById: new Map<string, string>(),
    formNameById: new Map<string, string>(),
    locationNameById: new Map<string, string>(),
  },
  loadReportReferences: vi.fn(),
  ensureLocationsLoaded: vi.fn(),
  getReportReferences: vi.fn(),
}));

vi.mock('../api/reportsApi', () => ({
  searchReports,
  fetchAllReports,
  fetchReportEntries,
  fetchReportById,
  resolveReportOwnerLoginId,
  fetchReportV4,
  fetchReportExceptionsV4,
  fetchReportCommentsV4,
  fetchReportRequestAssociations,
  fetchTravelRequestV4,
  fetchTravelRequestExpectedExpenseV4,
  fetchReportExpensesV4,
  fetchExpenseExceptionsV4,
  fetchExpenseCommentsV4,
  fetchExpenseAttendeesV4,
  resolveIdentityUserIdV4,
}));

vi.mock('../api/identityApi', () => ({ getUserProfile }));

vi.mock('./reportsReferences', () => ({
  EMPTY_REFERENCES: references,
  loadReportReferences,
  ensureLocationsLoaded,
  getReportReferences,
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
  CreateDate: '2025-12-20T14:00:00',
  SubmitDate: '2026-01-02T09:00:00',
  OwnerLoginID: 'john.smith@example.com',
  OwnerName: 'John Smith',
  ApprovalStatusName: 'Not Submitted',
  ApprovalStatusCode: 'A_NOTF',
  PaymentStatusName: 'Not Paid',
  PaymentStatusCode: 'P_NOTP',
};

const ENTRY1: ExpenseEntry = {
  ID: 'e1',
  ExpenseID: 'exp-uuid-1',
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
  ExpenseID: 'exp-uuid-2',
  ExpenseTypeName: 'Dinner',
  TransactionDate: '2026-01-07',
  TransactionAmount: 65.5,
  TransactionCurrencyCode: 'EUR',
  PostedAmount: 65.5,
  VendorDescription: 'Restaurant',
  PaymentTypeName: 'Cash',
  HasComments: true,
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
  sessionStorage.clear();
  references.policyNameById.clear();
  references.paymentTypeNameById.clear();
  references.formNameById.clear();
  references.locationNameById.clear();
  loadReportReferences.mockResolvedValue(references);
  ensureLocationsLoaded.mockResolvedValue(undefined);
  getReportReferences.mockReturnValue(references);
  fetchReportV4.mockResolvedValue({ userId: 'user-uuid', report: {} });
  fetchReportExceptionsV4.mockResolvedValue([]);
  fetchReportCommentsV4.mockResolvedValue([]);
  fetchReportRequestAssociations.mockResolvedValue([]);
  fetchTravelRequestV4.mockResolvedValue({});
  fetchTravelRequestExpectedExpenseV4.mockResolvedValue({});
  resolveIdentityUserIdV4.mockResolvedValue('user-uuid');
  fetchReportExpensesV4.mockResolvedValue([]);
  fetchExpenseExceptionsV4.mockResolvedValue([]);
  fetchExpenseCommentsV4.mockResolvedValue([]);
  fetchExpenseAttendeesV4.mockResolvedValue({ attendees: [], noShowAttendeeCount: 0 });
  getUserProfile.mockImplementation((id: string) => Promise.resolve({ id, userName: `${id}@example.com` }));
});

afterEach(cleanup);

async function searchByLoginId(loginId = 'jane') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Login ID'), loginId);
  await user.click(screen.getByRole('button', { name: /^search$/i }));
  return user;
}

/** Select the first report and open the focused entries workspace. */
async function openEntriesDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('Berlin trip'));
  const panel = screen.getByRole('complementary', { name: /report details/i });
  await user.click(within(panel).getByRole('button', { name: /retrieve entries/i }));
  return screen.findByRole('region', { name: /expense entries for berlin trip/i });
}

/** Open the Advanced search dialog. */
async function openAdvancedDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /advanced search/i }));
  return screen.findByRole('dialog', { name: /advanced search/i });
}

async function expandReportSection(
  user: ReturnType<typeof userEvent.setup>,
  panel: HTMLElement,
  title: string,
) {
  const button = within(panel).getByRole('button', { name: new RegExp(`expand ${title}`, 'i') });
  await user.click(button);
  return button;
}

describe('ReportsView', () => {
  it('uses compact letter codes for known custom field types', () => {
    expect(['Amount', 'Boolean', 'Connected List', 'Date', 'Integer', 'List', 'Number', 'Text'].map(customFieldTypeCode))
      .toEqual(['A', 'B', 'C', 'D', 'I', 'L', 'N', 'T']);
    expect(customFieldTypeCode('t')).toBe('T');
    expect(customFieldTypeCode('Unsupported')).toBe('Unsupported');
  });

  it('keeps only login ID and report ID on the main row; the rest lives in the advanced dialog', async () => {
    const user = userEvent.setup();
    render(<ReportsView />);

    const filterRow = screen.getByTestId('report-filter-row');
    expect(within(filterRow).getByLabelText('Login ID')).toBeInTheDocument();
    expect(within(filterRow).getByLabelText('Report ID')).toBeInTheDocument();
    expect(within(filterRow).getByRole('button', { name: /^search$/i })).toBeDisabled();
    expect(within(filterRow).getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(within(filterRow).getByRole('button', { name: /advanced search/i })).toBeInTheDocument();
    expect(filterRow).toHaveClass('flex-nowrap', 'min-w-0');
    // Each filter sits in an equal-share flex slot so the row stays within the page.
    const flexSlots = filterRow.querySelectorAll(':scope > .min-w-0.flex-1.basis-0');
    expect(flexSlots).toHaveLength(2);

    // The advanced filters are hidden until the dialog is opened.
    expect(screen.queryByLabelText('Approval status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Payment status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Country/Region')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Has images')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Has attendees')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Expense type code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Created from')).not.toBeInTheDocument();

    const dialog = await openAdvancedDialog(user);
    expect(within(dialog).getByLabelText('Approval status')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Payment status')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Country/Region')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Has images')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Has attendees')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Expense type code')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Created from')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Created to')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Submitted from')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Submitted to')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Paid from')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Paid to')).toBeInTheDocument();

    expect(screen.getByText(/search expense reports/i)).toBeInTheDocument();
  });

  it('searches with the combined filters and renders the result list', async () => {
    const user = userEvent.setup();
    searchReports.mockResolvedValue(reportsResult([REPORT1, REPORT2]));
    render(<ReportsView />);

    await user.type(screen.getByLabelText('Login ID'), 'jane.doe@example.com');
    const dialog = await openAdvancedDialog(user);
    await user.selectOptions(within(dialog).getByLabelText('Approval status'), 'A_APPR');
    await user.selectOptions(within(dialog).getByLabelText('Payment status'), 'P_PAID');
    await user.selectOptions(within(dialog).getByLabelText('Country/Region'), 'DE');
    fireEvent.change(within(dialog).getByLabelText('Created from'), { target: { value: '2026-01-01' } });
    fireEvent.change(within(dialog).getByLabelText('Created to'), { target: { value: '2026-01-31' } });
    fireEvent.change(within(dialog).getByLabelText('Submitted from'), { target: { value: '2026-01-05' } });
    fireEvent.change(within(dialog).getByLabelText('Submitted to'), { target: { value: '2026-01-15' } });
    fireEvent.change(within(dialog).getByLabelText('Paid from'), { target: { value: '2026-02-01' } });
    fireEvent.change(within(dialog).getByLabelText('Paid to'), { target: { value: '2026-02-28' } });
    await user.selectOptions(within(dialog).getByLabelText('Has images'), 'true');
    await user.selectOptions(within(dialog).getByLabelText('Has attendees'), 'false');
    await user.type(within(dialog).getByLabelText('Expense type code'), 'AIRFR');
    await user.click(within(dialog).getByRole('button', { name: /^done$/i }));
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
        expenseTypeCode: 'AIRFR',
        hasImages: true,
        hasAttendees: false,
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

  it('shows the created date and sorts every report column in both directions', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1, REPORT2]));
    render(<ReportsView />);
    const user = await searchByLoginId();

    const table = await screen.findByRole('table', { name: /report search results/i });
    expect(within(table).getByRole('columnheader', { name: /created/i })).toBeInTheDocument();
    expect(within(table).getByText('2026-01-05')).toBeInTheDocument();
    expect(within(table).getByText('2025-12-20')).toBeInTheDocument();

    const visibleRowNames = () => within(table).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent);
    const createdHeader = within(table).getByRole('columnheader', { name: /created/i });
    await user.click(within(createdHeader).getByRole('button'));
    expect(createdHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(visibleRowNames()).toEqual(['Office supplies', 'Berlin trip']);
    await user.click(within(createdHeader).getByRole('button'));
    expect(createdHeader).toHaveAttribute('aria-sort', 'descending');
    expect(visibleRowNames()).toEqual(['Berlin trip', 'Office supplies']);

    for (const label of ['Name', 'Owner', 'Approval', 'Payment', 'Total', 'Submitted']) {
      const header = within(table).getByRole('columnheader', { name: new RegExp(label, 'i') });
      await user.click(within(header).getByRole('button'));
      expect(header).toHaveAttribute('aria-sort', 'ascending');
      await user.click(within(header).getByRole('button'));
      expect(header).toHaveAttribute('aria-sort', 'descending');
    }
  });

  it('enables search with any single advanced criterion', async () => {
    const user = userEvent.setup();
    searchReports.mockResolvedValue(reportsResult([]));
    render(<ReportsView />);

    const dialog = await openAdvancedDialog(user);
    await user.selectOptions(within(dialog).getByLabelText('Payment status'), 'P_NOTP');
    await user.click(within(dialog).getByRole('button', { name: /^done$/i }));

    expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(searchReports).toHaveBeenCalledWith({ paymentStatusCode: 'P_NOTP' }));
    expect(await screen.findByText(/no reports found/i)).toBeInTheDocument();
  });

  it('shows each advanced criterion as a removable search tag', async () => {
    const user = userEvent.setup();
    searchReports.mockResolvedValue(reportsResult([]));
    render(<ReportsView />);

    const dialog = await openAdvancedDialog(user);
    await user.selectOptions(within(dialog).getByLabelText('Approval status'), 'A_APPR');
    await user.selectOptions(within(dialog).getByLabelText('Country/Region'), 'DE');
    await user.selectOptions(within(dialog).getByLabelText('Has images'), 'true');
    fireEvent.change(within(dialog).getByLabelText('Created from'), { target: { value: '2026-01-01' } });
    await user.click(within(dialog).getByRole('button', { name: /^done$/i }));

    const filters = screen.getByLabelText('Active advanced search filters');
    expect(within(filters).getByText(/Approval:/)).toBeInTheDocument();
    expect(within(filters).getByText('Approved')).toBeInTheDocument();
    expect(within(filters).getByText(/Country:/)).toBeInTheDocument();
    expect(within(filters).getByText(/Germany \(DE\)/)).toBeInTheDocument();
    expect(within(filters).getByText(/Created from:/)).toBeInTheDocument();
    expect(within(filters).getByText('2026-01-01')).toBeInTheDocument();
    expect(within(filters).getByText(/Has images:/)).toBeInTheDocument();
    expect(within(filters).getByText('Yes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advanced search (4)' })).toBeInTheDocument();

    await user.click(within(filters).getByRole('button', { name: 'Remove Country filter' }));
    expect(within(filters).queryByText(/Germany \(DE\)/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advanced search (3)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(searchReports).toHaveBeenCalledWith({
      approvalStatusCode: 'A_APPR',
      createdAfter: '2026-01-01',
      hasImages: true,
    }));
  });

  it('clears all report search inputs, filters, results, and selection from the main toolbar', async () => {
    const user = userEvent.setup();
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    render(<ReportsView />);

    await user.type(screen.getByLabelText('Login ID'), 'jane.doe@example.com');
    const dialog = await openAdvancedDialog(user);
    await user.selectOptions(within(dialog).getByLabelText('Approval status'), 'A_APPR');
    await user.click(within(dialog).getByRole('button', { name: /^done$/i }));
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await user.click(await screen.findByText('Berlin trip'));
    await user.type(screen.getByLabelText('Report ID'), 'rpt-1');

    expect(screen.getByRole('table', { name: /report search results/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /report details/i })).toHaveTextContent('Berlin trip');
    expect(screen.getByLabelText('Active advanced search filters')).toBeInTheDocument();

    const clearButton = screen.getByRole('button', { name: /^clear$/i });
    await user.click(clearButton);

    expect(screen.getByLabelText('Login ID')).toHaveValue('');
    expect(screen.getByLabelText('Report ID')).toHaveValue('');
    expect(screen.queryByLabelText('Active advanced search filters')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advanced search' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /report search results/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /search expense reports/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /report details/i })).toHaveTextContent('No report selected');
    expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled();
    expect(clearButton).toBeDisabled();
  });

  it('exposes a resizable separator between report results and details', () => {
    render(<ReportsView />);

    expect(screen.getByRole('separator', { name: /resize report results and details/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /report search results/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /report details/i })).toBeInTheDocument();
  });

  it('retrieves a report directly by report ID and selects it', async () => {
    const user = userEvent.setup();
    fetchReportById.mockResolvedValue(REPORT1);
    render(<ReportsView />);

    await user.type(screen.getByLabelText('Login ID'), 'jane.doe@example.com');
    await user.type(screen.getByLabelText('Report ID'), '  rpt-1  ');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(fetchReportById).toHaveBeenCalledWith('rpt-1', 'jane.doe@example.com'));
    expect(resolveReportOwnerLoginId).not.toHaveBeenCalled();
    expect(searchReports).not.toHaveBeenCalled();
    expect(await screen.findByText('1 result')).toBeInTheDocument();

    // The single report is auto-selected, showing its header details.
    const panel = screen.getByRole('complementary', { name: /report details/i });
    expect(within(panel).getByRole('heading', { name: 'Berlin trip' })).toBeInTheDocument();
    expect(within(panel).getByText('rpt-1')).toBeInTheDocument();
  });

  it('resolves the owner login ID from Report v2 when only report ID is given', async () => {
    const user = userEvent.setup();
    resolveReportOwnerLoginId.mockResolvedValue('jane.doe@example.com');
    fetchReportById.mockResolvedValue(REPORT1);
    render(<ReportsView />);

    await user.type(screen.getByLabelText('Report ID'), 'rpt-1');
    expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(resolveReportOwnerLoginId).toHaveBeenCalledWith('rpt-1'));
    await waitFor(() => expect(fetchReportById).toHaveBeenCalledWith('rpt-1', 'jane.doe@example.com'));
    expect(screen.getByLabelText('Login ID')).toHaveValue('jane.doe@example.com');
    expect(await screen.findByText('1 result')).toBeInTheDocument();
  });

  it('shows a report ID error when owner resolve fails', async () => {
    const user = userEvent.setup();
    resolveReportOwnerLoginId.mockRejectedValue(new Error('No report found for this ID (HTTP 404)'));
    render(<ReportsView />);

    await user.type(screen.getByLabelText('Report ID'), 'missing');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no report found/i);
    expect(fetchReportById).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Login ID')).toHaveValue('');
  });

  it('shows an error when the report ID lookup fails', async () => {
    const user = userEvent.setup();
    fetchReportById.mockRejectedValue(new Error('HTTP 404'));
    render(<ReportsView />);

    await user.type(screen.getByLabelText('Login ID'), 'jane.doe@example.com');
    await user.type(screen.getByLabelText('Report ID'), 'unknown-id');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 404');
    expect(screen.queryByRole('table', { name: /report search results/i })).not.toBeInTheDocument();
  });

  it('clears all advanced filters at once from the dialog', async () => {
    const user = userEvent.setup();
    searchReports.mockResolvedValue(reportsResult([]));
    render(<ReportsView />);

    const dialog = await openAdvancedDialog(user);
    await user.selectOptions(within(dialog).getByLabelText('Approval status'), 'A_APPR');
    await user.selectOptions(within(dialog).getByLabelText('Country/Region'), 'DE');
    await user.click(within(dialog).getByRole('button', { name: /clear all/i }));
    await user.click(within(dialog).getByRole('button', { name: /^done$/i }));

    await user.type(screen.getByLabelText('Login ID'), 'jane');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(searchReports).toHaveBeenCalledWith({ loginId: 'jane' }));
  });

  it('shows the report header details with a compact highlighted entries button on top', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    render(<ReportsView />);
    const user = await searchByLoginId();

    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    const entriesButton = within(panel).getByRole('button', { name: /retrieve entries/i });
    expect(entriesButton).toHaveClass('bg-blue-600');
    expect(entriesButton).not.toHaveClass('w-full');
    // The action stays in the fixed detail header rather than scrolling with the fields.
    expect(entriesButton.closest('header')).toContainElement(within(panel).getByRole('heading', { name: 'Berlin trip' }));

    expect(within(panel).getByText('rpt-1')).toBeInTheDocument();
    expect(within(panel).getAllByText('Jane Doe')).toHaveLength(2);
    expect(within(panel).getByText('jane.doe@example.com')).toBeInTheDocument();
    expect(within(panel).getByText('Max Manager')).toBeInTheDocument();
    expect(within(panel).getByText(/Germany \(DE\)/)).toBeInTheDocument();
    await expandReportSection(user, panel, 'Amounts');
    await expandReportSection(user, panel, 'Policy & workflow');
    expect(within(panel).getAllByText(/1,900\.00 EUR/)).toHaveLength(2);
    expect(within(panel).getByText('DEFAULT')).toBeInTheDocument();
    // The raw URI is noise and stays hidden.
    expect(within(panel).queryByText(/api\/v3\.0\/expense\/reports\/rpt-1/)).not.toBeInTheDocument();
  });

  it('loads associated Travel Requests and shows summaries plus separated safe detail sections', async () => {
    const firstExpenseHref = 'https://us.api.concursolutions.com/travelrequest/v4/expenses/expense-1?userId=user-uuid';
    const secondExpenseHref = '/travelrequest/v4/expenses/expense-2';
    let resolveFirstExpense!: (expense: TravelRequestExpectedExpenseV4) => void;
    let resolveSecondExpense!: (expense: TravelRequestExpectedExpenseV4) => void;
    const firstExpense = new Promise<TravelRequestExpectedExpenseV4>((resolve) => {
      resolveFirstExpense = resolve;
    });
    const secondExpense = new Promise<TravelRequestExpectedExpenseV4>((resolve) => {
      resolveSecondExpense = resolve;
    });
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportRequestAssociations.mockResolvedValue(['request-1', 'request-2']);
    fetchTravelRequestV4
      .mockResolvedValueOnce({
        id: 'request-1',
        href: 'https://us.api.concursolutions.com/travelrequest/v4/requests/request-1',
        name: 'Berlin customer meeting',
        owner: { name: 'Jane Doe', loginId: 'jane.doe@example.com' },
        approvalStatus: { code: 'APPROVED', name: 'Approved' },
        startDate: '2026-01-05',
        endDate: '2026-01-08',
        mainDestination: { city: 'Berlin', countryCode: 'DE' },
        businessPurpose: 'Customer workshop',
        totalApprovedAmount: { value: 1200, currency: 'EUR' },
        itinerary: { segments: [{ carrier: 'LH' }] },
        custom1: {
          value: 'Client visit',
          code: 'BER',
          href: 'https://us.api.concursolutions.com/travelrequest/v4/list-items/client-visit',
        },
        expenses: [
          { id: 'expense-1', href: firstExpenseHref },
          { id: 'expense-2', href: secondExpenseHref },
        ],
        operations: [{
          rel: 'submit',
          href: 'https://us.api.concursolutions.com/travelrequest/v4/requests/request-1/submit',
        }],
      })
      .mockResolvedValueOnce({ id: 'request-2', name: 'Follow-up trip' });
    fetchTravelRequestExpectedExpenseV4
      .mockImplementationOnce(() => firstExpense)
      .mockImplementationOnce(() => secondExpense);
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    await waitFor(() => expect(fetchReportRequestAssociations).toHaveBeenCalledWith('rpt-1', 'user-uuid'));
    await waitFor(() => expect(fetchTravelRequestV4).toHaveBeenCalledTimes(2));
    const panel = screen.getByRole('complementary', { name: /report details/i });
    await user.click(await within(panel).findByRole('button', { name: /travel requests \(2\)/i }));

    const dialog = screen.getByRole('dialog', { name: /associated travel requests/i });
    expect(within(dialog).getByRole('heading', { name: 'Berlin customer meeting' })).toBeInTheDocument();
    expect(within(dialog).getByText('Jane Doe · jane.doe@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('1,200.00 EUR')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /expand expected expenses \(2\)/i })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /expand expected expenses \(2\)/i }));
    expect(within(dialog).getByRole('status')).toHaveTextContent(/loading expected expenses/i);
    expect(fetchTravelRequestExpectedExpenseV4).toHaveBeenCalledWith(firstExpenseHref);
    expect(fetchTravelRequestExpectedExpenseV4).toHaveBeenCalledWith(secondExpenseHref);

    expect(within(dialog).queryByText('Itinerary › Segments [1] › Carrier')).not.toBeInTheDocument();
    await user.click(within(dialog).getAllByRole('button', { name: /expand all fields/i })[0]);
    expect(within(dialog).getByText('Itinerary › Segments [1] › Carrier')).toBeInTheDocument();
    expect(within(dialog).getByText('LH')).toBeInTheDocument();
    expect(within(dialog).queryByText(/custom 1/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/expenses \[1\]/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/operations/i)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /expand custom fields \(1\)/i }));
    expect(within(dialog).getByText('Client visit (BER)')).toBeInTheDocument();

    resolveFirstExpense({
      id: 'expense-1',
      href: firstExpenseHref,
      expenseType: {
        name: 'Airfare',
        href: 'https://us.api.concursolutions.com/travelrequest/v4/expense-types/airfare',
      },
      transactionAmount: { value: 450, currency: 'EUR' },
      allocations: [{ costCenter: 'BER-SALES', href: 'https://example.test/allocations/1' }],
      emptyNote: '',
    });
    resolveSecondExpense({
      id: 'expense-2',
      transactionDate: '2026-01-07',
      tripData: {
        segment: 'Outbound',
        template: 'https://example.test/templates/trip',
      },
      vendor: { name: 'Lufthansa', website: 'https://www.lufthansa.com' },
      emptyObject: {},
    });

    expect(await within(dialog).findByText('Transaction Amount › Value')).toBeInTheDocument();
    expect(within(dialog).getByText('450')).toBeInTheDocument();
    expect(within(dialog).getByText('Airfare')).toBeInTheDocument();
    expect(within(dialog).getByText('BER-SALES')).toBeInTheDocument();
    expect(within(dialog).getByText('Outbound')).toBeInTheDocument();
    expect(within(dialog).getByText('Lufthansa')).toBeInTheDocument();
    expect(within(dialog).queryByText('Empty Note')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Empty Object')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(dialog).not.toHaveTextContent(firstExpenseHref);
    expect(dialog).not.toHaveTextContent('https://us.api.concursolutions.com/travelrequest/v4/requests/request-1');
    expect(dialog).not.toHaveTextContent('https://us.api.concursolutions.com/travelrequest/v4/list-items/client-visit');
    expect(dialog).not.toHaveTextContent('https://us.api.concursolutions.com/travelrequest/v4/requests/request-1/submit');
    expect(dialog).not.toHaveTextContent('https://example.test/templates/trip');
    expect(dialog).not.toHaveTextContent('https://www.lufthansa.com');
  });

  it('keeps loaded expected expenses visible beside a per-expense failure', async () => {
    const firstExpenseHref = '/travelrequest/v4/expenses/expense-failed?userId=user-uuid';
    const secondExpenseHref = '/travelrequest/v4/expenses/expense-ok?userId=user-uuid';
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportRequestAssociations.mockResolvedValue(['request-1']);
    fetchTravelRequestV4.mockResolvedValue({
      id: 'request-1',
      name: 'Partially loaded request',
      expenses: [
        { id: 'expense-failed', href: firstExpenseHref },
        { id: 'expense-ok', href: secondExpenseHref },
      ],
    });
    fetchTravelRequestExpectedExpenseV4
      .mockRejectedValueOnce(new Error('HTTP 403'))
      .mockResolvedValueOnce({
        id: 'expense-ok',
        expenseType: { name: 'Rail' },
        transactionAmount: { value: 89, currency: 'EUR' },
      });
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    await user.click(await within(panel).findByRole('button', { name: /travel requests \(1\)/i }));
    const dialog = screen.getByRole('dialog', { name: /associated travel requests/i });
    await user.click(await within(dialog).findByRole('button', { name: /expand expected expenses \(2\)/i }));

    expect(await within(dialog).findByText('Rail')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Expected expense 2' })).toBeInTheDocument();
    expect(within(dialog).getByText('89')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/expense-failed.*HTTP 403/i);
  });

  it('does not process pending expected-expense results after unmount', async () => {
    let rejectExpense!: (reason: unknown) => void;
    const pendingExpense = new Promise<TravelRequestExpectedExpenseV4>((_resolve, reject) => {
      rejectExpense = reject;
    });
    const staleReason = { toString: vi.fn(() => 'stale expense failure') };
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportRequestAssociations.mockResolvedValue(['request-1']);
    fetchTravelRequestV4.mockResolvedValue({
      id: 'request-1',
      name: 'Pending request',
      expenses: [{ id: 'expense-1', href: '/travelrequest/v4/expenses/expense-1' }],
    });
    fetchTravelRequestExpectedExpenseV4.mockReturnValue(pendingExpense);
    const view = render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));
    await waitFor(() => expect(fetchTravelRequestExpectedExpenseV4).toHaveBeenCalledTimes(1));

    view.unmount();
    rejectExpense(staleReason);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(staleReason.toString).not.toHaveBeenCalled();
  });

  it('shows successful Travel Requests beside a detail failure', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportRequestAssociations.mockResolvedValue(['request-ok', 'request-failed']);
    fetchTravelRequestV4
      .mockResolvedValueOnce({ id: 'request-ok', name: 'Loaded request' })
      .mockRejectedValueOnce(new Error('HTTP 403'));
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    await user.click(await within(panel).findByRole('button', { name: /travel requests \(2\)/i }));
    const dialog = screen.getByRole('dialog', { name: /associated travel requests/i });
    expect(within(dialog).getByRole('heading', { name: 'Loaded request' })).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/request-failed.*HTTP 403/i);
  });

  it('hides the Travel Requests action when no associations exist', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    await waitFor(() => expect(fetchReportRequestAssociations).toHaveBeenCalledWith('rpt-1', 'user-uuid'));
    const panel = screen.getByRole('complementary', { name: /report details/i });
    await waitFor(() => expect(within(panel).queryByRole('button', { name: /travel requests/i })).not.toBeInTheDocument());
    expect(fetchTravelRequestV4).not.toHaveBeenCalled();
  });

  it('shows an association-level error in the Travel Requests popup', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportRequestAssociations.mockRejectedValue(new Error('HTTP 403 — travelrequest scope missing'));
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    await user.click(await within(panel).findByRole('button', { name: /^travel requests$/i }));
    expect(screen.getByRole('dialog', { name: /associated travel requests/i }))
      .toHaveTextContent(/associations are unavailable.*HTTP 403.*scope missing/i);
  });

  it('merges Reports v4-only fields into the matching collapsible v3 groups and marks them', async () => {
    references.policyNameById.set('policy-1', 'Resolved policy');
    searchReports.mockResolvedValue(reportsResult([{
      ...REPORT1,
      Custom3: { Type: 'Text', Value: 'Reports v3 custom value' },
    }]));
    fetchReportV4.mockResolvedValue({
      userId: 'user-uuid',
      report: {
        reportId: 'rpt-1',
        name: 'Berlin trip',
        reportTotal: { value: 1900, currencyCode: 'EUR' },
        businessPurpose: 'Customer workshop',
        reportType: 'Regular',
        policy: 'Resolved policy',
        canReopen: false,
        amountCompanyPaid: { value: 250, currencyCode: 'EUR' },
        ledgerId: 'ledger-v4',
        customData: [
          { id: 'custom1', value: 'Only in Reports v4' },
          { id: 'custom2', value: '' },
        ],
      },
    });
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    await waitFor(() => expect(fetchReportV4).toHaveBeenCalledWith('rpt-1', 'jane.doe@example.com'));
    const panel = screen.getByRole('complementary', { name: /report details/i });
    expect(within(panel).queryByRole('button', { name: /additional fields/i })).not.toBeInTheDocument();
    const businessPurpose = within(panel).getByText('Business purpose');
    expect(businessPurpose).toHaveClass('text-blue-700');
    expect(within(businessPurpose).getByText('v4')).toBeInTheDocument();
    expect(within(panel).getByText('Customer workshop')).toHaveClass('text-blue-950');
    expect(within(panel).getByText('Report type')).toBeInTheDocument();
    await expandReportSection(user, panel, 'Amounts');
    expect(within(panel).getByText('250.00 EUR')).toBeInTheDocument();
    await expandReportSection(user, panel, 'Policy & workflow');
    expect(within(panel).getByText('Can reopen')).toBeInTheDocument();
    expect(within(panel).getByText('ledger-v4')).toBeInTheDocument();
    expect(within(panel).getAllByText('Policy name')).toHaveLength(1);
    await expandReportSection(user, panel, 'Custom fields');
    expect(within(panel).getByText('Only in Reports v4')).toBeInTheDocument();
    expect(within(panel).queryByText('Report total')).not.toBeInTheDocument();
  });

  it('keeps Reports v3 details usable when Reports v4 enrichment fails', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportV4.mockRejectedValue(new Error('HTTP 403 — expense.report.read scope missing'));
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    expect(await within(panel).findByText(/Reports v4 enrichment unavailable: HTTP 403/i)).toBeInTheDocument();
    expect(within(panel).getByText('jane.doe@example.com')).toBeInTheDocument();
    expect(within(panel).getByText(/1,900\.00 EUR/)).toBeInTheDocument();
    expect(within(panel).queryByText('v4')).not.toBeInTheDocument();
  });

  it('marks v3-only report fields in orange and allows adjusting the label width', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    expect(within(panel).getByLabelText('Owner login ID source v3')).toHaveClass('text-orange-700');
    expect(within(panel).queryByLabelText('Country source v3')).not.toBeInTheDocument();
    const width = within(panel).getByRole('slider', { name: /field label width/i });
    fireEvent.change(width, { target: { value: '232' } });
    expect(width).toHaveValue('232');
    expect(within(panel).getByLabelText('Scrollable report details')).toHaveStyle({ '--detail-label-width': '232px' });
  });

  it('lists remaining Reports v3 fields with source indicators', async () => {
    const reportWithExtra = {
      ...REPORT1,
      NewAuditFlag: true,
    } as ExpenseReport & Record<string, unknown>;
    searchReports.mockResolvedValue(reportsResult([reportWithExtra]));
    fetchReportV4.mockResolvedValue({
      userId: 'user-uuid',
      report: { futureV4Value: 'v4 addition' } as never,
    });
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    await waitFor(() => expect(fetchReportV4).toHaveBeenCalled());
    await expandReportSection(user, panel, 'Other fields');

    expect(within(panel).getByLabelText('Approval status code source v3')).toHaveClass('text-orange-700');
    expect(within(panel).getByLabelText('Has exception source v3')).toHaveClass('text-orange-700');
    expect(within(panel).getByLabelText('New audit flag source v3')).toHaveClass('text-orange-700');
    expect(within(panel).getByLabelText(/future v4 value source v4/i)).toHaveClass('text-blue-700');
    expect(within(panel).queryByLabelText('Owner name source v3')).not.toBeInTheDocument();
    expect(within(panel).queryByText(REPORT1.URI!)).not.toBeInTheDocument();
  });

  it('loads report-header exceptions only for flagged reports and displays them as a list', async () => {
    searchReports.mockResolvedValue(reportsResult([{ ...REPORT1, HasException: true }]));
    fetchReportExceptionsV4.mockResolvedValue([
      {
        exceptionCode: 'ITEMDIFF',
        exceptionVisibility: 'ALL',
        isBlocking: true,
        message: 'The report total does not match its entries.',
        expenseId: 'expense-1',
      },
      {
        exceptionCode: 'RECEIPT',
        exceptionVisibility: 'AUDITOR',
        isBlocking: false,
        message: 'A receipt is recommended.',
      },
    ]);
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    await waitFor(() => expect(fetchReportExceptionsV4).toHaveBeenCalledWith('rpt-1', 'user-uuid'));
    const panel = screen.getByRole('complementary', { name: /report details/i });
    expect(within(panel).queryByText(/^Exception$/)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/^Reports v4$/)).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Exceptions (2)' }));

    const dialog = await screen.findByRole('dialog', { name: /report exceptions/i });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).getByText('ITEMDIFF')).toBeInTheDocument();
    expect(within(dialog).getByText('Blocking')).toBeInTheDocument();
    expect(within(dialog).getByText('The report total does not match its entries.')).toBeInTheDocument();
    expect(within(dialog).queryByText('expense-1')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /expand details for exception 1/i }));
    expect(within(dialog).getByText('expense-1')).toBeInTheDocument();
    expect(within(dialog).getByText('RECEIPT')).toBeInTheDocument();
    expect(within(dialog).getByText('Warning')).toBeInTheDocument();
    expect(within(dialog).queryByText('AUDITOR')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /expand details for exception 2/i }));
    expect(within(dialog).getByText('AUDITOR')).toBeInTheDocument();
  });

  it('does not call Exceptions v4 when the report header has no exception', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    await waitFor(() => expect(fetchReportV4).toHaveBeenCalled());
    await waitFor(() => expect(fetchReportCommentsV4).toHaveBeenCalledWith('rpt-1'));
    expect(fetchReportExceptionsV4).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Exceptions' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Comments' })).toBeDisabled();
  });

  it('preloads report-header comments, enables the button, and keeps identity metadata collapsed', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportCommentsV4.mockResolvedValue([
      {
        comment: 'Reviewed and approved by Finance.',
        author: { employeeId: 'EMP-42', employeeUuid: 'author-uuid' },
        creationDate: '2026-02-01T11:30:00Z',
        isAuditorComment: true,
        isLatest: true,
        stepInstanceId: 'step-1',
      },
      {
        comment: 'Receipt confirmed.',
        createdForEmployee: { employeeId: 'EMP-7', employeeUuid: 'created-for-uuid' },
        creationDate: '2026-01-31T09:15:00Z',
      },
    ]);
    getUserProfile.mockImplementation((id: string) => Promise.resolve({
      id,
      userName: id === 'author-uuid' ? 'finance@example.com' : 'traveler@example.com',
    }));
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    await waitFor(() => expect(fetchReportCommentsV4).toHaveBeenCalledWith('rpt-1'));
    expect(getUserProfile).toHaveBeenCalledWith('author-uuid');
    expect(getUserProfile).toHaveBeenCalledWith('created-for-uuid');
    const panel = screen.getByRole('complementary', { name: /report details/i });
    await user.click(await within(panel).findByRole('button', { name: 'Comments (2)' }));

    const dialog = await screen.findByRole('dialog', { name: /report header comments/i });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).getByText('Reviewed and approved by Finance.')).toBeInTheDocument();
    expect(within(dialog).getByText('Auditor')).toBeInTheDocument();
    expect(within(dialog).getByText('Latest')).toBeInTheDocument();
    expect(within(dialog).getByText('Receipt confirmed.')).toBeInTheDocument();
    expect(within(dialog).getByText('2026-02-01 11:30')).toBeInTheDocument();
    expect(within(dialog).queryByText('finance@example.com')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /expand metadata for comment 1/i }));
    expect(within(dialog).getByText('finance@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('EMP-42')).toBeInTheDocument();
    expect(within(dialog).getByText('author-uuid')).toBeInTheDocument();
    expect(within(dialog).getByText('step-1')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /expand metadata for comment 2/i }));
    expect(within(dialog).getByText('traveler@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('EMP-7')).toBeInTheDocument();
  });

  it('shows the policy name next to the policy ID when it is cached locally', async () => {
    references.policyNameById.set('policy-1', 'Germany Travel Policy');
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    render(<ReportsView />);
    const user = await searchByLoginId();

    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    await expandReportSection(user, panel, 'Policy & workflow');
    expect(within(panel).getByText('policy-1')).toBeInTheDocument();
    expect(await within(panel).findByText('Germany Travel Policy')).toBeInTheDocument();
    expect(within(panel).getByText('Policy name')).toBeInTheDocument();
  });

  it('shows a letter type code for custom fields in report details', async () => {
    searchReports.mockResolvedValue(reportsResult([{
      ...REPORT1,
      Custom1: { Type: 'List', Value: 'Client A', Code: 'CLIENT-A' },
    }]));
    render(<ReportsView />);
    const user = await searchByLoginId();

    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    await expandReportSection(user, panel, 'Custom fields');
    expect(within(panel).getByText('Custom 1')).toBeInTheDocument();
    expect(within(panel).getByText('L')).toBeInTheDocument();
    expect(within(panel).queryByText('List')).not.toBeInTheDocument();
  });

  it('collapses report detail regions independently while keeping the summary visible', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    const panel = screen.getByRole('complementary', { name: /report details/i });
    const peopleToggle = within(panel).getByRole('button', { name: /collapse people & scope/i });
    const amountsToggle = within(panel).getByRole('button', { name: /expand amounts/i });
    expect(peopleToggle).toHaveAttribute('aria-expanded', 'true');
    expect(amountsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(panel).getByText('jane.doe@example.com')).toBeInTheDocument();
    expect(within(panel).getByText(/1,900\.00 EUR/)).toBeInTheDocument();

    await user.click(peopleToggle);
    expect(peopleToggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(panel).queryByText('jane.doe@example.com')).not.toBeInTheDocument();
    expect(within(panel).getByText(/1,900\.00 EUR/)).toBeInTheDocument();

    await user.click(amountsToggle);
    expect(amountsToggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).getAllByText(/1,900\.00 EUR/)).toHaveLength(2);
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

  it('merges Expenses v4-only fields into matching collapsible entry groups and marks them', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([{ ...ENTRY1, ExchangeRate: 1 }]));
    fetchReportExpensesV4.mockResolvedValue([{
      expenseId: 'EXP-UUID-1',
      businessPurpose: 'Customer workshop',
      exchangeRate: { value: 1, operation: 'MULTIPLY' },
      expenseType: { id: 'HOTEL', name: 'Hotel', code: 'LODGING', isDeleted: false },
      location: { name: 'Berlin', city: 'Berlin', countryCode: 'DE' },
      paymentType: { name: 'Cash', code: 'CASH' },
    }]);
    render(<ReportsView />);
    const user = await searchByLoginId();
    const workspace = await openEntriesDialog(user);

    await waitFor(() => expect(fetchReportExpensesV4).toHaveBeenCalledWith('rpt-1', 'user-uuid'));
    const details = within(workspace).getByRole('group', { name: /entry details/i });
    expect(within(details).queryByRole('button', { name: /additional fields/i })).not.toBeInTheDocument();
    expect(within(details).getByText('Customer workshop')).toBeInTheDocument();
    const city = within(details).getByText('Location · City');
    expect(within(city).getByText('v4')).toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: /expand amounts/i }));
    expect(within(details).getByText('MULTIPLY')).toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: /expand vendor & payment/i }));
    expect(within(details).getByText('Payment type · Code')).toBeInTheDocument();
    expect(within(details).queryByText('Expense type · Name')).not.toBeInTheDocument();
    expect(within(details).queryByText('Payment type · Name')).not.toBeInTheDocument();
    expect(within(workspace).getByRole('button', { name: /back to reports/i })).toHaveClass('bg-blue-50');
  });

  it('marks v3-only entry fields while leaving fields shared with Expenses v4 unmarked', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1]));
    fetchReportExpensesV4.mockResolvedValue([{ expenseId: 'exp-uuid-1', expenseType: { name: 'Hotel' } }]);
    render(<ReportsView />);
    const user = await searchByLoginId();
    const workspace = await openEntriesDialog(user);
    await waitFor(() => expect(fetchReportExpensesV4).toHaveBeenCalled());
    const details = within(workspace).getByRole('group', { name: /entry details/i });
    expect(within(details).queryByLabelText('Expense type name source v3')).not.toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: /expand accounting & controls/i }));
    expect(within(details).getByLabelText('Entry ID source v3')).toHaveClass('text-orange-700');
  });

  it('loads and displays associated attendee details when Expenses v4 reports attendees', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1]));
    fetchReportExpensesV4.mockResolvedValue([{ expenseId: 'exp-uuid-1', attendeeCount: 2 }]);
    fetchExpenseAttendeesV4.mockResolvedValue({
      noShowAttendeeCount: 1,
      attendees: [
        {
          id: 'attendee-1',
          firstName: 'Jane',
          lastName: 'Doe',
          company: 'Bayer',
          attendeeTypeCode: 'BUSGUEST',
          title: 'Director',
          externalId: 'EXT-1',
          custom1: { type: 'Text', value: 'Key account' },
          association: {
            attendeeId: 'attendee-1',
            isTraveling: true,
            transactionAmount: { value: 400, currencyCode: 'EUR' },
          },
        },
        {
          id: 'attendee-2',
          firstName: 'John',
          lastName: 'Smith',
          company: 'Acme',
          attendeeTypeCode: 'EMPLOYEE',
          association: { attendeeId: 'attendee-2' },
        },
      ],
    });
    render(<ReportsView />);
    const user = await searchByLoginId();
    const workspace = await openEntriesDialog(user);

    const attendeesButton = await within(workspace).findByRole('button', { name: 'Attendees (2)' });
    expect(fetchExpenseAttendeesV4).not.toHaveBeenCalled();
    await user.click(attendeesButton);
    await waitFor(() => expect(fetchExpenseAttendeesV4).toHaveBeenCalledWith('rpt-1', 'exp-uuid-1'));

    const dialog = await screen.findByRole('dialog', { name: /expense attendees/i });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(dialog).getByText('Bayer')).toBeInTheDocument();
    expect(within(dialog).getByText('BUSGUEST')).toBeInTheDocument();
    expect(within(dialog).getByText('John Smith')).toBeInTheDocument();
    expect(within(dialog).getByText('No-show attendees: 1')).toBeInTheDocument();
    expect(within(dialog).queryByText('EXT-1')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /expand details for attendee 1/i }));
    expect(within(dialog).getByText('EXT-1')).toBeInTheDocument();
    expect(within(dialog).getByText('400.00 EUR')).toBeInTheDocument();
    expect(within(dialog).getByText('Key account')).toBeInTheDocument();
  });

  it('keeps report list and report detail independently scrollable', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    await user.click(await screen.findByText('Berlin trip'));

    expect(screen.getByLabelText('Scrollable report list')).toHaveClass('overflow-auto');
    expect(screen.getByLabelText('Scrollable report details')).toHaveClass('overflow-auto');
    expect(screen.getByLabelText('Scrollable report list')).not.toBe(screen.getByLabelText('Scrollable report details'));
  });

  it('keeps entry list and entry detail independently scrollable', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1, ENTRY2]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    await openEntriesDialog(user);

    expect(screen.getByRole('separator', { name: /resize entry list and details/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Scrollable entry list')).toHaveClass('overflow-auto');
    expect(screen.getByLabelText('Scrollable entry details')).toHaveClass('overflow-auto');
    expect(screen.getByLabelText('Scrollable entry list')).not.toBe(screen.getByLabelText('Scrollable entry details'));
  });

  it('shows every populated field of a clicked entry and hides empty ones', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1, ENTRY2]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    const dialog = await openEntriesDialog(user);

    await user.click(within(dialog).getByRole('button', { name: /view entry hotel/i }));

    const details = within(dialog).getByRole('group', { name: /entry details/i });
    await user.click(within(details).getByRole('button', { name: /expand amounts/i }));
    await user.click(within(details).getByRole('button', { name: /expand vendor & payment/i }));
    await user.click(within(details).getByRole('button', { name: /expand accounting & controls/i }));
    await user.click(within(details).getByRole('button', { name: /expand custom fields/i }));
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
    const dinnerDetails = within(dialog).getByRole('group', { name: /entry details/i });
    await user.click(within(dinnerDetails).getByRole('button', { name: /expand accounting & controls/i }));
    expect(within(dinnerDetails).getByText('e2')).toBeInTheDocument();
  });

  it('shows a collapsed payload view with all populated Entries v3 fields', async () => {
    const entryWithUnknown = {
      ...ENTRY1,
      NewEntryFlag: true,
      URI: 'https://example.test/entry/e1',
    } as ExpenseEntry & Record<string, unknown>;
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([entryWithUnknown]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    const workspace = await openEntriesDialog(user);

    const details = within(workspace).getByRole('group', { name: /entry details/i });
    const sectionButton = within(details).getByRole('button', { name: /expand all entries v3 fields/i });
    expect(sectionButton).toHaveAttribute('aria-expanded', 'false');
    expect(within(details).getByRole('button', { name: /collapse transaction/i })).toBeInTheDocument();

    await user.click(sectionButton);

    const transactionAmount = within(details).getByLabelText('TransactionAmount source v3');
    expect(transactionAmount).toHaveClass('text-orange-700');
    expect(transactionAmount.nextElementSibling).toHaveTextContent('800');
    expect(within(details).getByLabelText('IsPersonal source v3').nextElementSibling).toHaveTextContent('No');
    expect(within(details).getByLabelText('Custom1 source v3').nextElementSibling).toHaveTextContent(
      '{"Type":"Text","Value":"Cost center 42","Code":"CC42"}',
    );
    expect(within(details).getByLabelText('NewEntryFlag source v3').nextElementSibling).toHaveTextContent('Yes');
    expect(within(details).queryByLabelText('URI source v3')).not.toBeInTheDocument();
  });

  it('resolves payment type, location, and form IDs to names and badges custom field types', async () => {
    references.paymentTypeNameById.set('pt-cash', 'Cash');
    references.locationNameById.set('loc-ber', 'Berlin, Germany');
    references.formNameById.set('form-de', 'German Entry Form');
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([
      {
        ...ENTRY1,
        PaymentTypeID: 'pt-cash',
        LocationID: 'loc-ber',
        FormID: 'form-de',
        URI: 'https://us.api.concursolutions.com/api/v3.0/expense/entries/e1',
      },
    ]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    const dialog = await openEntriesDialog(user);

    await user.click(within(dialog).getByRole('button', { name: /view entry hotel/i }));
    const details = within(dialog).getByRole('group', { name: /entry details/i });
    await user.click(within(details).getByRole('button', { name: /expand vendor & payment/i }));
    await user.click(within(details).getByRole('button', { name: /expand accounting & controls/i }));
    await user.click(within(details).getByRole('button', { name: /expand custom fields/i }));

    expect(within(details).getByText('Payment type ID')).toBeInTheDocument();
    expect(within(details).getByText('pt-cash')).toBeInTheDocument();
    const paymentTypeNameLabel = within(details).getByText('Payment type name');
    expect(paymentTypeNameLabel.nextElementSibling).toHaveTextContent('Cash');
    expect(within(details).getByText('Location ID')).toBeInTheDocument();
    expect(within(details).getByText('Location name')).toBeInTheDocument();
    expect(within(details).getByText('Berlin, Germany')).toBeInTheDocument();
    expect(within(details).getByText('Form ID')).toBeInTheDocument();
    expect(within(details).getByText('Form name')).toBeInTheDocument();
    expect(within(details).getByText('German Entry Form')).toBeInTheDocument();
    // Custom field type renders as a badge next to the label.
    expect(within(details).getByText('T')).toBeInTheDocument();
    expect(within(details).queryByText('Text')).not.toBeInTheDocument();
    // URI/links are hidden.
    expect(within(details).queryByText('URI')).not.toBeInTheDocument();
    expect(within(details).queryByText(/api\/v3\.0\/expense\/entries/)).not.toBeInTheDocument();
  });

  it('returns from the entries workspace and reopens it without refetching', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    const dialog = await openEntriesDialog(user);

    await user.click(within(dialog).getByRole('button', { name: /back to reports/i }));
    expect(screen.queryByRole('region', { name: /expense entries for berlin trip/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view entries \(1\)/i }));
    expect(await screen.findByRole('region', { name: /expense entries for berlin trip/i })).toBeInTheDocument();
    expect(fetchReportEntries).toHaveBeenCalledTimes(1);
  });

  it('clears loaded entries when another report is selected', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1, REPORT2]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1]));
    render(<ReportsView />);
    const user = await searchByLoginId();
    const dialog = await openEntriesDialog(user);
    await user.click(within(dialog).getByRole('button', { name: /back to reports/i }));

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
    expect(screen.queryByRole('region', { name: /expense entries/i })).not.toBeInTheDocument();
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

  it('restores the search parameters and results from the session cache after a page switch', async () => {
    searchReports.mockResolvedValue(reportsResult([REPORT1]));
    fetchReportEntries.mockResolvedValue(entriesResult([ENTRY1]));
    const first = render(<ReportsView />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Login ID'), 'jane');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await user.click(await screen.findByText('Berlin trip'));
    const panel = screen.getByRole('complementary', { name: /report details/i });
    await user.click(within(panel).getByRole('button', { name: /retrieve entries/i }));
    await screen.findByRole('region', { name: /expense entries for berlin trip/i });

    // Simulate a page switch: unmount, then mount again (as App does).
    first.unmount();
    cleanup();
    render(<ReportsView />);

    // The restored session resumes the focused entries workspace.
    const restoredEntries = await screen.findByRole('region', { name: /expense entries for berlin trip/i });
    await user.click(within(restoredEntries).getByRole('button', { name: /back to reports/i }));
    expect(screen.getByLabelText('Login ID')).toHaveValue('jane');
    const table = await screen.findByRole('table', { name: /report search results/i });
    expect(within(table).getByText('Berlin trip')).toBeInTheDocument();
    expect(screen.getByText('1 result')).toBeInTheDocument();
    // No new search was fired — the result came from the cache.
    expect(searchReports).toHaveBeenCalledTimes(1);
    // The selected report and its entries are restored too.
    const restoredPanel = screen.getByRole('complementary', { name: /report details/i });
    expect(within(restoredPanel).getByRole('heading', { name: 'Berlin trip' })).toBeInTheDocument();
    expect(within(restoredPanel).getByRole('button', { name: /view entries \(1\)/i })).toBeInTheDocument();
  });
});
