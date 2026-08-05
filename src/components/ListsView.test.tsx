import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(inspect).toHaveClass('h-7', 'w-7', 'px-0');
    expect(inspect).toHaveAttribute('aria-expanded', 'false');
    await user.click(inspect);
    expect(inspect).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Item tree')).toBeInTheDocument();
  });
});
