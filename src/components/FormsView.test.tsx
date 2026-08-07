import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormsSnapshot } from '../types';
import { FormsView } from './FormsView';

const { getFormsSnapshot, refreshForms } = vi.hoisted(() => ({
  getFormsSnapshot: vi.fn(),
  refreshForms: vi.fn(),
}));

vi.mock('../api/formsApi', () => ({
  getFormsSnapshot,
  refreshForms,
}));

vi.mock('../api/listsApi', () => ({
  timeAgo: () => 'just now',
}));

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
      forms: [
        {
          name: 'Default Entry',
          formId: 'entry-1',
          fields: [
            { id: 'Amount', label: 'Amount', controlType: 'edit', dataType: 'MONEY', required: true, access: 'RW', sequence: 1 },
          ],
        },
      ],
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

  it('renders the cached hierarchy as tinted collapsible sections', async () => {
    const user = userEvent.setup();
    render(<FormsView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /expense report header/i })).toBeInTheDocument());
    const typeToggle = screen.getByRole('button', { name: /expense report header/i });
    expect(typeToggle).toHaveAttribute('aria-expanded', 'false');
    expect(typeToggle).toHaveTextContent('2 forms · 2 fields');

    // Forms appear after expanding the type; fields after expanding the form.
    expect(screen.queryByText('Default Report Information')).not.toBeInTheDocument();
    await user.click(typeToggle);
    const formToggle = screen.getByRole('button', { name: /default report information/i });
    expect(formToggle).toHaveTextContent('2 fields');
    await user.click(formToggle);

    const fieldsTable = screen.getByRole('table', { name: /fields for default report information/i });
    expect(within(fieldsTable).getByText('ReportName')).toBeInTheDocument();
    expect(within(fieldsTable).getByText('CostObject')).toBeInTheDocument();
    expect(within(fieldsTable).getByText('picklist')).toBeInTheDocument();

    // Per-form crawl errors are flagged on the collapsed row and detailed when expanded.
    const failedForm = screen.getByRole('button', { name: /central reconciliation report/i });
    expect(failedForm).toHaveTextContent('Error');
    await user.click(failedForm);
    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument();
  });

  it('shows an empty state and fetches on demand with progress', async () => {
    const user = userEvent.setup();
    getFormsSnapshot.mockReset();
    getFormsSnapshot.mockResolvedValueOnce(null).mockResolvedValue(snapshot);
    let handlers: { onProgress?: (p: unknown) => void; onDone?: (s: unknown) => void; onError?: (m: string) => void } = {};
    refreshForms.mockImplementation((h: typeof handlers) => {
      handlers = h;
      return Promise.resolve();
    });

    render(<FormsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fetch from Concur' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /expense report header/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fetch from Concur' }));
    expect(refreshForms).toHaveBeenCalledTimes(1);

    handlers.onProgress?.({ phase: 'form', formName: 'Default Report Information', formsFetched: 1, formsTotal: 3 });
    await waitFor(() => expect(screen.getByText(/1\/3 forms/)).toBeInTheDocument());

    handlers.onDone?.({ types: 2, forms: 3, fields: 3, failed: 0 });
    await waitFor(() => expect(screen.getByRole('button', { name: /expense report header/i })).toBeInTheDocument());
    expect(getFormsSnapshot).toHaveBeenCalledTimes(2);
  });

  it('filters across levels and shows descendant match context', async () => {
    const user = userEvent.setup();
    render(<FormsView />);
    await waitFor(() => expect(screen.getByLabelText('Search forms and fields')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Search forms and fields'), 'costobject');

    // The non-matching type is hidden; the matching type auto-opens with context.
    expect(screen.queryByRole('button', { name: /expense entry/i })).not.toBeInTheDocument();
    const typeToggle = screen.getByRole('button', { name: /expense report header/i });
    expect(typeToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/matched in form: default report information/i)).toBeInTheDocument();

    const fieldsTable = screen.getByRole('table', { name: /fields for default report information/i });
    expect(within(fieldsTable).getByText('CostObject')).toBeInTheDocument();
    expect(within(fieldsTable).queryByText('ReportName')).not.toBeInTheDocument();
  });

  it('caps very large form lists and points to search', async () => {
    const user = userEvent.setup();
    const manyForms = Array.from({ length: 105 }, (_, i) => ({ name: `Form ${i}`, formId: `f-${i}`, fields: [] }));
    getFormsSnapshot.mockResolvedValue({
      retrievedAt: '2026-08-07T00:00:00.000Z',
      formTypes: [{ name: 'Expense Entry', formCode: 'ENTRYINFO', forms: manyForms }],
    });

    render(<FormsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: /expense entry/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /expense entry/i }));

    expect(screen.getByText('Form 99')).toBeInTheDocument();
    expect(screen.queryByText('Form 100')).not.toBeInTheDocument();
    expect(screen.getByText(/and 5 more forms/)).toBeInTheDocument();

    // Searching lifts the cap for matching forms.
    await user.type(screen.getByLabelText('Search forms and fields'), 'form 104');
    expect(screen.getByText('Form 104')).toBeInTheDocument();
  });

  it('sorts form fields by label, id, control, and type', async () => {
    const user = userEvent.setup();
    render(<FormsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: /expense report header/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /expense report header/i }));
    await user.click(screen.getByRole('button', { name: /default report information/i }));

    const fieldsTable = screen.getByRole('table', { name: /fields for default report information/i });
    const columnValues = (colIndex: number) =>
      within(fieldsTable)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[colIndex].textContent);

    // Default order follows the form's sequence numbers (ReportName=1, Custom17=10).
    expect(columnValues(1)).toEqual(['ReportName', 'CostObject']);

    await user.click(within(fieldsTable).getByRole('button', { name: /label/i }));
    expect(columnValues(1)).toEqual(['CostObject', 'ReportName']);
    await user.click(within(fieldsTable).getByRole('button', { name: /label/i }));
    expect(columnValues(1)).toEqual(['ReportName', 'CostObject']);

    await user.click(within(fieldsTable).getByRole('button', { name: /^id/i }));
    expect(columnValues(2)).toEqual(['Custom17', 'Name']);

    await user.click(within(fieldsTable).getByRole('button', { name: /control/i }));
    expect(columnValues(3)).toEqual(['edit', 'picklist']);

    await user.click(within(fieldsTable).getByRole('button', { name: /^type/i }));
    expect(columnValues(4)).toEqual(['LIST', 'VARCHAR']);

    // The active column header exposes its direction to assistive tech.
    expect(within(fieldsTable).getByRole('columnheader', { name: /type/i })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('surfaces refresh errors without crashing', async () => {
    const user = userEvent.setup();
    getFormsSnapshot.mockReset();
    getFormsSnapshot.mockResolvedValue(null);
    refreshForms.mockImplementation((h: { onError?: (m: string) => void }) => {
      h.onError?.('token expired');
      return Promise.resolve();
    });

    render(<FormsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fetch from Concur' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Fetch from Concur' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('token expired');
  });
});
