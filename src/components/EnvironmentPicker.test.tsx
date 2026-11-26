import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentPicker } from './EnvironmentPicker';

const state = vi.hoisted(() => ({
  entities: [
    { id: 'us-uat', label: 'US UAT' },
    { id: 'us-production', label: 'US Production' },
  ],
  activeEntityId: 'us-uat',
}));

vi.mock('../entities/entityStore', () => ({
  getEntities: () => state.entities,
  getActiveEntityId: () => state.activeEntityId,
  setActiveEntity: vi.fn(),
  subscribeEntities: () => () => {},
}));
vi.mock('../auth/tokenStore', () => ({
  initAuth: vi.fn(),
  selectAuthEntity: vi.fn(),
  entityHasToken: () => true,
  subscribe: () => () => {},
}));

describe('EnvironmentPicker', () => {
  afterEach(() => {
    cleanup();
    state.activeEntityId = 'us-uat';
  });

  it('marks an active UAT entity in the same magenta as the app frame', async () => {
    const user = userEvent.setup();
    render(<EnvironmentPicker />);

    const trigger = screen.getByRole('button', { name: 'Active entity: US UAT' });
    expect(trigger).toHaveClass('border-uat/30', 'bg-uat/5', 'text-uat');
    expect(within(trigger).getByText('US')).toHaveClass('font-bold');
    expect(trigger).toHaveTextContent('US UAT');

    await user.click(trigger);
    const option = screen.getByRole('option', { name: 'US UAT' });
    expect(option).toHaveClass('bg-uat/10', 'text-uat');
    expect(option.querySelector('.rounded-full')).toHaveClass('bg-uat');
  });

  it('marks a production entity in blue, clearly apart from UAT magenta', async () => {
    state.activeEntityId = 'us-production';
    const user = userEvent.setup();
    render(<EnvironmentPicker />);

    const trigger = screen.getByRole('button', { name: 'Active entity: US Production' });
    expect(trigger).toHaveClass('border-primary/25', 'bg-primary/5', 'text-primary');
    expect(trigger).not.toHaveClass('text-uat');

    await user.click(trigger);
    expect(screen.getByRole('option', { name: 'US Production' }).querySelector('.rounded-full')).toHaveClass('bg-primary');
    expect(screen.getByRole('option', { name: 'US UAT' }).querySelector('.rounded-full')).toHaveClass('bg-uat');
  });
});
