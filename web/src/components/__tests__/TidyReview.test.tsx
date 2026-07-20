import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TidyReview, type AcceptedTidy } from '../TidyReview';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { TidyResult } from '../../types';

/**
 * The screen the whole feature rests on.
 *
 * A model rewriting someone's recipe is only acceptable if the author sees the
 * result before it becomes theirs. These tests are about consent, not layout:
 * what is shown, what is applied, and — most of all — what is *not* applied
 * without being asked for.
 */

const current = {
  ingredients: [
    { amount: '2', name: 'onion chopped' },
    { amount: '', name: 'tomatoes' },
  ],
  instructions: '<p>fry onions add tomatoes cook till done</p>',
};

const proposal: TidyResult = {
  title: 'Chicken Curry',
  overview: 'A simple curry.',
  ingredients: [
    { amount: '2', name: 'onions, chopped' },
    { amount: '', name: 'tomatoes', amountRemoved: true },
  ],
  instructions: '<p>Fry the onions.</p><p>Add the tomatoes and cook until done.</p>',
  suggestions: {
    cuisine: { value: 'Pakistani', inferred: true },
    difficulty: { value: 'easy', inferred: true },
    cookMinutes: { value: 30, inferred: true },
  },
  warnings: ['The assistant suggested an amount you had not written for tomatoes (400 g).'],
};

function show(overrides: Partial<TidyResult> = {}) {
  const onApply = vi.fn<(accepted: AcceptedTidy) => void>();
  const onClose = vi.fn();

  renderWithProviders(
    <TidyReview
      isOpen
      proposal={{ ...proposal, ...overrides }}
      current={current}
      onClose={onClose}
      onApply={onApply}
    />,
  );

  return { onApply, onClose, person: userEvent.setup() };
}

describe('showing the author what changed', () => {
  it('puts what they wrote beside what came back', () => {
    show();

    expect(screen.getByText('2 onion chopped')).toBeInTheDocument();
    expect(screen.getByText('onions, chopped')).toBeInTheDocument();
  });

  it('says plainly that nothing is saved yet', () => {
    show();

    expect(screen.getByText(/nothing is saved yet/i)).toBeInTheDocument();
  });

  /**
   * The warnings are the places the assistant tried to invent a quantity and
   * was stopped. They are the most important thing on the screen and must be
   * announced, not merely rendered somewhere in it.
   */
  it('announces the warnings rather than tucking them away', () => {
    show();

    const alert = screen.getByRole('alert');

    expect(within(alert).getByText(/tomatoes \(400 g\)/)).toBeInTheDocument();
  });

  it('marks the specific row whose amount was removed', () => {
    show();

    expect(screen.getByText('amount removed')).toBeInTheDocument();
  });

  it('says so when the method was left untouched, instead of showing an empty diff', () => {
    show({ instructions: current.instructions });

    expect(screen.getByText(/kept exactly as you typed it/i)).toBeInTheDocument();
  });
});

describe('applying only what was agreed to', () => {
  it('applies the tidied ingredients and method', async () => {
    const { onApply, person } = show();

    await person.click(screen.getByRole('button', { name: /apply to the form/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const accepted = onApply.mock.calls[0]![0];

    expect(accepted.ingredients).toEqual([
      { amount: '2', name: 'onions, chopped' },
      { amount: '', name: 'tomatoes' },
    ]);
    expect(accepted.instructions).toBe(proposal.instructions);
  });

  /**
   * The one that matters most.
   *
   * Guesses are pre-ticked in most products, which means a distracted author
   * accepts an invented cuisine and cook time by pressing the obvious button —
   * the same outcome as never asking, reached more slowly. Nothing inferred may
   * ride along with the reformatting.
   */
  it('applies no guess that was not ticked', async () => {
    const { onApply, person } = show();

    await person.click(screen.getByRole('button', { name: /apply to the form/i }));

    expect(onApply.mock.calls[0]![0].suggestions).toEqual({});
  });

  it('applies exactly the guesses that were ticked, and no others', async () => {
    const { onApply, person } = show();

    await person.click(screen.getByRole('checkbox', { name: /cuisine/i }));
    await person.click(screen.getByRole('button', { name: /apply to the form/i }));

    expect(onApply.mock.calls[0]![0].suggestions).toEqual({ cuisine: 'Pakistani' });
  });

  it('lets a guess be ticked and unticked again', async () => {
    const { onApply, person } = show();

    const box = screen.getByRole('checkbox', { name: /cook time/i });
    await person.click(box);
    await person.click(box);
    await person.click(screen.getByRole('button', { name: /apply to the form/i }));

    expect(onApply.mock.calls[0]![0].suggestions).toEqual({});
  });

  it('shows each guess with the value it is proposing, so it can be judged', () => {
    show();

    expect(screen.getByText('Pakistani')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
  });

  it('applies nothing at all when discarded', async () => {
    const { onApply, onClose, person } = show();

    await person.click(screen.getByRole('button', { name: /discard/i }));

    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('when there is nothing to review', () => {
  it('renders nothing rather than an empty dialog', () => {
    const { container } = renderWithProviders(
      <TidyReview
        isOpen
        proposal={null}
        current={current}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('omits the guesses section entirely when the assistant offered none', () => {
    show({ suggestions: {} });

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows no warning banner when nothing was refused', () => {
    show({ warnings: [] });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
