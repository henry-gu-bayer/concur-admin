import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeView } from './HomeView';

const state = vi.hoisted(() => ({
  entities: [] as { id: string; label: string }[],
  activeEntityId: '',
}));

vi.mock('../entities/entityStore', () => ({
  getEntities: () => state.entities,
  getActiveEntityId: () => state.activeEntityId,
  subscribeEntities: () => () => {},
}));
vi.mock('../auth/tokenStore', () => ({
  initAuth: vi.fn(),
  selectAuthEntity: vi.fn(),
  entityHasToken: () => true,
}));

function selectEntity(id: string, label: string) {
  state.entities = [{ id, label }];
  state.activeEntityId = id;
}

describe('HomeView', () => {
  afterEach(() => {
    cleanup();
    state.entities = [];
    state.activeEntityId = '';
  });

  it('names the active tenant and its entity ID', () => {
    selectEntity('us-uat', 'US UAT');
    render(<HomeView onOpenCategory={() => {}} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Reading from US UAT' })).toBeVisible();
    expect(screen.getByText('us-uat')).toBeVisible();
    expect(screen.queryByText('Production')).not.toBeInTheDocument();
  });

  it('marks a production tenant in text, not only by color', () => {
    selectEntity('us-production', 'US Production');
    render(<HomeView onOpenCategory={() => {}} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Reading from US Production' })).toBeVisible();
    expect(screen.getByText('Production', { selector: 'span' })).toBeVisible();
  });

  it('explains how to configure an entity when none is selected', () => {
    render(<HomeView onOpenCategory={() => {}} />);

    expect(screen.getByRole('heading', { level: 1, name: 'No Concur entity selected' })).toBeVisible();
    expect(screen.getByText('CONCUR_ENTITIES')).toBeVisible();
  });

  it('labels each section separately from the features it contains', async () => {
    selectEntity('us-uat', 'US UAT');
    const onOpenCategory = vi.fn();
    const user = userEvent.setup();
    render(<HomeView onOpenCategory={onOpenCategory} />);

    const foundation = screen.getByRole('region', { name: 'Foundation data' });
    expect(within(foundation).queryByRole('button', { name: 'Foundation data' })).not.toBeInTheDocument();
    await user.click(within(foundation).getByRole('button', { name: 'Lists' }));

    expect(onOpenCategory).toHaveBeenCalledWith('lists');
  });

  it('tints the feature icons in the active environment tone', () => {
    selectEntity('us-uat', 'US UAT');
    render(<HomeView onOpenCategory={() => {}} />);
    const uatIcon = screen.getByRole('button', { name: 'Lists' }).querySelector('span');
    expect(uatIcon).toHaveClass('border', 'border-uat/30', 'bg-uat/5', 'text-uat');
    cleanup();

    selectEntity('us-production', 'US Production');
    render(<HomeView onOpenCategory={() => {}} />);
    const productionIcon = screen.getByRole('button', { name: 'Lists' }).querySelector('span');
    expect(productionIcon).toHaveClass('border', 'border-primary/25', 'bg-primary/5', 'text-primary');
  });
});
