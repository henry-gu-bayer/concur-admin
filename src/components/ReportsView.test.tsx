import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customFieldTypeCode, ReportsView } from './ReportsView';
import type { EntriesResult, ExpenseEntry, ExpenseReport, ReportSearchResult } from '../types';

const {
  searchReports,
  fetchAllReports,
  fetchReportEntries,
  fetchReportById,
  fetchReportV4,
  fetchReportExceptionsV4,
  fetchReportCommentsV4,
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
  fetchReportV4: vi.fn(),
  fetchReportExceptionsV4: vi.fn(),
  fetchReportCommentsV4: vi.fn(),
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
  fetchReportV4,
  fetchReportExceptionsV4,
  fetchReportCommentsV4,
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
    expect(['Boolean', 'Connected List', 'Date', 'Integer', 'List', 'Number', 'Text'].map(customFieldTypeCode))
      .toEqual(['B', 'C', 'D', 'I', 'L', 'N', 'T']);
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
    expect(screen.queryByLabelText('Created from')).not.toBeInTheDocument();

    const dialog = await openAdvancedDialog(user);
    expect(within(dialog).getByLabelText('Approval status')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Payment status')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Country/Region')).toBeInTheDocument();
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
    fireEvent.change(within(dialog).getByLabelText('Created from'), { target: { value: '2026-01-01' } });
    await user.click(within(dialog).getByRole('button', { name: /^done$/i }));

    const filters = screen.getByLabelText('Active advanced search filters');
    expect(within(filters).getByText(/Approval:/)).toBeInTheDocument();
    expect(within(filters).getByText('Approved')).toBeInTheDocument();
    expect(within(filters).getByText(/Country:/)).toBeInTheDocument();
    expect(within(filters).getByText(/Germany \(DE\)/)).toBeInTheDocument();
    expect(within(filters).getByText(/Created from:/)).toBeInTheDocument();
    expect(within(filters).getByText('2026-01-01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advanced search (3)' })).toBeInTheDocument();

    await user.click(within(filters).getByRole('button', { name: 'Remove Country filter' }));
    expect(within(filters).queryByText(/Germany \(DE\)/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advanced search (2)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(searchReports).toHaveBeenCalledWith({
      approvalStatusCode: 'A_APPR',
      createdAfter: '2026-01-01',
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

  it('retrieves a report directly by report ID and selects it', async () => {
    const user = userEvent.setup();
    fetchReportById.mockResolvedValue(REPORT1);
    render(<ReportsView />);

    await user.type(screen.getByLabelText('Login ID'), 'jane.doe@example.com');
    await user.type(screen.getByLabelText('Report ID'), '  rpt-1  ');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(fetchReportById).toHaveBeenCalledWith('rpt-1', 'jane.doe@example.com'));
    expect(searchReports).not.toHaveBeenCalled();
    expect(await screen.findByText('1 result')).toBeInTheDocument();

    // The single report is auto-selected, showing its header details.
    const panel = screen.getByRole('complementary', { name: /report details/i });
    expect(within(panel).getByRole('heading', { name: 'Berlin trip' })).toBeInTheDocument();
    expect(within(panel).getByText('rpt-1')).toBeInTheDocument();
  });

  it('requires the owner login ID before searching by report ID', async () => {
    const user = userEvent.setup();
    render(<ReportsView />);

    await user.type(screen.getByLabelText('Report ID'), 'rpt-1');
    const searchButton = screen.getByRole('button', { name: /^search$/i });
    expect(searchButton).toBeDisabled();
    expect(screen.getByLabelText('Login ID')).toHaveAttribute(
      'placeholder',
      expect.stringContaining('required'),
    );

    // Once the login ID is provided, the search goes through.
    fetchReportById.mockResolvedValue(REPORT1);
    await user.type(screen.getByLabelText('Login ID'), 'jane.doe@example.com');
    expect(searchButton).toBeEnabled();
    await user.click(searchButton);
    await waitFor(() => expect(fetchReportById).toHaveBeenCalledWith('rpt-1', 'jane.doe@example.com'));
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

  it('enriches a selected v3 report with non-empty Reports v4-only fields in blue', async () => {
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
    const customToggle = within(panel).getByRole('button', { name: /expand custom fields/i });
    const additionalToggle = within(panel).getByRole('button', { name: /expand additional fields/i });
    expect(customToggle.compareDocumentPosition(additionalToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expandReportSection(user, panel, 'Additional fields');
    const v4Fields = await within(panel).findByLabelText('Reports v4 additional fields');
    expect(within(panel).getByText('Reports v4 only')).toHaveClass('text-blue-700');
    expect(within(v4Fields).getByText('Business purpose')).toHaveClass('text-blue-700');
    expect(within(v4Fields).getByText('Customer workshop')).toHaveClass('text-blue-950');
    expect(within(v4Fields).getByText('Report type')).toBeInTheDocument();
    expect(within(v4Fields).getByText('Can reopen')).toBeInTheDocument();
    expect(within(v4Fields).getByText('No')).toBeInTheDocument();
    expect(within(v4Fields).getByText('250.00 EUR')).toBeInTheDocument();
    expect(within(v4Fields).getByText('ledger-v4')).toBeInTheDocument();
    expect(within(v4Fields).getByText('Only in Reports v4')).toBeInTheDocument();
    expect(within(v4Fields).queryByText('Report total')).not.toBeInTheDocument();
    expect(within(v4Fields).queryByText('1,900.00 EUR')).not.toBeInTheDocument();
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
    expect(within(panel).queryByLabelText('Reports v4 additional fields')).not.toBeInTheDocument();
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
    expect(within(dialog).getByText('expense-1')).toBeInTheDocument();
    expect(within(dialog).getByText('RECEIPT')).toBeInTheDocument();
    expect(within(dialog).getByText('Warning')).toBeInTheDocument();
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
