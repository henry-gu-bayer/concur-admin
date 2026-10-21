import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListsWorkspace } from './ListsWorkspace';
import { getListResource } from '../api/listResourceApi';
import { getListItemsV3 } from '../api/listItemsV3Api';
import { listRecordFields } from './ListRecordFields';

vi.mock('../api/listResourceApi', () => ({ getListResource: vi.fn() }));
vi.mock('../api/listItemsV3Api', () => ({ getListItemsV3: vi.fn(), refreshListItemsV3: vi.fn() }));
vi.mock('./ListItemsTree', () => ({
  ListItemsTree: ({ onSelect }: { onSelect: (row: { key: string; name: string; level: number; hasChildren: boolean; v4?: { id: string }; v3?: { ID: string; Name?: string; URI?: string } }) => void }) => <>
    <button onClick={() => onSelect({ key: 'v3:same-id', name: 'Operations', level: 1, hasChildren: false, v3: { ID: 'same-id', Name: 'Operations', URI: 'https://us.api.concursolutions.com/api/v3.0/common/listitems/same-id' } })}>Select v3 Operations</button>
    <button onClick={() => onSelect({ key: 'v4:same-id', name: 'Operations', level: 1, hasChildren: false, v4: { id: 'same-id' } })}>Select v4 Operations</button>
  </>,
}));

const v4 = { id: 'modern', name: 'Cost centers', levelCount: 3, displayFormat: 'Code (Name)', category: { id: 'cat', type: 'Normal' } };
const v3 = { ID: 'legacy', Name: 'Cost centers', URI: 'https://us.api.concursolutions.com/api/v3.0/common/lists/legacy' };
const itemUri = 'https://us.api.concursolutions.com/api/v3.0/common/listitems/same-id';

describe('ListsWorkspace', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getListItemsV3).mockResolvedValue({ listId: 'legacy', retrievedAt: '', count: 1, maxLevel: 1, truncated: false, items: [{ ID: 'same-id', Name: 'Operations', Level1Code: 'OPS', URI: itemUri }] });
    vi.mocked(getListResource).mockImplementation(async uri => uri === itemUri ? { ID: 'same-id', Name: 'Operations', ServerOnlyValue: 'Full item details', IsDeleted: false, Amount: 0 } : { ID: 'legacy', ConnectorID: 'ERP', ExternalThreshold: 0 });
  });

  it('preserves nested, unknown and falsy fields without placing URLs on the main stage', () => {
    expect(listRecordFields({ ID: 'a', Extra: { Enabled: false, Amount: 0, Empty: null }, URI: itemUri })).toEqual([
      { key: 'id', label: 'ID', value: 'a' }, { key: 'extra.enabled', label: 'Extra · Enabled', value: 'No' }, { key: 'extra.amount', label: 'Extra · Amount', value: '0' }, { key: 'extra.empty', label: 'Extra · Empty', value: '—' },
    ]);
  });

  it('renders one item list for both versions and shows each version\'s data separately', async () => {
    const user = userEvent.setup();
    render(<ListsWorkspace v4={v4} v3={v3} entityId="us-uat" />);
    expect(await screen.findByRole('button', { name: 'Select v3 Operations' })).toBeInTheDocument();
    // One shared filter for the merged list, not one per version.
    expect(screen.getByRole('textbox', { name: 'Filter items by name, code or ID' })).toBeInTheDocument();
    expect(screen.queryByLabelText('v4 list items')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('v3 list items')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show all list fields/ }));
    expect(within(screen.getByRole('table', { name: 'List metadata' })).getByText('ERP')).toBeInTheDocument();
  });

  it('shows the v3 item fields, both IDs, and the missing v4 counterpart', async () => {
    const user = userEvent.setup();
    render(<ListsWorkspace v4={v4} v3={v3} entityId="us-uat" />);
    await user.click(await screen.findByRole('button', { name: 'Select v3 Operations' }));
    expect(await screen.findByText('Full item details')).toBeInTheDocument();
    expect(getListResource).toHaveBeenCalledWith(itemUri, 'us-uat', expect.any(AbortSignal));
    // The header carries the technical identity of each source record.
    expect(screen.getByText('v3 ID:').parentElement).toHaveTextContent('same-id');
    expect(screen.getByText('v4 ID:').parentElement).toHaveTextContent('Not available');
    const v3Fields = screen.getByLabelText('v3 item fields');
    expect(within(v3Fields).getByText('No')).toBeInTheDocument();
    expect(within(v3Fields).getByText('0')).toBeInTheDocument();
    expect(within(v3Fields).queryByText(itemUri)).not.toBeInTheDocument();
    // The version without a paired record says so instead of disappearing.
    expect(screen.getByText('This item has no v4 counterpart in this list.')).toBeInTheDocument();
    expect(screen.queryByLabelText('v4 item fields')).not.toBeInTheDocument();
  });

  it('shows a paired item\'s v4 and v3 records in separate sections', async () => {
    const user = userEvent.setup();
    render(<ListsWorkspace v4={v4} v3={v3} entityId="us-uat" />);
    await user.click(await screen.findByRole('button', { name: 'Select v4 Operations' }));
    expect(screen.getByLabelText('v4 item fields')).toBeInTheDocument();
    expect(screen.getByLabelText('v4 related list fields')).toBeInTheDocument();
    expect(screen.getByText('This item has no v3 counterpart in this list.')).toBeInTheDocument();
    expect(screen.queryByLabelText('v3 item fields')).not.toBeInTheDocument();
  });

  it('keeps cached fields and supports retrying a failed v3 detail request', async () => {
    vi.mocked(getListResource).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ ConnectorID: 'Recovered' });
    const user = userEvent.setup();
    render(<ListsWorkspace v4={null} v3={v3} entityId="us-uat" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cached fields are shown');
    await user.click(screen.getByRole('button', { name: 'Retry details' }));
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
    expect(screen.queryByText('No v4 data available.')).not.toBeInTheDocument();
  });

  it('does not let an obsolete detail response replace a newly selected item', async () => {
    let finish: (value: Record<string, unknown>) => void = () => {};
    vi.mocked(getListResource).mockImplementation(uri => uri === itemUri ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ID: 'legacy' }));
    const user = userEvent.setup();
    render(<ListsWorkspace v4={v4} v3={v3} entityId="us-uat" />);
    await user.click(await screen.findByRole('button', { name: 'Select v3 Operations' }));
    await waitFor(() => expect(getListResource).toHaveBeenCalledWith(itemUri, 'us-uat', expect.any(AbortSignal)));
    await user.click(screen.getByRole('button', { name: 'Select v4 Operations' }));
    finish({ ServerOnlyValue: 'Obsolete' });
    await waitFor(() => expect(screen.queryByText('Obsolete')).not.toBeInTheDocument());
  });
});
