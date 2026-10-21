import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListsView } from './ListsView';
import { resetListsViewSessions } from './listsSessionCache';
import { getListsV3, refreshListsV3 } from '../api/listsV3Api';
import { fetchAllListItemsV3, getItemsV3Index, getListItemsV3, refreshListItemsV3 } from '../api/listItemsV3Api';

vi.mock('../api/listItemsV3Api', () => ({
  getItemsV3Index: vi.fn(), getListItemsV3: vi.fn(), fetchAllListItemsV3: vi.fn(), refreshListItemsV3: vi.fn(),
}));

vi.mock('../api/listsV3Api', () => ({
  getListsV3: vi.fn(),
  refreshListsV3: vi.fn(),
  listV3Name: (list: { Name?: string; ID: string }) => list.Name ?? list.ID,
}));

const { getLists, getItemsIndex, refreshLists, fetchAllListItems, searchSavedListItems, refreshListItems } = vi.hoisted(() => ({
  getLists: vi.fn(),
  getItemsIndex: vi.fn(),
  refreshLists: vi.fn(),
  fetchAllListItems: vi.fn(),
  searchSavedListItems: vi.fn(),
  refreshListItems: vi.fn(),
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
  refreshListItems,
}));

vi.mock('./ListItemsTree', () => ({
  ListItemsTree: ({ listId, v3Items = [] }: { listId?: string | null; v3Items?: { ID: string; Name?: string }[] }) => <div>
    {listId ? <div>Item tree</div> : null}
    {v3Items.map(item => <button key={item.ID} type="button">View v3 item {item.Name ?? item.ID}</button>)}
  </div>,
}));

