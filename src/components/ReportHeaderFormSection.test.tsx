import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLinkedReportValue, fetchReportFormFields } from '../api/reportFormFieldsApi';
import { ReportHeaderFormSection } from './ReportHeaderFormSection';

vi.mock('../api/reportFormFieldsApi', () => ({ fetchReportFormFields: vi.fn(), fetchLinkedReportValue: vi.fn() }));
const report = { ID: 'r-1', Name: 'Customer visit', OwnerName: 'Sample Employee' };
const form = [
  { fieldId: 'OrgUnit2', fieldName: 'Cost Center', fieldSequence: 2, fieldAccess: 'HD', isRequired: true, maximumLength: 0, tooltip: null },
  { fieldId: 'Name', fieldName: 'Report Name', fieldSequence: 1, isRequired: true, fieldAccess: 'RW' },
  { fieldId: 'EmpName', fieldName: 'Employee Name', fieldSequence: 3, fieldAccess: 'HD' },
];

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('report header form section', () => {
  it('shows the existing report values with required and hidden styling, linked lookup, and an on-demand properties popup', async () => {
    vi.mocked(fetchReportFormFields).mockResolvedValue(form);
    vi.mocked(fetchLinkedReportValue).mockResolvedValue('Operations – Boston');
    render(<ReportHeaderFormSection report={report} reportV4={{ name: 'V4 customer visit', customData: [{ id: 'orgUnit2', value: 'opaque-id', listItemUrl: 'https://us.api.concursolutions.com/list/v4/items/opaque-id' }] }} entityId="us-uat" />);
    const section = screen.getByRole('region', { name: 'Report header form' });
    expect(await within(section).findByText('V4 customer visit')).toBeVisible();
    expect(within(section).getAllByLabelText('required')).toHaveLength(2);
    expect(await within(section).findByText('Operations – Boston')).toBeVisible();
    expect(fetchLinkedReportValue).toHaveBeenCalledWith('https://us.api.concursolutions.com/list/v4/items/opaque-id', 'us-uat', expect.any(AbortSignal));
    expect(within(section).queryByText('opaque-id')).not.toBeInTheDocument();
    const costValue = within(section).getByText('Operations – Boston').closest('dd');
    expect(costValue).toHaveClass('bg-muted');
    fireEvent.click(within(section).getByRole('button', { name: 'Properties for Cost Center' }));
    const popup = screen.getByRole('dialog', { name: 'Cost Center properties' });
    expect(within(popup).getByText('fieldAccess')).toBeVisible();
    expect(within(popup).getByText('0')).toBeVisible();
    expect(within(popup).queryByText('tooltip')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a retryable error when a linked resource fails', async () => {
    vi.mocked(fetchReportFormFields).mockResolvedValue(form);
    vi.mocked(fetchLinkedReportValue).mockRejectedValueOnce(new Error('HTTP 403')).mockResolvedValueOnce('Resolved center');
    render(<ReportHeaderFormSection report={report} reportV4={{ customData: [{ id: 'orgUnit2', value: 'opaque-id', listItemUrl: 'https://us.api.concursolutions.com/list/v4/items/opaque-id' }] }} entityId="us-uat" />);
    expect(await screen.findByText('Value unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Resolved center')).toBeVisible();
  });

  it('aborts stale form retrieval and retries a failed form request', async () => {
    let resolveOld!: (fields: typeof form) => void;
    vi.mocked(fetchReportFormFields).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockRejectedValueOnce(new Error('HTTP 403')).mockResolvedValueOnce(form);
    const view = render(<ReportHeaderFormSection report={report} reportV4={null} entityId="us-uat" />);
    const signal = vi.mocked(fetchReportFormFields).mock.calls[0][2];
    view.rerender(<ReportHeaderFormSection report={{ ID: 'r-2', Name: 'Second report' }} reportV4={null} entityId="eu-uat" />);
    expect(signal?.aborted).toBe(true);
    resolveOld(form);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Second report')).toBeVisible());
  });
});
