import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiLogsView, formatLogDateTime, formatResponsePayload } from './ApiLogsView';

const { getLogFiles, getLogEntries } = vi.hoisted(() => ({
  getLogFiles: vi.fn(),
  getLogEntries: vi.fn(),
}));

vi.mock('../api/apiLogsApi', () => ({ getLogFiles, getLogEntries }));

describe('ApiLogsView', () => {
  afterEach(cleanup);

  beforeEach(() => {
    getLogFiles.mockResolvedValue([{ name: 'api.log', size: 128, modifiedAt: '2026-08-05T10:00:00.000Z' }]);
    getLogEntries.mockResolvedValue([
      {
        requestDateTime: '2026-08-05T10:00:00.000Z',
        method: 'GET',
        url: 'https://api.concursolutions.com/expense/v4/expensegroups',
        responseStatus: 200,
        responseTimeMs: 184,
        correlationId: 'corr-1',
        responseBody: '{"Items":[{"Name":"Bayer Corporate"}]}',
      },
    ]);
  });

  it('filters compact rows and shows the selected response payload beside them', async () => {
    const user = userEvent.setup();
    render(<ApiLogsView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /expensegroups/i })).toBeInTheDocument());
    expect(screen.getByText('184ms')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by status')).toHaveClass('w-20');
    expect(screen.getByLabelText('Select log file')).toHaveClass('w-20');

    expect(screen.getByLabelText('Selected API log response').tagName).toBe('ASIDE');
    expect(screen.getByText(/"Bayer Corporate"/)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Filter API logs' }), 'not-found');
    expect(screen.queryByRole('button', { name: /expensegroups/i })).not.toBeInTheDocument();
  });

  it('formats XML response payloads for readable inspection', () => {
    expect(formatResponsePayload('<root><item>value</item></root>')).toContain('\n');
  });

  it('formats log timestamps as MM-DD HH:MM:SS', () => {
    expect(formatLogDateTime('2026-08-05T10:00:00.000Z')).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('uses a side-by-side payload inspector on wide screens', async () => {
    render(<ApiLogsView />);

    await waitFor(() => expect(screen.getByLabelText('Selected API log response').tagName).toBe('ASIDE'));
    expect(screen.getByRole('separator', { name: 'Resize log panes' })).toBeInTheDocument();
  });
});
