import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListsView } from './ListsView';
import { resetListsViewSessions } from './listsSessionCache';

const { getLists, getItemsIndex, refreshLists, fetchAllListItems, searchSavedListItems } = vi.hoisted(() => ({
  getLists: vi.fn(),
  getItemsIndex: vi.fn(),
  refreshLists: vi.fn(),
  fetchAllListItems: vi.fn(),
  searchSavedListItems: vi.fn(),
}));

vi.mock('../api/listsApi', () => ({
  getLists,
  listName: (list: { name?: string; id: string }) => list.name ?? list.id,
  refreshLists,
  timeAgo: () => 'just now',
}));

vi.mock('../api/listItemsApi', () => ({
  getItemsIndex,
  fetchAllListItems,
  searchSavedListItems,
}));

vi.mock('./ItemTree', () => ({
  ItemTree: () => <div>Item tree</div>,
}));

describe('ListsView table actions', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    resetListsViewSessions();
    getLists.mockResolvedValue({
      retrievedAt: '2026-08-04T00:00:00.000Z',
      count: 1,
      lists: [{ id: 'list-42', name: 'Cost centers', levelCount: 3 }],
    });
    refreshLists.mockResolvedValue({
      retrievedAt: '2026-08-04T00:00:00.000Z',
      count: 1,
      lists: [{ id: 'list-42', name: 'Cost centers', levelCount: 3 }],
    });
    getItemsIndex.mockResolvedValue({
      lists: {
        'list-42': { listId: 'list-42', count: 12, retrievedAt: '2026-08-04T00:00:00.000Z', truncated: false, maxLevel: 3, complete: true },
        'list-1': { listId: 'list-1', count: 12, retrievedAt: '2026-08-04T00:00:00.000Z', truncated: false, maxLevel: 3, complete: true },
        'list-2': { listId: 'list-2', count: 12, retrievedAt: '2026-08-04T00:00:00.000Z', truncated: false, maxLevel: 3, complete: true },
      },
    });
    fetchAllListItems.mockImplementation(async (_ids: string[], _names: Record<string, string>, handlers: { onDone?: (summary: { total: number; succeeded: number; failed: number; truncated: number }) => void }) => {
      handlers.onDone?.({ total: 1, succeeded: 1, failed: 0, truncated: 0 });
    });
    searchSavedListItems.mockResolvedValue({ matches: [], scannedLists: 0, scannedItems: 0, truncated: false });
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

  it('restores the entity-specific workspace without refetching after navigation', async () => {
    const user = userEvent.setup();
    const first = render(<ListsView />);
    const search = await screen.findByRole('textbox', { name: 'Search lists' });
    await user.type(search, 'cost');
    first.unmount();

    render(<ListsView />);

    expect(screen.getByRole('textbox', { name: 'Search lists' })).toHaveValue('cost');
    expect(getLists).toHaveBeenCalledTimes(1);
  });

  it('keeps list definitions separate from full item retrieval', async () => {
    const user = userEvent.setup();
    render(<ListsView />);

    await screen.findByRole('button', { name: 'Retrieve Lists' });
    await user.click(screen.getByRole('button', { name: 'Retrieve Lists' }));
    await waitFor(() => expect(refreshLists).toHaveBeenCalledTimes(1));
    expect(fetchAllListItems).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Retrieve All List Items' }));
    await waitFor(() => expect(fetchAllListItems).toHaveBeenCalledWith(
      ['list-42'],
      { 'list-42': 'Cost centers' },
      expect.any(Object),
    ));
    expect(await screen.findByText('1 list item snapshots are ready locally.')).toBeInTheDocument();
  });

  it('shows a visual progress bar for both list and item retrieval', async () => {
    const user = userEvent.setup();
    let finishLists: (() => void) | undefined;
    let finishItems: (() => void) | undefined;
    refreshLists.mockImplementation(() => new Promise((resolve) => {
      finishLists = () => resolve({
        retrievedAt: '2026-08-04T00:00:00.000Z',
        count: 1,
        lists: [{ id: 'list-42', name: 'Cost centers', levelCount: 3 }],
      });
    }));
    fetchAllListItems.mockImplementation((_ids: string[], _names: Record<string, string>, handlers: {
      onProgress?: (progress: { phase: 'batch'; listId: string; listName: string; listIndex: number; listTotal: number; items: number }) => void;
      onDone?: (summary: { total: number; succeeded: number; failed: number; truncated: number }) => void;
    }) => new Promise<void>((resolve) => {
      handlers.onProgress?.({ phase: 'batch', listId: 'list-42', listName: 'Cost centers', listIndex: 2, listTotal: 4, items: 25 });
      finishItems = () => {
        handlers.onDone?.({ total: 4, succeeded: 4, failed: 0, truncated: 0 });
        resolve();
      };
    }));
    render(<ListsView />);

    await screen.findByRole('button', { name: 'Retrieve Lists' });
    await user.click(screen.getByRole('button', { name: 'Retrieve Lists' }));
    expect(await screen.findByRole('progressbar', { name: 'List retrieval progress' })).not.toHaveAttribute('aria-valuenow');
    finishLists?.();
    await waitFor(() => expect(screen.queryByRole('progressbar', { name: 'List retrieval progress' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Retrieve All List Items' }));
    expect(await screen.findByRole('progressbar', { name: 'List item retrieval progress' })).toHaveAttribute('aria-valuenow', '38');
    finishItems?.();
    await waitFor(() => expect(screen.queryByRole('progressbar', { name: 'List item retrieval progress' })).not.toBeInTheDocument());
  });

  it('searches locally saved item values after a short debounce', async () => {
    const user = userEvent.setup();
    let finishSearch: (() => void) | undefined;
    searchSavedListItems.mockImplementation(() => new Promise((resolve) => {
      finishSearch = () => resolve({
        matches: [{ listId: 'list-42', itemId: 'item-7', value: 'North America', code: 'NA-01' }],
        scannedLists: 1,
        scannedItems: 12,
        truncated: false,
      });
    }));
    render(<ListsView />);

    await screen.findByRole('combobox', { name: 'Search lists by' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search lists by' }), 'value');
    await user.type(screen.getByRole('textbox', { name: 'Search lists' }), 'north');

    expect(await screen.findByRole('progressbar', { name: 'Local list item search progress' })).toBeInTheDocument();
    await waitFor(() => expect(searchSavedListItems).toHaveBeenLastCalledWith('value', 'north', expect.any(AbortSignal)));
    finishSearch?.();
    expect(await screen.findByText('Value: North America')).toBeInTheDocument();
  });

  it('retrieves an incomplete list tree before mounting the item browser', async () => {
    const user = userEvent.setup();
    getItemsIndex
      .mockResolvedValueOnce({ lists: {} })
      .mockResolvedValueOnce({
        lists: {
          'list-42': { listId: 'list-42', count: 12, retrievedAt: '2026-08-04T00:00:00.000Z', truncated: false, maxLevel: 3, complete: true },
        },
      });
    render(<ListsView />);

    await screen.findByRole('button', { name: 'Inspect list items' });
    await user.click(screen.getByRole('button', { name: 'Inspect list items' }));

    await waitFor(() => expect(fetchAllListItems).toHaveBeenCalledWith(
      ['list-42'],
      { 'list-42': 'Cost centers' },
      expect.any(Object),
    ));
    expect(await screen.findByText('Item tree')).toBeInTheDocument();
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
