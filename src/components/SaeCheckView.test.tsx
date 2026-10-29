import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaeCheckResponse } from '../api/saeCheckApi';
import { saeCheckViewSessions } from './saeCheckSessionCache';
import { SaeCheckView } from './SaeCheckView';

const { checkSaeFiles } = vi.hoisted(() => ({ checkSaeFiles: vi.fn() }));
vi.mock('../api/saeCheckApi', () => ({ checkSaeFiles }));

const response: SaeCheckResponse = {
  target: 'C:\\sae',
  kind: 'directory',
  checkedAt: '2026-10-29T04:00:00.000Z',
  skipped: [],
  crossFile: [{ rule: 'X-02', severity: 'warning', title: 'Report repeated', message: 'Report ID R1 appears in 2 files.', files: ['a.txt', 'b.txt'] }],
  files: [
    {
      name: 'a.txt', path: 'C:\\sae\\a.txt', size: 2048, version: 'V2',
      header: { batchDate: '2026-10-15', recordCount: '2', journalTotal: '500.0000' },
      batchId: '4943', detailRows: 2, reportCount: 1, computedJournalTotal: '500.0000', errors: 1, warnings: 0,
      rules: [{
        rule: 'R-03', title: 'Journal amount has journal key, account code, and DR/CR', severity: 'error', errors: 1, warnings: 0,
        findings: [{ rule: 'R-03', severity: 'error', line: 3, sequence: '2', column: 167, columnName: 'Journal Account Code', value: '+45.0000', reportId: 'RPT-1', message: 'Non-zero journal amount has no Account Code (payer JPVAT → payee Company).' }],
      }],
    },
    {
      name: 'b.txt', path: 'C:\\sae\\b.txt', size: 1024, version: 'V3',
      header: { batchDate: '2026-10-16', recordCount: '1', journalTotal: '0.0000', batchId: '4944' },
      batchId: '4944', detailRows: 1, reportCount: 1, errors: 0, warnings: 0, rules: [],
    },
  ],
};

describe('SaeCheckView', () => {
  beforeEach(() => {
    saeCheckViewSessions.clear();
    checkSaeFiles.mockReset();
  });
  afterEach(cleanup);

  it('checks the entered path and lists each file with its status', async () => {
    checkSaeFiles.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<SaeCheckView />);

    expect(screen.getByText('No SAE files checked yet')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'SAE file or folder path' }), 'C:\\sae');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(checkSaeFiles).toHaveBeenCalledWith('C:\\sae');
    const table = await screen.findByRole('table', { name: 'SAE file check results' });
    expect(within(table).getByText('a.txt')).toBeInTheDocument();
    expect(within(table).getByText('1 errors')).toBeInTheDocument();
    expect(within(table).getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText(/2 files · 1 errors · 1 warnings/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cross-file findings' })).toHaveTextContent('Report ID R1 appears in 2 files.');
  });

  it('expands a file to its rule findings and their row locations', async () => {
    checkSaeFiles.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<SaeCheckView />);
    await user.click(screen.getByRole('button', { name: 'Check' }));

    await user.click(await screen.findByRole('button', { name: 'Expand a.txt' }));
    expect(screen.getByText(/checked against SAE V3 columns 1–256/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /R-03/ }));

    const findings = screen.getByRole('table', { name: 'R-03 findings' });
    expect(within(findings).getByText('Journal Account Code')).toBeInTheDocument();
    expect(within(findings).getByText('RPT-1')).toBeInTheDocument();
    expect(within(findings).getByText(/payer JPVAT/)).toBeInTheDocument();
  });

  it('shows the server error with a retry action', async () => {
    checkSaeFiles.mockRejectedValueOnce(new Error('Path not found: C:\\missing')).mockResolvedValueOnce(response);
    const user = userEvent.setup();
    render(<SaeCheckView />);
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Path not found');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'SAE file check results' })).toBeInTheDocument();
  });

  it('keeps the last result when the view remounts', async () => {
    checkSaeFiles.mockResolvedValue(response);
    const user = userEvent.setup();
    const { unmount } = render(<SaeCheckView />);
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByRole('table', { name: 'SAE file check results' });
    unmount();

    render(<SaeCheckView />);
    expect(screen.getByRole('table', { name: 'SAE file check results' })).toBeInTheDocument();
    expect(checkSaeFiles).toHaveBeenCalledTimes(1);
  });
});
