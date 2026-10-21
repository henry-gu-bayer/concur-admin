import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListItemsTree, type PairedListItem } from './ListItemsTree';
import type { ConcurListItem, ConcurListItemV3 } from '../types';

const { getChildrenLevel } = vi.hoisted(() => ({ getChildrenLevel: vi.fn() }));

vi.mock('../api/listItemsApi', () => ({ getChildrenLevel }));

function page(items: ConcurListItem[], parent: string | null = null) {
  return { listId: 'list-1', parent, items, fromCache: true };
}

function roots(count: number): ConcurListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    level: 1,
    parentId: null,
    value: `Item ${index}`,
    code: `C${String(index).padStart(4, '0')}`,
  }));
}

describe('ListItemsTree', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders one row per item with only name and code, even with thousands of children', async () => {
    getChildrenLevel.mockResolvedValue(page(roots(2000)));
    render(<ListItemsTree listId="list-1" />);

    await screen.findByRole('tree', { name: 'List items' });

    // Every item is loaded, but mounting 2,000 rows at once is what used to
    // lock up the browser, so only the visible slice may reach the DOM.
    expect(screen.getByText(/2,000 v4 loaded/)).toBeInTheDocument();
    const rendered = screen.getAllByRole('treeitem');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
    expect(screen.getByText('Item 0')).toBeInTheDocument();
    expect(screen.getByText('C0000')).toBeInTheDocument();
    // The ID column moved to the detail pane; a row must not show it.
    expect(screen.queryByText(/item-0/)).not.toBeInTheDocument();
    expect(screen.queryByText('Item 1999')).not.toBeInTheDocument();
  });

  it('pairs v4 and v3 records with the same code into one row', async () => {
    getChildrenLevel.mockResolvedValue(page([
      { id: 'v4-ops', level: 1, parentId: null, value: 'Operations (v4 name)', code: 'OPS' },
      { id: 'v4-new', level: 1, parentId: null, value: 'New expense', code: 'NEW' },
    ]));
    const v3Items: ConcurListItemV3[] = [
      { ID: 'v3-ops', Name: 'Operations', Level1Code: 'OPS' },
      { ID: 'v3-retired', Name: 'Retired type', Level1Code: 'RET' },
    ];
    render(<ListItemsTree listId="list-1" v3Items={v3Items} onSelect={() => {}} />);

    const ops = await screen.findByRole('button', { name: 'View list item Operations' });
    expect(ops).toBeInTheDocument();
    // The paired row appears once, not twice under two version headings.
    expect(screen.getAllByText('OPS')).toHaveLength(1);
    expect(screen.queryByText('Operations (v4 name)')).not.toBeInTheDocument();
    // Items exclusive to one version stay visible and say which one they are.
    expect(screen.getByText('Retired type')).toBeInTheDocument();
    expect(screen.getByText('v3 only')).toBeInTheDocument();
    expect(screen.getByText('New expense')).toBeInTheDocument();
    expect(screen.getByText('v4 only')).toBeInTheDocument();
  });

  it('pairs by name when one side has no code', async () => {
    getChildrenLevel.mockResolvedValue(page([{ id: 'v4-1', level: 1, parentId: null, value: 'Operations' }]));
    render(<ListItemsTree listId="list-1" v3Items={[{ ID: 'v3-1', Name: 'Operations' }]} />);

    expect(await screen.findByText('Operations')).toBeInTheDocument();
    expect(screen.getAllByRole('treeitem')).toHaveLength(1);
    expect(screen.queryByText(/only/)).not.toBeInTheDocument();
  });

  it('reports the selected pair to the workspace', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    getChildrenLevel.mockResolvedValue(page([{ id: 'v4-ops', level: 1, parentId: null, value: 'Operations', code: 'OPS' }]));
    render(<ListItemsTree listId="list-1" v3Items={[{ ID: 'v3-ops', Name: 'Operations', Level1Code: 'OPS' }]} onSelect={onSelect} />);

    await user.click(await screen.findByRole('button', { name: 'View list item Operations' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ name: 'Operations', code: 'OPS', level: 1 });
    expect(onSelect.mock.calls[0][0].v4).toMatchObject({ id: 'v4-ops' });
    expect(onSelect.mock.calls[0][0].v3).toMatchObject({ ID: 'v3-ops' });
  });

  it('upgrades a selected v3-only row once its v4 counterpart finishes loading', async () => {
    const user = userEvent.setup();
    const seen: PairedListItem[] = [];
    let releaseRoots: (value: ReturnType<typeof page>) => void = () => {};
    getChildrenLevel.mockReturnValueOnce(new Promise(resolve => { releaseRoots = resolve; }));
    // Mirrors the workspace, which feeds the emitted row back in as `selected`.
    const Harness = () => {
      const [selected, setSelected] = useState<PairedListItem | null>(null);
      return <ListItemsTree listId="list-1" v3Items={[{ ID: 'v3-ops', Name: 'Operations', Level1Code: 'OPS' }]} selected={selected} onSelect={row => { seen.push(row); setSelected(row); }} />;
    };
    render(<Harness />);

    // The v3 snapshot names the row, so it can be selected before v4 answers.
    await user.click(await screen.findByRole('button', { name: 'View list item Operations' }));
    expect(seen[seen.length - 1]).toMatchObject({ v3: { ID: 'v3-ops' } });
    expect(seen[seen.length - 1].v4).toBeUndefined();

    releaseRoots(page([{ id: 'v4-ops', level: 1, parentId: null, value: 'Operations', code: 'OPS' }]));
    await waitFor(() => expect(seen[seen.length - 1].v4).toMatchObject({ id: 'v4-ops' }));
    expect(screen.getAllByText('Operations')).toHaveLength(1);
    expect(screen.queryByText('v3 only')).not.toBeInTheDocument();
  });

  it('keeps an open branch open when its row gains a counterpart', async () => {
    const user = userEvent.setup();
    getChildrenLevel.mockImplementation(async (_listId: string, parentId: string | null) =>
      parentId === null
        ? page([{ id: 'v4-parent', level: 1, parentId: null, value: 'Parent', code: 'P', hasChildren: true }])
        : page([{ id: 'v4-child', level: 2, parentId: 'v4-parent', value: 'Child', code: 'C' }], parentId),
    );
    const v3Items: ConcurListItemV3[] = [
      { ID: 'v3-parent', Name: 'Parent', Level1Code: 'P' },
      { ID: 'v3-child', ParentID: 'v3-parent', Name: 'Child', Level1Code: 'P', Level2Code: 'C' },
    ];
    const view = render(<ListItemsTree listId="list-1" v3Items={[]} />);
    await screen.findByText('Parent');
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await screen.findByText('Child');

    // The legacy snapshot lands after the branch was opened. The row key
    // changes, but the branch must stay expanded.
    view.rerender(<ListItemsTree listId="list-1" v3Items={v3Items} />);
    expect(await screen.findByText('Child')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it('loads a v4 level once, on first expand, and merges it under the v3 parent', async () => {
    const user = userEvent.setup();
    getChildrenLevel.mockImplementation(async (_listId: string, parentId: string | null) =>
      parentId === null
        ? page([{ id: 'v4-parent', level: 1, parentId: null, value: 'Parent', code: 'P', hasChildren: true }])
        : page([{ id: 'v4-child', level: 2, parentId: 'v4-parent', value: 'Child', code: 'C' }], parentId),
    );
    render(<ListItemsTree listId="list-1" v3Items={[
      { ID: 'v3-parent', Name: 'Parent', Level1Code: 'P' },
      { ID: 'v3-child', ParentID: 'v3-parent', Name: 'Child', Level1Code: 'P', Level2Code: 'C' },
    ]} />);

    await screen.findByText('Parent');
    // v3 children are collapsed by default, exactly like the v4 tree.
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
    expect(getChildrenLevel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByText('Child')).toBeInTheDocument();
    expect(getChildrenLevel).toHaveBeenCalledWith('list-1', 'v4-parent');
    expect(getChildrenLevel).toHaveBeenCalledTimes(2);
    // The v3 child and its v4 counterpart are one row.
    expect(screen.getAllByText('C')).toHaveLength(1);

    // Collapsing and reopening reuses what is already in memory.
    await user.click(screen.getByRole('button', { name: 'Collapse' }));
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByText('Child')).toBeInTheDocument();
    expect(getChildrenLevel).toHaveBeenCalledTimes(2);
  });

  it('filters loaded items after a short debounce, including by hidden ID', async () => {
    const user = userEvent.setup();
    getChildrenLevel.mockResolvedValue(page([
      { id: 'id-alpha', level: 1, parentId: null, value: 'Alpha' },
      { id: 'id-beta', level: 1, parentId: null, value: 'Beta' },
      { id: 'id-gamma', level: 1, parentId: null, value: 'Gamma' },
    ]));
    render(<ListItemsTree listId="list-1" />);

    await screen.findByText('Alpha');
    expect(screen.getAllByRole('treeitem')).toHaveLength(3);

    const filter = screen.getByRole('textbox', { name: 'Filter loaded items' });
    await user.type(filter, 'alpha');
    await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(1));
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();

    // Clear the input by replacing its value in one change, so the assertion
    // after the debounce cannot observe an intermediate query.
    fireEvent.change(filter, { target: { value: 'id-gam' } });
    await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('reveals ancestors when a nested item matches the filter', async () => {
    getChildrenLevel.mockResolvedValue(page([{ id: 'root', level: 1, parentId: null, value: 'Root', code: 'R', hasChildren: true }]));
    render(<ListItemsTree listId="list-1" v3Items={[
      { ID: 'v3-root', Name: 'Root', Level1Code: 'R' },
      { ID: 'v3-child', ParentID: 'v3-root', Name: 'Nested operations', Level1Code: 'R', Level2Code: 'N' },
    ]} filterQuery="nested" />);

    expect(await screen.findByText('Nested operations')).toBeInTheDocument();
    expect(screen.getByText('Root')).toBeInTheDocument();
    expect(screen.getAllByRole('treeitem')).toHaveLength(2);
  });

  it('offers a retry when one v4 branch fails to load', async () => {
    const user = userEvent.setup();
    getChildrenLevel
      .mockResolvedValueOnce(page([{ id: 'v4-parent', level: 1, parentId: null, value: 'Parent', hasChildren: true }]))
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValueOnce(page([{ id: 'v4-child', level: 2, parentId: 'v4-parent', value: 'Child' }], 'v4-parent'));
    render(<ListItemsTree listId="list-1" />);

    await screen.findByText('Parent');
    await user.click(screen.getByRole('button', { name: 'Expand' }));

    expect(await screen.findByText(/Failed to load children: HTTP 503/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Child')).toBeInTheDocument();
  });

  it('surfaces a v4 root failure with a retry', async () => {
    const user = userEvent.setup();
    getChildrenLevel
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce(page([{ id: 'a', level: 1, parentId: null, value: 'Alpha' }]));
    render(<ListItemsTree listId="list-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load v4 items: HTTP 500');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
  });

  it('shows the v3 snapshot without calling v4 when the list only exists in v3', async () => {
    render(<ListItemsTree listId={null} v3Items={[{ ID: 'v3-1', Name: 'Legacy item', Level1Code: 'LEG' }]} onSelect={() => {}} />);

    expect(await screen.findByRole('button', { name: 'View list item Legacy item' })).toBeInTheDocument();
    expect(screen.getByText('LEG')).toBeInTheDocument();
    expect(getChildrenLevel).not.toHaveBeenCalled();
  });

  it('shows the loading skeleton while the first v4 level arrives', () => {
    getChildrenLevel.mockReturnValue(new Promise(() => {}));
    render(<ListItemsTree listId="list-1" />);
    expect(screen.getByLabelText('Loading items')).toHaveAttribute('aria-busy', 'true');
  });

  it('reports an empty list and an empty filter result distinctly', async () => {
    getChildrenLevel.mockResolvedValue(page([]));
    const view = render(<ListItemsTree listId="list-1" />);
    expect(await screen.findByText('This list has no items.')).toBeInTheDocument();
    view.rerender(<ListItemsTree listId="list-1" v3Items={[{ ID: 'v3-1', Name: 'Operations' }]} filterQuery="zzz" />);
    expect(await screen.findByText('No loaded items match this filter.')).toBeInTheDocument();
    expect(screen.queryByText('Operations')).not.toBeInTheDocument();
  });
});