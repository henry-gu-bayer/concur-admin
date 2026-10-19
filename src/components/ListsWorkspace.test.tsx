import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListsWorkspace } from './ListsWorkspace';
import { getListResource } from '../api/listResourceApi';
import { getListItemsV3 } from '../api/listItemsV3Api';
import { listRecordFields } from './ListRecordFields';

vi.mock('../api/listResourceApi', () => ({ getListResource: vi.fn() }));
vi.mock('../api/listItemsV3Api', () => ({ getListItemsV3: vi.fn(), refreshListItemsV3: vi.fn() }));
vi.mock('./ItemTree', () => ({ ItemTree: ({ onSelect }: { onSelect: (item: { id: string; value: string }) => void }) => <button onClick={() => onSelect({ id: 'same-id', value: 'Operations' })}>Select v4 Operations</button> }));

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

  it('shows both versions and dereferences actual v3 list and item details, without merging same-name items', async () => {
    const user = userEvent.setup();
    render(<ListsWorkspace v4={v4} v3={v3} entityId="us-uat" />);
    expect(await screen.findByRole('button', { name: 'View v3 item Operations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select v4 Operations' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show all list fields/ }));
    expect(within(screen.getByRole('table', { name: 'List metadata' })).getByText('ERP')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View v3 item Operations' }));
    expect(await screen.findByText('Full item details')).toBeInTheDocument();
    expect(getListResource).toHaveBeenCalledWith(itemUri, 'us-uat', expect.any(AbortSignal));
    const fields = screen.getByLabelText('Complete item fields');
    expect(within(fields).getByText('No')).toBeInTheDocument();
    expect(within(fields).getByText('0')).toBeInTheDocument();
    expect(within(fields).queryByText(itemUri)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select v4 Operations' }));
    expect(screen.queryByText('Full item details')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'v4 item details' })).toBeInTheDocument();
  });

  it('keeps cached fields and supports retrying a failed v3 detail request', async () => {
    vi.mocked(getListResource).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ ConnectorID: 'Recovered' });
    const user = userEvent.setup();
    render(<ListsWorkspace v4={null} v3={v3} entityId="us-uat" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cached fields are shown');
    await user.click(screen.getByRole('button', { name: 'Retry details' }));
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
    expect(screen.getByText('No v4 data available.')).toBeInTheDocument();
  });

  it('does not let an obsolete detail response replace a newly selected item', async () => {
    let finish: (value: Record<string, unknown>) => void = () => {};
    vi.mocked(getListResource).mockImplementation(uri => uri === itemUri ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ID: 'legacy' }));
    const user = userEvent.setup();
    render(<ListsWorkspace v4={v4} v3={v3} entityId="us-uat" />);
    await user.click(await screen.findByRole('button', { name: 'View v3 item Operations' }));
    await waitFor(() => expect(getListResource).toHaveBeenCalledWith(itemUri, 'us-uat', expect.any(AbortSignal)));
    await user.click(screen.getByRole('button', { name: 'Select v4 Operations' }));
    finish({ ServerOnlyValue: 'Obsolete' });
    await waitFor(() => expect(screen.queryByText('Obsolete')).not.toBeInTheDocument());
  });
});
