import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';

describe('Modal', () => {
  it('exposes itself as a labelled dialog', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Add a recipe">
        <p>Body</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Add a recipe');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Confirm">
        <p>Body</p>
      </Modal>,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes when the backdrop is clicked but not the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { container } = render(
      <Modal isOpen onClose={onClose} title="Confirm">
        <p>Body</p>
      </Modal>,
    );

    await user.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();

    const overlay = container.ownerDocument.querySelector('.modal-overlay')!;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();

    render(
      <Modal isOpen onClose={() => {}} title="Trap">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close dialog' });
    const last = screen.getByRole('button', { name: 'Last' });

    // The dialog takes focus in a requestAnimationFrame on open. Waiting for
    // that to land first keeps this test from racing it.
    await waitFor(() => expect(dialog).toHaveFocus());

    // Forward from the final control wraps round to the first.
    last.focus();
    await user.tab();
    expect(close).toHaveFocus();

    // Backward from the first control wraps round to the last.
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('returns focus to the element that opened it', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Modal isOpen={open} onClose={() => setOpen(false)} title="Dialog">
            <p>Body</p>
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });

  it('renders nothing when closed', () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="Hidden">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
