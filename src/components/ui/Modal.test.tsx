import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Modal } from './Modal';

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
});
