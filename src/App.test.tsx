import { useState } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { categories } from './registry/categories';
import { navigateToCategory, resetViewNavigation } from './state/viewNavigation';

const { entities, activeEntity, retrieveLists } = vi.hoisted(() => ({
  entities: [{ id: 'us-uat', label: 'US UAT' }, { id: 'us-production', label: 'US Production' }],
  activeEntity: { id: 'us-uat' },
  retrieveLists: vi.fn<() => Promise<string>>(),
}));

vi.mock('./components/AuthStatus', () => ({
  AuthStatus: () => <div>Auth status</div>,
}));
vi.mock('./components/ApiLogsView', () => ({
  ApiLogsView: () => <div>API logs view</div>,
}));
vi.mock('./components/ExpenseConfigView', () => ({
  ExpenseConfigView: () => <div>Expense configuration view</div>,
}));
vi.mock('./components/SaeCheckView', () => ({
  SaeCheckView: () => <div>SAE file check view</div>,
}));
vi.mock('./components/ListsView', () => ({
  ListsView: () => {
    const [status, setStatus] = useState('Lists view');
    return <div>
      <button onClick={async () => {
        setStatus('Retrieving');
        setStatus(await retrieveLists());
      }}>Retrieve lists</button>
      <p>{status}</p>
    </div>;
  },
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
vi.mock('./components/LocalitiesView', () => ({
  LocalitiesView: () => <div>Localities view</div>,
}));
vi.mock('./components/ReportsView', () => ({
  ReportsView: () => <div>Reports view</div>,
}));
vi.mock('./entities/entityStore', () => ({
  getActiveEntityId: () => activeEntity.id,
  getEntities: () => entities,
  setActiveEntity: vi.fn(),
  subscribeEntities: () => () => {},
}));
vi.mock('./auth/tokenStore', () => ({
  initAuth: vi.fn(),
  selectAuthEntity: vi.fn(),
  entityHasToken: () => true,
  subscribe: () => () => {},
}));

describe('App navigation', () => {
  afterEach(() => {
    cleanup();
    resetViewNavigation();
    retrieveLists.mockReset();
    activeEntity.id = 'us-uat';
  });

  const workspaceFrame = () => screen.getByRole('navigation', { name: 'Configuration categories' }).parentElement!;

  it('frames the workspace in the UAT color while a UAT entity is active', () => {
    render(<App />);

    expect(workspaceFrame()).toHaveAttribute('data-environment', 'uat');
    expect(workspaceFrame()).toHaveClass('border-4', 'border-uat');
  });

  it('keeps the frame space but leaves it uncolored for a production entity', () => {
    activeEntity.id = 'us-production';
    render(<App />);

    expect(workspaceFrame()).not.toHaveAttribute('data-environment');
    expect(workspaceFrame()).toHaveClass('border-4', 'border-transparent');
    expect(workspaceFrame()).not.toHaveClass('border-uat');
  });

  it('highlights the active sidebar item in the same tone as the entity picker', () => {
    render(<App />);
    expect(sidebar().getByRole('button', { name: 'Home' })).toHaveClass('border-uat/30', 'bg-uat/5', 'text-uat');
    expect(screen.getByRole('button', { name: 'Active entity: US UAT' })).toHaveClass('border-uat/30', 'bg-uat/5', 'text-uat');
    cleanup();

    activeEntity.id = 'us-production';
    render(<App />);
    const home = sidebar().getByRole('button', { name: 'Home' });
    expect(home).toHaveClass('border-primary/25', 'bg-primary/5', 'text-primary');
    expect(home).not.toHaveClass('bg-uat/5');
    expect(screen.getByRole('button', { name: 'Active entity: US Production' })).toHaveClass('border-primary/25', 'bg-primary/5', 'text-primary');
  });

  const sidebar = () => within(screen.getByRole('navigation', { name: 'Configuration categories' }));

  it('starts on Home and shows each registered feature in the directory and sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Reading from US UAT', level: 1 })).toBeVisible();
    expect(sidebar().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Lists view')).not.toBeInTheDocument();
    const directory = within(screen.getByRole('main'));
    for (const { label, summary } of categories) {
      expect(directory.getByRole('button', { name: label })).toHaveAccessibleDescription(summary);
      expect(sidebar().getByRole('button', { name: label })).toBeVisible();
    }

    await user.click(directory.getByRole('button', { name: 'API Logs' }));
    expect(screen.getByText('API logs view')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'API Logs' })).toHaveFocus();
  });

  it('keeps a retrieval running on Home and shows its result when the user returns', async () => {
    const user = userEvent.setup();
    let finishRetrieval!: (result: string) => void;
    retrieveLists.mockReturnValue(new Promise((resolve) => { finishRetrieval = resolve; }));
    render(<App />);

    await user.click(sidebar().getByRole('button', { name: 'Lists' }));
    await user.click(screen.getByRole('button', { name: 'Retrieve lists' }));
    expect(screen.getByText('Retrieving')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'About Lists' }));
    await user.click(within(screen.getByRole('dialog', { name: 'About Lists' })).getByRole('button', { name: 'Go to Home' }));
    expect(screen.queryByRole('button', { name: 'Retrieve lists' })).not.toBeInTheDocument();
    expect(sidebar().getByRole('button', { name: 'Home' })).toHaveFocus();

    await act(async () => finishRetrieval('Retrieval complete'));
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Lists' }));
    expect(screen.getByText('Retrieval complete')).toBeVisible();
    expect(retrieveLists).toHaveBeenCalledTimes(1);
  });

  it('opens the Identity page from the Users menu', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(sidebar().getByRole('button', { name: 'Identity' }));

    expect(screen.getByText('Users view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Identity' })).toBeInTheDocument();
  });

  it('opens the Forms & Fields page from the sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(sidebar().getByRole('button', { name: 'Forms & Fields' }));

    expect(screen.getByText('Forms view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Forms & Fields' })).toBeInTheDocument();
  });

  it('opens the Locations page from the sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(sidebar().getByRole('button', { name: 'Locations' }));

    expect(screen.getByText('Locations view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Locations' })).toBeInTheDocument();
  });

  it('opens the Localities page from the sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(sidebar().getByRole('button', { name: 'Localities' }));

    expect(screen.getByText('Localities view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Localities' })).toBeInTheDocument();
  });

  it('opens the Expense Reports page from the sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(sidebar().getByRole('button', { name: 'Expense Reports' }));

    expect(screen.getByText('Reports view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Expense Reports' })).toBeInTheDocument();
  });

  it.each([
    ...categories.map(({ label, description }) => [label, description] as const),
  ])('opens the description for %s in a dialog and returns focus on close', async (label, description) => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: label }));
    const aboutTitle = `About ${label}`;
    const help = screen.getByRole('button', { name: aboutTitle });
    expect(screen.queryByText(description)).not.toBeInTheDocument();
    expect(help).toHaveTextContent(/^$/);
    expect(help).toHaveAttribute('title', aboutTitle);
    expect(help).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(help);
    const dialog = screen.getByRole('dialog', { name: aboutTitle });
    expect(within(dialog).getByText(description)).toBeVisible();
    expect(within(screen.getByRole('main')).queryByText(description)).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(help).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: aboutTitle })).not.toBeInTheDocument();

    await user.keyboard('{Enter}');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(description)).not.toBeInTheDocument();
    expect(help).toHaveFocus();
  });

  it('shows the active entity and clears the category highlight for API Logs', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByLabelText('Active entity: US UAT')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connection settings' })).not.toBeInTheDocument();
    await user.click(sidebar().getByRole('button', { name: 'API Logs' }));

    expect(screen.getByRole('button', { name: 'API Logs' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Lists' })).not.toHaveAttribute('aria-current');
  });

  it('starts with a compact icon rail and can expand without losing category access', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: 'Configuration categories' });
    const toggle = screen.getByRole('button', { name: 'Expand navigation' });
    expect(navigation).toHaveClass('w-16');
    expect(navigation).toHaveClass('bg-muted', 'text-foreground', 'border-border');
    expect(sidebar().getByRole('button', { name: 'Home' })).toHaveClass('border-uat/30', 'bg-uat/5', 'text-uat', 'focus-visible:ring-ring');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(sidebar().getByRole('button', { name: 'Identity' }));
    expect(screen.getByText('Users view')).toBeInTheDocument();

    await user.click(toggle);
    expect(navigation).toHaveClass('w-64');
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('switches to the requested category when a view publishes a navigation request', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Reading from US UAT' })).toBeVisible();

    act(() => navigateToCategory('reports'));

    expect(screen.getByText('Reports view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Expense Reports' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expense Reports' })).toHaveAttribute('aria-current', 'page');
  });

  it('leaves API Logs when a view requests a category', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(sidebar().getByRole('button', { name: 'API Logs' }));
    expect(screen.getByText('API logs view')).toBeInTheDocument();

    act(() => navigateToCategory('users'));

    expect(screen.getByText('Users view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API Logs' })).not.toHaveAttribute('aria-current');
  });
});
