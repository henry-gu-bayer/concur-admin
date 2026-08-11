import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const { entities } = vi.hoisted(() => ({
  entities: [{ id: 'us-uat', label: 'US UAT' }],
}));

vi.mock('./components/AuthStatus', () => ({
  AuthStatus: () => <div>Auth status</div>,
}));
vi.mock('./components/CategoryBrowser', () => ({
  CategoryBrowser: () => <div>Category browser</div>,
}));
vi.mock('./components/ApiLogsView', () => ({
  ApiLogsView: () => <div>API logs view</div>,
}));
vi.mock('./components/ExpenseGroupsView', () => ({
  ExpenseGroupsView: () => <div>Expense groups view</div>,
}));
vi.mock('./components/ListsView', () => ({
  ListsView: () => <div>Lists view</div>,
}));
vi.mock('./components/UsersView', () => ({
  UsersView: () => <div>Users view</div>,
}));
vi.mock('./components/FormsView', () => ({
  FormsView: () => <div>Forms view</div>,
}));
vi.mock('./components/LocationsView', () => ({
  LocationsView: () => <div>Locations view</div>,
}));
vi.mock('./entities/entityStore', () => ({
  getActiveEntityId: () => 'us-uat',
  getEntities: () => entities,
  setActiveEntity: vi.fn(),
  subscribeEntities: () => () => {},
}));
vi.mock('./auth/tokenStore', () => ({
  initAuth: vi.fn(),
  selectAuthEntity: vi.fn(),
}));

describe('App navigation', () => {
  afterEach(cleanup);

  it('opens the Users page from the sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Users' }));

    expect(screen.getByText('Users view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
  });

  it('opens the Forms & Fields page from the sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Forms & Fields' }));

    expect(screen.getByText('Forms view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Forms & Fields' })).toBeInTheDocument();
  });

  it('opens the Locations page from the sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Locations' }));

    expect(screen.getByText('Locations view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Locations' })).toBeInTheDocument();
  });
});
