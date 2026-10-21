import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCategoryNavigationRequest,
  peekReportSearch,
  resetViewNavigation,
  subscribeViewNavigation,
  takeReportSearch,
} from '../state/viewNavigation';
import { UserReportsButton } from './UserReportsButton';

beforeEach(() => resetViewNavigation());
afterEach(cleanup);

describe('UserReportsButton', () => {
  it('queues a report search for the user and asks the shell to open Expense Reports', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeViewNavigation(listener);
    render(<UserReportsButton loginId=" henry.gu@example.com " />);

    fireEvent.click(screen.getByRole('button', { name: 'Search expense reports for henry.gu@example.com' }));

    expect(peekReportSearch()).toEqual({ loginId: 'henry.gu@example.com' });
    expect(getCategoryNavigationRequest()?.categoryId).toBe('reports');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('notifies on every request so navigating back to reports re-runs', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeViewNavigation(listener);
    render(<UserReportsButton loginId="henry.gu@example.com" />);
    const button = screen.getByRole('button', { name: /Search expense reports/ });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(getCategoryNavigationRequest()?.seq).toBe(2);
    unsubscribe();
  });

  it('renders nothing when the profile has no login ID', () => {
    const { container } = render(<UserReportsButton loginId={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves the queued search unclaimed when peeked, and claims it once', () => {
    render(<UserReportsButton loginId="henry.gu@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: /Search expense reports/ }));

    expect(peekReportSearch()?.loginId).toBe('henry.gu@example.com');
    expect(takeReportSearch()?.loginId).toBe('henry.gu@example.com');
    expect(takeReportSearch()).toBeNull();
  });
});