describe('ListsView table actions', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    resetListsViewSessions();
    refreshListItems.mockResolvedValue({ items: [], complete: true });
    vi.mocked(refreshListItemsV3).mockResolvedValue({ listId: 'legacy-42', items: [], count: 0, maxLevel: 0, truncated: false, retrievedAt: '' });
    vi.mocked(getListsV3).mockResolvedValue({ retrievedAt: '2026-10-18T00:00:00.000Z', count: 0, lists: [] });
    vi.mocked(refreshListsV3).mockResolvedValue({ retrievedAt: '2026-10-18T00:00:00.000Z', count: 0, lists: [] });
    vi.mocked(getItemsV3Index).mockResolvedValue({ lists: {} });
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
    fetchAllListItems.mockImplementation(async (_ids: string[], _names: Record<string, string>, handlers: { onDone?: (summary: { total: number; succeeded: number; failed: number; truncated: number; skipped: number }) => void }) => {
      handlers.onDone?.({ total: 1, succeeded: 1, failed: 0, truncated: 0, skipped: 0 });
    });
    searchSavedListItems.mockResolvedValue({ matches: [], scannedLists: 0, scannedItems: 0, truncated: false });
  });

  it('opens the resizable dual-version workspace from the list name', async () => {
    const user = userEvent.setup();
    render(<ListsView />);
    const select = await screen.findByRole('button', { name: 'Select Cost centers' });
    expect(screen.queryByLabelText('Selected list workspace')).not.toBeInTheDocument();
    await user.click(select);
    expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('separator', { name: 'Resize lists and workspace' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'List metadata' })).toBeInTheDocument();
    expect(screen.getByText('Item tree')).toBeInTheDocument();
    // A v4-only list still mounts the merged browser; there is simply no v3
    // snapshot for it to merge in.
    expect(screen.queryByRole('button', { name: /View v3 item/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Cost centers data' })).toHaveTextContent('');
    expect(screen.queryByRole('button', { name: 'All versions' })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('List search controls')).getByLabelText('Search lists by')).toBeInTheDocument();
  });

  it('shows a list available only in v3 without requiring a global version selection', async () => {
    vi.mocked(getListsV3).mockResolvedValue({
      retrievedAt: '2026-10-18T00:00:00.000Z', count: 1,
      lists: [{ ID: 'legacy-list-42', Name: 'Legacy cost centers' }],
    });
    render(<ListsView />);
    await screen.findByText('v4 ID: list-42');
    expect(await screen.findByText('Legacy cost centers')).toBeInTheDocument();
    expect(screen.getByText('v3 ID: legacy-list-42')).toBeInTheDocument();
    expect(screen.getByText('v4 ID: list-42')).toBeInTheDocument();
  });

  it('shows both sources by default and keeps identical IDs independently expandable', async () => {
    vi.mocked(getListsV3).mockResolvedValue({ retrievedAt: '2026-10-18T00:00:00.000Z', count: 1, lists: [{ ID: 'list-42', Name: 'Legacy cost centers' }] });
    vi.mocked(getListItemsV3).mockResolvedValue({ listId: 'list-42', retrievedAt: '2026-10-18T00:00:00.000Z', count: 1, truncated: false, maxLevel: 1, items: [{ ID: 'legacy-item', Name: 'Legacy item', Level1Code: 'OPS' }] });
    const user = userEvent.setup();
    render(<ListsView />);
    expect(await screen.findByText('v3 ID: list-42')).toBeInTheDocument();
    expect(screen.getByText('v4 ID: list-42')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All versions' })).not.toBeInTheDocument();
    const row = screen.getByText('v3 ID: list-42').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Select Legacy cost centers' }));
    expect(await screen.findByRole('button', { name: 'View v3 item Legacy item' })).toBeInTheDocument();
    expect(screen.queryByText('Item tree')).not.toBeInTheDocument();
    await user.click(within(screen.getByText('v4 ID: list-42').closest('tr')!).getByRole('button', { name: 'Select Cost centers' }));
    expect(screen.getByText('Item tree')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View v3 item Legacy item' })).not.toBeInTheDocument();
    expect(screen.getByText('v3 ID: list-42')).toBeInTheDocument();
  });

  it('searches saved v3 item codes without confusing them with v4 IDs', async () => {
    vi.mocked(getListsV3).mockResolvedValue({ retrievedAt: '2026-10-18T00:00:00.000Z', count: 1, lists: [{ ID: 'list-42', Name: 'Legacy cost centers' }] });
    vi.mocked(getItemsV3Index).mockResolvedValue({ lists: { 'list-42': { listId: 'list-42', count: 1, retrievedAt: '2026-10-18T00:00:00.000Z', truncated: false, maxLevel: 1, complete: true } } });
    vi.mocked(getListItemsV3).mockResolvedValue({ listId: 'list-42', retrievedAt: '2026-10-18T00:00:00.000Z', count: 1, truncated: false, maxLevel: 1, items: [{ ID: 'legacy-item', Name: 'Operations', Level2Code: 'OPS' }] });
    const user = userEvent.setup();
    render(<ListsView />);
    await screen.findByText('v3 ID: list-42');
    await waitFor(() => expect(getItemsV3Index).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText('Search lists by'), 'code');
    await user.type(screen.getByRole('textbox', { name: 'Search lists' }), 'OPS');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.queryByText('v4 ID: list-42')).not.toBeInTheDocument());
    expect(screen.getByText('v3 ID: list-42')).toBeInTheDocument();
  });

  it('groups same-name lists and shows both sources without switches', async () => {
    vi.mocked(getListsV3).mockResolvedValue({ retrievedAt: '', count: 1, lists: [{ ID: 'legacy-42', Name: 'Cost centers', ConnectorID: 'ERP' }] });
    vi.mocked(getListItemsV3).mockResolvedValue({ listId: 'legacy-42', retrievedAt: '', count: 1, truncated: false, maxLevel: 1, items: [{ ID: 'legacy-item', Name: 'Operations' }] });
    const user = userEvent.setup();
    const view = render(<ListsView />);
    await user.click(await screen.findByRole('button', { name: 'Select Cost centers' }));
    expect(screen.getByText('Item tree')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'View v3 item Operations' })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'List metadata' })).getByText('ERP')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Select Cost centers' })).toHaveLength(1);
    view.unmount();
    render(<ListsView />);
    expect(screen.getByText('Item tree')).toBeInTheDocument();
  });

  it.each(['list-42', 'legacy-42'])('finds a grouped list by either version ID: %s', async id => {
    vi.mocked(getListsV3).mockResolvedValue({ retrievedAt: '2026-10-18T00:00:00.000Z', count: 1, lists: [{ ID: 'legacy-42', Name: 'Cost centers' }] });
    getLists.mockResolvedValue({ retrievedAt: '2026-10-18T00:00:00.000Z', count: 2, lists: [{ id: 'list-42', name: 'Cost centers' }, { id: 'other-list', name: 'Other list' }] });
    const user = userEvent.setup();
    render(<ListsView />);
    await screen.findByText('Other list');
    await user.selectOptions(screen.getByLabelText('Search lists by'), 'list-id');
    await user.type(screen.getByRole('textbox', { name: 'Search lists' }), id);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText('v4 ID: list-42')).toBeInTheDocument();
    expect(screen.queryByText('Other list')).not.toBeInTheDocument();
    expect(searchSavedListItems).not.toHaveBeenCalled();
  });

  it('searches saved item IDs across v3 and v4 while keeping the displayed source v4', async () => {
    vi.mocked(getListsV3).mockResolvedValue({ retrievedAt: '2026-10-18T00:00:00.000Z', count: 1, lists: [{ ID: 'legacy-42', Name: 'Cost centers' }] });
    vi.mocked(getItemsV3Index).mockResolvedValue({ lists: { 'legacy-42': { listId: 'legacy-42', count: 1, retrievedAt: '2026-10-18T00:00:00.000Z', truncated: false, maxLevel: 1, complete: true } } });
    vi.mocked(getListItemsV3).mockResolvedValue({ listId: 'legacy-42', retrievedAt: '2026-10-18T00:00:00.000Z', count: 1, truncated: false, maxLevel: 1, items: [{ ID: 'legacy-item-99', Name: 'Operations' }] });
    const user = userEvent.setup();
    render(<ListsView />);
    await screen.findByText('v4 ID: list-42');
    await user.selectOptions(screen.getByLabelText('Search lists by'), 'item-id');
    await user.type(screen.getByRole('textbox', { name: 'Search lists' }), 'legacy-item-99');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Item ID: legacy-item-99')).toBeInTheDocument();
    expect(searchSavedListItems).toHaveBeenLastCalledWith('id', 'legacy-item-99', expect.any(AbortSignal));
    expect(screen.getByText('v4 ID: list-42')).toBeInTheDocument();
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
    expect(await screen.findByRole('progressbar', { name: 'Retrieving all list items and child lists (v4)' })).toHaveAttribute('aria-valuenow', '38');
    finishItems?.();
    await waitFor(() => expect(screen.queryByRole('progressbar', { name: 'Retrieving all list items and child lists (v4)' })).not.toBeInTheDocument());
  });

  it('retrieves v3 items with actual v3 list IDs, never the name-matched v4 IDs', async () => {
    vi.mocked(getListsV3).mockResolvedValue({ retrievedAt: '', count: 1, lists: [{ ID: 'legacy-42', Name: 'Cost centers' }] });
    const user = userEvent.setup();
    render(<ListsView />);
    await screen.findByRole('button', { name: 'Select Cost centers' });
    await user.click(screen.getByRole('button', { name: 'Retrieve All List Items' }));
    await waitFor(() => expect(fetchAllListItemsV3).toHaveBeenCalledWith(['legacy-42'], { 'legacy-42': 'Cost centers' }, expect.any(Object)));
  });

  it('searches locally saved item values after clicking search button', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('progressbar', { name: 'Local list item search progress' })).toBeInTheDocument();
    await waitFor(() => expect(searchSavedListItems).toHaveBeenLastCalledWith('value', 'north', expect.any(AbortSignal)));
    finishSearch?.();
    expect(await screen.findByText('Value: North America')).toBeInTheDocument();
  });

  it('mounts the item browser immediately instead of waiting for a full retrieval', async () => {
    const user = userEvent.setup();
    getItemsIndex.mockResolvedValue({ lists: {} });
    render(<ListsView />);

    await screen.findByRole('button', { name: 'Select Cost centers' });
    await user.click(screen.getByRole('button', { name: 'Select Cost centers' }));

    // The tree lazy-loads its own levels, so opening a list costs no traversal.
    expect(await screen.findByText('Item tree')).toBeInTheDocument();
    expect(fetchAllListItems).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Selected list workspace')).toBeInTheDocument();
  });

  it('refreshes both source snapshots using the workspace icon', async () => {
    vi.mocked(getListsV3).mockResolvedValue({ retrievedAt: '', count: 1, lists: [{ ID: 'legacy-42', Name: 'Cost centers' }] });
    vi.mocked(getListItemsV3).mockResolvedValue({ listId: 'legacy-42', retrievedAt: '', count: 0, truncated: false, maxLevel: 0, items: [] });
    const user = userEvent.setup();
    render(<ListsView />);
    await user.click(await screen.findByRole('button', { name: 'Select Cost centers' }));
    await user.click(screen.getByRole('button', { name: 'Refresh Cost centers data' }));
    await waitFor(() => expect(refreshListItems).toHaveBeenCalledWith('list-42'));
    expect(refreshListItemsV3).toHaveBeenCalledWith('legacy-42');
    expect(getItemsIndex).toHaveBeenCalledTimes(2);
  });

  it('keeps the refresh icon busy and reports refresh failures', async () => {
    let rejectRefresh: (error: Error) => void = () => {};
    refreshListItems.mockImplementation(() => new Promise((_resolve, reject) => { rejectRefresh = reject; }));
    const user = userEvent.setup();
    render(<ListsView />);
    await user.click(await screen.findByRole('button', { name: 'Select Cost centers' }));
    await user.click(screen.getByRole('button', { name: 'Refresh Cost centers data' }));
    expect(screen.getByRole('button', { name: 'Refresh Cost centers data' })).toBeDisabled();
    rejectRefresh(new Error('Network unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
  });

  it('reports that already-complete lists were left alone', async () => {
    const user = userEvent.setup();
    fetchAllListItems.mockImplementation(async (_ids: string[], _names: Record<string, string>, handlers: {
      onDone?: (summary: { total: number; succeeded: number; failed: number; truncated: number; skipped: number }) => void;
    }) => {
      handlers.onDone?.({ total: 1, succeeded: 1, failed: 0, truncated: 0, skipped: 1 });
    });
    render(<ListsView />);

    await screen.findByRole('button', { name: 'Retrieve All List Items' });
    await user.click(screen.getByRole('button', { name: 'Retrieve All List Items' }));

    expect(await screen.findByText(/1 already held a complete tree and were left alone\./)).toBeInTheDocument();
  });

  it('clears the old workspace when the selected list is filtered out', async () => {
    const user = userEvent.setup();
    render(<ListsView />);
    await user.click(await screen.findByRole('button', { name: 'Select Cost centers' }));
    await user.type(screen.getByRole('textbox', { name: 'Search lists' }), 'missing');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.queryByLabelText('Selected list workspace')).not.toBeInTheDocument();
    expect(screen.getByText('No lists match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'Select Cost centers' })).toBeInTheDocument();
  });

});
