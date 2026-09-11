import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { TravelUserProfile } from '../types';
import { TravelProfileDetailSections } from './TravelProfileDetailSections';

const TRAVEL_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:travel:2.0:User';

afterEach(cleanup);

function profileWithCustomFields(names: string[]): TravelUserProfile {
  return {
    id: 'user-one',
    [TRAVEL_USER_SCHEMA]: {
      customFields: names.map((name) => ({ name, value: `${name}-value` })),
    },
  } as TravelUserProfile;
}

describe('TravelProfileDetailSections', () => {
  it('shows custom fields sorted numerically by name', async () => {
    const user = userEvent.setup();
    render(<TravelProfileDetailSections profile={profileWithCustomFields(['custom19', 'custom2', 'custom1', 'custom18'])} />);

    await user.click(screen.getByRole('button', { name: 'Travel profile' }));
    await user.click(screen.getByRole('button', { name: /Travel custom fields/ }));
    const table = screen.getByRole('table', { name: 'Travel custom fields' });
    const labels = within(table).getAllByRole('row').slice(1).map((row) => (row as HTMLTableRowElement).cells[0].textContent);

    expect(labels).toEqual(['Custom1', 'Custom2', 'Custom18', 'Custom19']);
  });
});
