import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormsSnapshot } from '../types';
import { FormsView } from './FormsView';

const { getFormsSnapshot, refreshForms } = vi.hoisted(() => ({
  getFormsSnapshot: vi.fn(),
  refreshForms: vi.fn(),
}));

vi.mock('../api/formsApi', () => ({ getFormsSnapshot, refreshForms }));
vi.mock('../api/listsApi', () => ({ timeAgo: () => 'just now' }));

const snapshot: FormsSnapshot = {
  retrievedAt: '2026-08-07T00:00:00.000Z',
  formTypes: [
    {
      name: 'Expense Report Header',
      formCode: 'RPTINFO',
      forms: [
        {
          name: 'Default Report Information',
          formId: 'nAaT8$puKKO2',
          fields: [
            { id: 'Name', label: 'ReportName', controlType: 'edit', dataType: 'VARCHAR', maxLength: 32, required: true, access: 'RW', sequence: 1 },
            { id: 'Custom17', label: 'CostObject', controlType: 'picklist', dataType: 'LIST', required: false, access: 'RW', custom: true, sequence: 10 },
          ],
        },
        { name: 'Central Reconciliation Report', formId: 'abc123', fields: [], error: 'HTTP 403 — denied' },
      ],
    },
    {
      name: 'Expense Entry',
      formCode: 'ENTRYINFO',
      forms: [{ name: 'Default Entry', formId: 'entry-1', fields: [{ id: 'Amount', label: 'Amount', controlType: 'edit', dataType: 'MONEY', required: true, access: 'RW', sequence: 1 }] }],
    },
  ],
};

describe('FormsView', () => {
  afterEach(cleanup);

  beforeEach(() => {
    getFormsSnapshot.mockReset();
    refreshForms.mockReset();
    getFormsSnapshot.mockResolvedValue(snapshot);
  });

  it('renders a consistent form table and selected field detail', async () => {
    const user = userEvent.setup();
    render(<FormsView />);

    const table = await screen.findByRole('table', { name: 'Forms and fields' });
    expect(screen.getByText('Snapshot ready')).toBeInTheDocument();
    expect(screen.getByText(/3 forms · 3 fields/)).toBeInTheDocument();
    expect(within(table).getAllByText('Expense Report Header')).toHaveLength(2);
    expect(within(table).getByText('Expense Entry')).toBeInTheDocument();

    await user.click(within(table).getByText('Default Report Information'));
    const detail = screen.getByRole('complementary', { name: 'Form details' });
    const fields = within(detail).getByRole('table', { name: /fields for default report information/i });
    expect(within(fields).getByText('ReportName')).toBeInTheDocument();
    expect(within(fields).getByText('CostObject')).toBeInTheDocument();
    expect(within(detail).getAllByText('1').length).toBeGreaterThan(0);

    const selectedRow = within(table).getByText('Default Report Information').closest('tr');
    expect(selectedRow).toHaveAttribute('aria-selected', 'true');
  });

  it('shows an empty state and fetches on demand with progress', async () => {
    const user = userEvent.setup();
    getFormsSnapshot.mockReset();
    getFormsSnapshot.mockResolvedValueOnce(null).mockResolvedValue(snapshot);
    let handlers: { onProgress?: (p: unknown) => void; onDone?: (s: unknown) => void; onError?: (m: string) => void } = {};
    refreshForms.mockImplementation((next: typeof handlers) => { handlers = next; return Promise.resolve(); });

    render(<FormsView />);
    const retrieve = await screen.findByRole('button', { name: 'Retrieve all forms and fields' });
    await user.click(retrieve);
    expect(refreshForms).toHaveBeenCalledTimes(1);

    handlers.onProgress?.({ phase: 'form', formName: 'Default Report Information', formsFetched: 1, formsTotal: 3 });
    await waitFor(() => expect(screen.getByText(/1\/3 forms/)).toBeInTheDocument());
    expect(screen.getByRole('progressbar', { name: 'Forms and fields retrieval progress' })).toHaveAttribute('aria-valuenow', '33');

    handlers.onDone?.({ types: 2, forms: 3, fields: 3, failed: 0 });
    expect(await screen.findByRole('table', { name: 'Forms and fields' })).toBeInTheDocument();
    expect(getFormsSnapshot).toHaveBeenCalledTimes(2);
  });

  it('searches form types, IDs, and nested fields', async () => {
    const user = userEvent.setup();
    render(<FormsView />);
    const search = await screen.findByLabelText('Search forms and fields');

    await user.type(search, 'costobject');
    const table = screen.getByRole('table', { name: 'Forms and fields' });
    expect(within(table).getByText('Default Report Information')).toBeInTheDocument();
    expect(within(table).queryByText('Default Entry')).not.toBeInTheDocument();

    const fields = screen.getByRole('table', { name: /fields for default report information/i });
    expect(within(fields).getByText('CostObject')).toBeInTheDocument();
    expect(within(fields).queryByText('ReportName')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'entry-1');
    expect(within(table).getByText('Default Entry')).toBeInTheDocument();
  });

  it('filters by form type and paginates large result sets', async () => {
    const user = userEvent.setup();
    render(<FormsView />);
    await screen.findByRole('table', { name: 'Forms and fields' });

    await user.selectOptions(screen.getByLabelText('Filter by form type'), 'ENTRYINFO');
    expect(screen.getByText('1 form')).toBeInTheDocument();
    expect(screen.queryByText('Default Report Information')).not.toBeInTheDocument();

    cleanup();
    const manyForms = Array.from({ length: 105 }, (_, index) => ({ name: `Form ${String(index).padStart(3, '0')}`, formId: `f-${index}`, fields: [] }));
    getFormsSnapshot.mockResolvedValue({ retrievedAt: snapshot.retrievedAt, formTypes: [{ name: 'Expense Entry', formCode: 'ENTRYINFO', forms: manyForms }] });
    render(<FormsView />);
    expect(await screen.findByText('105 forms')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('51–100 of 105')).toBeInTheDocument();
  });

  it('sorts form rows and fields', async () => {
    const user = userEvent.setup();
    render(<FormsView />);
    const forms = await screen.findByRole('table', { name: 'Forms and fields' });

    await user.click(within(forms).getByRole('button', { name: 'Fields' }));
    const rowNames = () => within(forms).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(rowNames()[0]).toContain('Central Reconciliation Report');
    expect(rowNames()[2]).toContain('Default Report Information');

    await user.click(within(forms).getByText('Default Report Information'));
    const fields = screen.getByRole('table', { name: /fields for default report information/i });
    const labels = () => within(fields).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[1].textContent);
    expect(labels()).toEqual(['ReportName', 'CostObject']);
    await user.click(within(fields).getByRole('button', { name: 'Label' }));
    expect(labels()).toEqual(['CostObject', 'ReportName']);
    expect(within(fields).getByRole('columnheader', { name: /label/i })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('surfaces form crawl and refresh errors', async () => {
    const user = userEvent.setup();
    render(<FormsView />);
    const table = await screen.findByRole('table', { name: 'Forms and fields' });
    await user.click(within(table).getByText('Central Reconciliation Report'));
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 403');

    cleanup();
    getFormsSnapshot.mockReset();
    getFormsSnapshot.mockResolvedValue(null);
    refreshForms.mockImplementation((handlers: { onError?: (message: string) => void }) => { handlers.onError?.('token expired'); return Promise.resolve(); });
    render(<FormsView />);
    await user.click(await screen.findByRole('button', { name: 'Retrieve all forms and fields' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('token expired');
  });
});
