import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiLogsView, formatLogDateTime, formatResponsePayload, formatRequestParams, formatRequestPayload } from './ApiLogsView';

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
        method: 'POST',
        url: 'https://api.concursolutions.com/expense/v4/expensegroups?countryCode=CN&subdivisionCode=CN-SH',
        requestParams: '{"includeInactive":false,"limit":100}',
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
    expect(screen.getByRole('button', { name: /request parameters/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/"countryCode": "CN"/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request payload/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/"includeInactive": false/)).toBeInTheDocument();
    expect(screen.getByText(/"Bayer Corporate"/)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Filter API logs' }), 'not-found');
    expect(screen.queryByRole('button', { name: /expensegroups/i })).not.toBeInTheDocument();
  });

  it('formats XML response payloads for readable inspection', () => {
    expect(formatResponsePayload('<root><item>value</item></root>')).toContain('\n');
  });

  it('formats request query parameters and request payloads for readable inspection', () => {
    expect(formatRequestParams('https://api.example.test/path?countryCode=CN&limit=100')).toContain('"countryCode": "CN"');
    expect(formatRequestPayload('{"filter":{"active":true}}')).toContain('"active": true');
    expect(formatRequestPayload('countryCode=CN&client_secret=***')).toContain('"countryCode": "CN"');
  });

  it('masks sensitive request query parameters', () => {
    const formatted = formatRequestParams(
      'https://api.example.test/path?countryCode=CN&access_token=visible-token&client_secret=visible-secret'
    );

    expect(formatted).toContain('"countryCode": "CN"');
    expect(formatted).toContain('"access_token": "***"');
    expect(formatted).toContain('"client_secret": "***"');
    expect(formatted).not.toContain('visible-token');
    expect(formatted).not.toContain('visible-secret');
  });

  it('formats log timestamps as MM-DD HH:MM:SS', () => {
    expect(formatLogDateTime('2026-08-05T10:00:00.000Z')).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('uses a side-by-side payload inspector on wide screens', async () => {
    render(<ApiLogsView />);

    await waitFor(() => expect(screen.getByLabelText('Selected API log response').tagName).toBe('ASIDE'));
    expect(screen.getByRole('separator', { name: 'Resize log panes' })).toBeInTheDocument();
  });

  it('keeps the log list scroll separate from request/response details', async () => {
    render(<ApiLogsView />);

    const listScroller = await screen.findByLabelText('API log entries list');
    const detailScroller = await screen.findByLabelText('API log request and response details');

    expect(listScroller).toHaveClass('overflow-auto');
    expect(detailScroller).toHaveClass('overflow-auto');
    expect(listScroller).not.toBe(detailScroller);
  });

  it('allows every payload section to scroll long unbroken values horizontally', async () => {
    render(<ApiLogsView />);

    const details = await screen.findByLabelText('API log request and response details');
    const payloads = details.querySelectorAll('pre');

    expect(payloads).toHaveLength(3);
    for (const payload of payloads) expect(payload).toHaveClass('overflow-x-auto', 'whitespace-pre');
  });
});
