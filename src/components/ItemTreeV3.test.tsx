import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ItemTreeV3 } from './ItemTreeV3';

describe('ItemTreeV3 identifiers', () => {
  afterEach(cleanup);

  it('reveals ancestors for deeply nested ID matches and selects the source record', async () => {
    const user = userEvent.setup();
    let selected = '';
    render(<ItemTreeV3 compact filterQuery="grandchild" onSelect={item => { selected = item.ID; }} items={[
      { ID: 'root', Name: 'Root' }, { ID: 'child', ParentID: 'root', Name: 'Child' },
      { ID: 'grandchild', ParentID: 'child', Name: 'Operations' },
    ]} />);
    expect(screen.getByRole('button', { name: 'View v3 item Root' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View v3 item Operations' }));
    expect(selected).toBe('grandchild');
  });

  it('shows names, codes and versioned IDs for roots and expanded children', async () => {
    const user = userEvent.setup();
    render(<ItemTreeV3 items={[
      { ID: 'root-v3', Name: 'Operations', Level1Code: 'OPS' },
      { ID: 'child-v3', ParentID: 'root-v3', Name: 'Boston', Level1Code: 'BOS' },
    ]} />);
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('OPS')).toBeInTheDocument();
    expect(screen.getByText('v3 ID: root-v3')).toBeInTheDocument();
    expect(screen.queryByText('v3 ID: child-v3')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('Boston')).toBeInTheDocument();
    expect(screen.getByText('BOS')).toBeInTheDocument();
    expect(screen.getByText('v3 ID: child-v3')).toBeInTheDocument();
  });
});
