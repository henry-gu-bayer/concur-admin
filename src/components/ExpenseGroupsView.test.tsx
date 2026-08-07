import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseGroupsView } from './ExpenseGroupsView';

const { getExpenseGroups } = vi.hoisted(() => ({
  getExpenseGroups: vi.fn(),
}));

vi.mock('../api/expenseGroupsApi', () => ({
  getExpenseGroups,
  getUserExpenseGroups: vi.fn(),
  refreshExpenseGroups: vi.fn(),
}));

vi.mock('../api/listsApi', () => ({
  timeAgo: () => 'just now',
}));

describe('ExpenseGroupsView inspection', () => {
  afterEach(cleanup);

  beforeEach(() => {
    getExpenseGroups.mockResolvedValue({
      retrievedAt: '2026-08-04T00:00:00.000Z',
      count: 1,
      groups: [
        {
          ID: 'group-1',
          Name: 'Bayer Corporate',
          Policies: [{
            ID: 'policy-1',
            Name: 'Bayer Inheritable',
            IsInheritable: true,
            ExpenseTypes: [{ Code: 'MEALS', Name: 'Meals', ExpenseCode: 'MEAL' }],
          }],
          PaymentTypes: [{ ID: 'payment-1', Name: 'Company card' }],
          AttendeeTypes: [{ Code: 'employee', Name: 'Employee' }],
        },
      ],
    });
  });

  it('defers user lookup and exposes explicit group inspection', async () => {
    const user = userEvent.setup();
    render(<ExpenseGroupsView />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Find by user' })).toBeInTheDocument());
    expect(screen.queryByLabelText('Find by user')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Find by user' }));
    expect(screen.getByLabelText('Find by user')).toBeInTheDocument();

    const inspect = screen.getByRole('button', { name: /inspect/i });
    expect(inspect).toHaveAttribute('aria-expanded', 'false');
    await user.click(inspect);
    expect(inspect).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tab', { name: /expense policies \(1\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /payment types \(1\)/i })).toBeInTheDocument();
  });

  it('shows child-match context and opens the matching collection', async () => {
    const user = userEvent.setup();
    render(<ExpenseGroupsView />);

    await waitFor(() => expect(screen.getByLabelText('Search expense groups')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Search expense groups'), 'company card');

    expect(screen.getByText(/matched in payment type: company card/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /inspect/i }));

    expect(screen.getByRole('tab', { name: /payment types \(1\)/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('table', { name: 'Payment types' })).toBeInTheDocument();
  });

  it('tints the expanded panel and tabs with semantic collection colors', async () => {
    const user = userEvent.setup();
    render(<ExpenseGroupsView />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Inspect group details' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Inspect group details' }));

    const policiesTab = screen.getByRole('tab', { name: /expense policies \(1\)/i });
    const paymentTab = screen.getByRole('tab', { name: /payment types \(1\)/i });
    const attendeeTab = screen.getByRole('tab', { name: /attendee types \(1\)/i });

    // Each collection tab carries its own color dot.
    expect(policiesTab.querySelector('span')).toHaveClass('bg-blue-500');
    expect(paymentTab.querySelector('span')).toHaveClass('bg-emerald-500');
    expect(attendeeTab.querySelector('span')).toHaveClass('bg-violet-500');

    // Policies is the default active collection: blue panel.
    const panel = policiesTab.closest('td');
    expect(policiesTab).toHaveClass('text-blue-700');
    expect(panel).toHaveClass('bg-blue-50/70');

    // Switching tabs recolors the panel and the inner table header.
    await user.click(paymentTab);
    expect(paymentTab).toHaveClass('text-emerald-700');
    expect(panel).toHaveClass('bg-emerald-50/70');
    expect(screen.getByRole('table', { name: 'Payment types' }).querySelector('thead tr')).toHaveClass('bg-emerald-100/70');

    await user.click(attendeeTab);
    expect(attendeeTab).toHaveClass('text-violet-700');
    expect(panel).toHaveClass('bg-violet-50/70');
    expect(screen.getByRole('table', { name: 'Attendee types' }).querySelector('thead tr')).toHaveClass('bg-violet-100/70');
  });

  it('uses a leading icon-only inspector and compact configuration names', async () => {
    const user = userEvent.setup();
    render(<ExpenseGroupsView />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Inspect group details' })).toBeInTheDocument());

    const inspect = screen.getByRole('button', { name: 'Inspect group details' });
    expect(inspect.closest('td')).toBe(inspect.closest('tr')?.querySelector('td'));
    expect(inspect).toHaveClass('h-7', 'w-7', 'p-0');
    expect(inspect).not.toHaveClass('h-8', 'px-3');
    expect(inspect.querySelector('svg')).toHaveClass('shrink-0');
    await user.click(inspect);

    expect(screen.getByText('Bayer Corporate')).toHaveClass('text-xs');
    expect(screen.getByText('Bayer Inheritable')).toHaveClass('text-xs');

    await user.click(screen.getByRole('tab', { name: /payment types/i }));
    expect(screen.getByText('Company card')).toHaveClass('text-xs');

    await user.click(screen.getByRole('tab', { name: /attendee types/i }));
    expect(screen.getByText('Employee')).toHaveClass('text-xs');

    await user.click(screen.getByRole('tab', { name: /expense policies/i }));
    await user.click(screen.getByRole('button', { name: /bayer inheritable/i }));
    expect(screen.getByText('Meals')).toHaveClass('text-xs');
  });
});
