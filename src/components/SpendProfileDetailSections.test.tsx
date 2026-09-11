import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { SpendUserProfile } from '../types';
import { SPEND_USER_SCHEMA, SpendProfileDetailSections } from './SpendProfileDetailSections';

afterEach(cleanup);

function profileWithCustomData(ids: string[]): SpendUserProfile {
  return {
    id: 'user-one',
    [SPEND_USER_SCHEMA]: {
      customData: ids.map((id) => ({ id, value: `${id}-value` })),
    },
  } as SpendUserProfile;
}

describe('SpendProfileDetailSections', () => {
  it('shows custom data sorted numerically by field id', async () => {
    const user = userEvent.setup();
    render(<SpendProfileDetailSections profile={profileWithCustomData(['custom19', 'custom2', 'custom1', 'custom18'])} />);

    await user.click(screen.getByRole('button', { name: 'Spend profile' }));
    await user.click(screen.getByRole('button', { name: /Spend custom data/ }));
    const table = screen.getByRole('table', { name: 'Spend custom data fields' });
    const ids = within(table).getAllByRole('row').slice(1).map((row) => (row as HTMLTableRowElement).cells[0].textContent);

    expect(ids).toEqual(['custom1', 'custom2', 'custom18', 'custom19']);
  });
});
