import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListsView } from './ListsView';

const { getLists, getItemsIndex } = vi.hoisted(() => ({
  getLists: vi.fn(),
  getItemsIndex: vi.fn(),
}));

vi.mock('../api/listsApi', () => ({
  getLists,
  listName: (list: { name?: string; id: string }) => list.name ?? list.id,
  refreshLists: vi.fn(),
  timeAgo: () => 'just now',
}));

vi.mock('../api/listItemsApi', () => ({
  getItemsIndex,
  refreshListItems: vi.fn(),
}));

vi.mock('./ItemTree', () => ({
  ItemTree: () => <div>Item tree</div>,
}));

describe('ListsView table actions', () => {
  afterEach(cleanup);

  beforeEach(() => {
    getLists.mockResolvedValue({
      retrievedAt: '2026-08-04T00:00:00.000Z',
      count: 1,
      lists: [{ id: 'list-42', name: 'Cost centers', levelCount: 3 }],
    });
    getItemsIndex.mockResolvedValue({ lists: {} });
  });

  it('uses a leading icon-only inspector to expand list items', async () => {
    const user = userEvent.setup();
    render(<ListsView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /name/i })).toBeInTheDocument());

    const nameSort = screen.getByRole('button', { name: /name/i });
    expect(nameSort).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(screen.queryByText('list-42')).not.toBeInTheDocument();
    expect(screen.getByText('Cost centers').closest('td')).toHaveClass('py-1.5');
    const search = screen.getByRole('textbox', { name: 'Search lists' });
    expect(screen.getByLabelText('Filter by level count').parentElement).toBe(search.parentElement?.parentElement);

    const inspect = screen.getByRole('button', { name: 'Inspect list items' });
    expect(inspect).toHaveClass('h-7', 'w-7', 'p-0');
    expect(inspect).not.toHaveClass('h-8', 'px-3');
    expect(inspect.querySelector('svg')).toHaveClass('shrink-0');
    expect(inspect).toHaveAttribute('aria-expanded', 'false');
    await user.click(inspect);
    expect(inspect).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Item tree')).toBeInTheDocument();
  });

  it('tints the expanded panel by list category', async () => {
    const user = userEvent.setup();
    getLists.mockResolvedValue({
      retrievedAt: '2026-08-04T00:00:00.000Z',
      count: 2,
      lists: [
        { id: 'list-1', name: 'Cost centers', levelCount: 3, category: { id: 'cat-1', type: 'Normal' } },
        { id: 'list-2', name: 'Vendors', levelCount: 2, category: { id: 'cat-2', type: 'Connected' } },
      ],
    });
    render(<ListsView />);

    await waitFor(() => expect(screen.getByText('Vendors')).toBeInTheDocument());

    // Connected list: sky-tinted panel.
    const vendorsRow = screen.getByText('Vendors').closest('tr');
    expect(vendorsRow).not.toBeNull();
    await user.click(within(vendorsRow as HTMLElement).getByRole('button', { name: 'Inspect list items' }));
    expect(screen.getByText('Item tree').closest('td')).toHaveClass('bg-sky-50/70');

    // Normal list: panel stays neutral.
    const costRow = screen.getByText('Cost centers').closest('tr');
    expect(costRow).not.toBeNull();
    await user.click(within(costRow as HTMLElement).getByRole('button', { name: 'Inspect list items' }));
    const panels = screen.getAllByText('Item tree');
    expect(panels[panels.length - 1].closest('td')).toHaveClass('bg-muted/40');
  });
});
