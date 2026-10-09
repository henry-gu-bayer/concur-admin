import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportFormFieldsModal } from './ReportFormFieldsModal';
import { fetchReportFormFields, ReportFormField } from '../api/reportFormFieldsApi';

vi.mock('../api/reportFormFieldsApi', () => ({ fetchReportFormFields: vi.fn() }));
const report = { ID: 'rpt-1', Name: 'Client visit', PolicyID: 'policy-1' };
const fields: ReportFormField[] = [
  { fieldSequence: 2, fieldName: 'Report ID', fieldId: 'ReportId', fieldAccess: 'RO', formFieldId: 'form-field-2' },
  { fieldSequence: 1, fieldName: 'Report Name', fieldId: 'Name', controlType: 'Edit', dataType: 'String', fieldAccess: 'RW', isRequired: false, maximumLength: 0, formFieldId: 'form-field-1', isCopyDownSource: false, defaultValue: '', tooltip: null, futureAttribute: { code: 'extra' } },
];
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('header form fields popup', () => {
  it('retrieves for the report, displays sorted summaries, and expands all non-null attributes', async () => {
    vi.mocked(fetchReportFormFields).mockResolvedValue(fields);
    render(<ReportFormFieldsModal report={report} entityId="us-uat" onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Retrieving');
    const table = await screen.findByRole('table', { name: 'Report header form fields' });
    expect(fetchReportFormFields).toHaveBeenCalledWith('rpt-1', 'us-uat', expect.any(AbortSignal));
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Report Name');
    expect(within(rows[1]).getByText('false')).toBeVisible();
    expect(within(rows[1]).getByText('0')).toBeVisible();
    expect(screen.getByText('form-field-1')).toBeVisible();
    expect(screen.getByText('isCopyDownSource')).toBeVisible();
    expect(screen.getByText('""')).toBeVisible();
    expect(screen.getByText(/"code": "extra"/)).toBeVisible();
    expect(screen.queryByText('tooltip')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Attributes for Report ID' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByText('form-field-2')).toBeVisible();
    fireEvent.click(toggle);
    expect(screen.queryByText('form-field-2')).not.toBeInTheDocument();
  });

  it('filters across attributes and preserves expansion when filtering', async () => {
    vi.mocked(fetchReportFormFields).mockResolvedValue(fields);
    render(<ReportFormFieldsModal report={report} entityId="us-uat" onClose={vi.fn()} />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'extra' } });
    expect(screen.queryByText('Report ID')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 fields')).toBeVisible();
    expect(screen.getByText('form-field-1')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'no matching field' } });
    expect(screen.getByRole('status')).toHaveTextContent('No fields match');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(screen.getByText('2 of 2 fields')).toBeVisible();
  });

  it('shows errors with retry and distinguishes an empty response', async () => {
    vi.mocked(fetchReportFormFields).mockRejectedValueOnce(new Error('HTTP 403')).mockResolvedValueOnce([]);
    render(<ReportFormFieldsModal report={report} entityId="us-uat" onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Concur returned no header form fields'));
    expect(fetchReportFormFields).toHaveBeenCalledTimes(2);
  });

  it('aborts stale requests on report changes and does not display their results', async () => {
    let resolveOld!: (fields: ReportFormField[]) => void;
    vi.mocked(fetchReportFormFields).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce([{ fieldName: 'New report field' }]);
    const view = render(<ReportFormFieldsModal report={report} entityId="us-uat" onClose={vi.fn()} />);
    const oldSignal = vi.mocked(fetchReportFormFields).mock.calls[0][2];
    view.rerender(<ReportFormFieldsModal report={{ ID: 'rpt-2' }} entityId="eu-uat" onClose={vi.fn()} />);
    expect(oldSignal?.aborted).toBe(true);
    await screen.findByText('New report field');
    resolveOld(fields);
    await waitFor(() => expect(screen.queryByText('Report Name')).not.toBeInTheDocument());
    view.unmount();
    expect(vi.mocked(fetchReportFormFields).mock.calls[1][2]?.aborted).toBe(true);
  });

  it('supports closing with Escape', () => {
    vi.mocked(fetchReportFormFields).mockReturnValue(new Promise(() => {}));
    const close = vi.fn();
    render(<ReportFormFieldsModal report={report} entityId="us-uat" onClose={close} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});
