import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../CommandPalette';
import { renderWithProviders } from '../../test/renderWithProviders';
import { API, HttpResponse, http, server } from '../../test/mswServer';
import { makeRecipeSummary, paginated } from '../../test/factories';

const open = (onClose = vi.fn()) => {
  const result = renderWithProviders(<CommandPalette isOpen onClose={onClose} />, {
    withAppProviders: true,
  });
  return { ...result, onClose };
};

describe('CommandPalette', () => {
  it('is a combobox driving a listbox', () => {
    open();

    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', 'palette-list');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('offers navigation commands before anything is typed', () => {
    open();

    expect(screen.getByRole('option', { name: /All recipes/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Shopping list/ })).toBeInTheDocument();
  });

  it('takes focus so typing works immediately', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
  });

  it('filters the command list as you type', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByRole('combobox'), 'shopping');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Shopping list/ })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /All recipes/ })).not.toBeInTheDocument();
    });
  });

  it('moves the selection with the arrow keys without losing focus', async () => {
    const user = userEvent.setup();
    open();

    const input = screen.getByRole('combobox');
    await waitFor(() => expect(input).toHaveFocus());

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');

    // Focus must stay in the field — the selection is conveyed by
    // aria-activedescendant, not by moving focus.
    expect(input).toHaveFocus();
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'palette-option-1');
  });

  it('wraps around at the end of the list', async () => {
    const user = userEvent.setup();
    open();

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    const count = screen.getAllByRole('option').length;
    for (let i = 0; i < count; i += 1) await user.keyboard('{ArrowDown}');

    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('runs the selected command on Enter', async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.keyboard('{Enter}');

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = open();

    await user.type(screen.getByRole('combobox'), '{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('searches recipes once the query is long enough', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/api/recipes`, () =>
        HttpResponse.json(paginated([makeRecipeSummary({ title: 'Karahi Gosht' })])),
      ),
    );

    open();
    await user.type(screen.getByRole('combobox'), 'karahi');

    await waitFor(
      () => expect(screen.getByRole('option', { name: /Karahi Gosht/ })).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('does not search for a one-character query', async () => {
    const user = userEvent.setup();
    const handler = vi.fn(() => HttpResponse.json(paginated([])));
    server.use(http.get(`${API}/api/recipes`, handler));

    open();
    await user.type(screen.getByRole('combobox'), 'k');

    // Long enough for the debounce to have fired had the query qualified.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(handler).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    renderWithProviders(<CommandPalette isOpen={false} onClose={vi.fn()} />, {
      withAppProviders: true,
    });

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
