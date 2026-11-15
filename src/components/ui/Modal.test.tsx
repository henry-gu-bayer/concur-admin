import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Modal } from './Modal';
import { WorkspaceVisible } from '../../state/workspaceVisibility';

function Fixture() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open details</button>
    <Modal open={open} onClose={() => setOpen(false)} title="Details" description="Dialog details">
      <button type="button">First action</button>
      <button type="button">Last action</button>
    </Modal>
  </>;
}

describe('Modal focus management', () => {
  afterEach(cleanup);

  it('moves focus inside, traps Tab, and restores the trigger on close', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: 'Open details' });
    await user.click(trigger);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
    screen.getByRole('button', { name: 'Last action' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('releases keyboard and scroll handling while its workspace is hidden', async () => {
    const user = userEvent.setup();
    const view = (visible: boolean) => (
      <div hidden={!visible}>
        <WorkspaceVisible.Provider value={visible}><Fixture /></WorkspaceVisible.Provider>
      </div>
    );
    const { rerender } = render(view(true));
    await user.click(screen.getByRole('button', { name: 'Open details' }));
    expect(document.body.style.overflow).toBe('hidden');

    rerender(view(false));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    await user.keyboard('{Escape}');

    rerender(view(true));
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
  });
});
