import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemTree } from './ItemTree';
import type { ConcurListItem } from '../types';

const { getChildrenLevel } = vi.hoisted(() => ({ getChildrenLevel: vi.fn() }));

vi.mock('../api/listItemsApi', () => ({ getChildrenLevel }));

function roots(count: number): ConcurListItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    level: 1,
    parentId: null,
    value: `Item ${i}`,
    code: `C${String(i).padStart(4, '0')}`,
  }));
}

function page(items: ConcurListItem[], parent: string | null = null) {
  return { listId: 'list-1', parent, items, fromCache: true };
}

describe('ItemTree', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only a window of rows when a node holds thousands of children', async () => {
    getChildrenLevel.mockResolvedValue(page(roots(2000)));
    render(<ItemTree listId="list-1" />);

    await screen.findByRole('tree', { name: 'List items' });

    // Every item is loaded, but mounting 2,000 rows at once is what used to
    // lock up the browser, so only the visible slice may reach the DOM.
    expect(screen.getByText(/2,000 items loaded/)).toBeInTheDocument();
    const rendered = screen.getAllByRole('treeitem');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
    expect(screen.getByText('Item 0')).toBeInTheDocument();
    expect(screen.queryByText('Item 1999')).not.toBeInTheDocument();
  });

  it('loads a node level once, on first expand', async () => {
    const user = userEvent.setup();
    getChildrenLevel.mockImplementation(async (_listId: string, parentId: string | null) =>
      parentId === null
        ? page([{ id: 'parent-1', level: 1, parentId: null, value: 'Parent', hasChildren: true }])
        : page([{ id: 'child-1', level: 2, parentId: 'parent-1', value: 'Child' }], parentId)
    );
    render(<ItemTree listId="list-1" />);

    await screen.findByText('Parent');
    expect(getChildrenLevel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByText('Child')).toBeInTheDocument();
    expect(getChildrenLevel).toHaveBeenCalledWith('list-1', 'parent-1');
    expect(getChildrenLevel).toHaveBeenCalledTimes(2);

    // Collapsing and reopening reuses what is already in memory.
    await user.click(screen.getByRole('button', { name: 'Collapse' }));
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByText('Child')).toBeInTheDocument();
    expect(getChildrenLevel).toHaveBeenCalledTimes(2);
  });

  it('filters the loaded nodes after a short debounce', async () => {
    const user = userEvent.setup();
    getChildrenLevel.mockResolvedValue(page([
      { id: 'a', level: 1, parentId: null, value: 'Alpha' },
      { id: 'b', level: 1, parentId: null, value: 'Beta' },
      { id: 'c', level: 1, parentId: null, value: 'Gamma' },
    ]));
    render(<ItemTree listId="list-1" />);

    await screen.findByText('Alpha');
    expect(screen.getAllByRole('treeitem')).toHaveLength(3);

    await user.type(screen.getByRole('textbox', { name: 'Filter loaded items' }), 'alpha');

    await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(1));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('offers a retry when one branch fails to load', async () => {
    const user = userEvent.setup();
    getChildrenLevel
      .mockResolvedValueOnce(page([{ id: 'parent-1', level: 1, parentId: null, value: 'Parent', hasChildren: true }]))
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValueOnce(page([{ id: 'child-1', level: 2, parentId: 'parent-1', value: 'Child' }], 'parent-1'));
    render(<ItemTree listId="list-1" />);

    await screen.findByText('Parent');
    await user.click(screen.getByRole('button', { name: 'Expand' }));

    expect(await screen.findByText(/Failed to load children: HTTP 503/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Child')).toBeInTheDocument();
  });

  it('surfaces a root failure with a retry', async () => {
    const user = userEvent.setup();
    getChildrenLevel
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce(page([{ id: 'a', level: 1, parentId: null, value: 'Alpha' }]));
    render(<ItemTree listId="list-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load items: HTTP 500');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
  });
});
