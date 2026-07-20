import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StarRating } from '../StarRating';

describe('StarRating', () => {
  it('presents a read-only rating as a single labelled image', () => {
    render(<StarRating value={4.5} label="Average rating" />);

    expect(screen.getByRole('img', { name: 'Average rating: 4.5 out of 5' })).toBeInTheDocument();
    // Nothing to interact with, so nothing should be in the tab order.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('presents an editable rating as a radio group', () => {
    render(<StarRating value={3} onChange={() => {}} label="Your rating" />);

    expect(screen.getByRole('radiogroup', { name: 'Your rating' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: '3 stars' })).toBeChecked();
  });

  it('reports the chosen score on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<StarRating value={0} onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: '4 stars' }));

    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('moves the score with the arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<StarRating value={3} onChange={onChange} />);
    screen.getByRole('radio', { name: '3 stars' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(4);

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('clamps arrow-key movement at both ends', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const { rerender } = render(<StarRating value={5} onChange={onChange} />);
    screen.getByRole('radio', { name: '5 stars' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(5);

    rerender(<StarRating value={1} onChange={onChange} />);
    screen.getByRole('radio', { name: '1 star' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('is a single tab stop', () => {
    render(<StarRating value={2} onChange={() => {}} />);

    const tabbable = screen
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });

  it('does not fire while disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<StarRating value={0} onChange={onChange} disabled />);
    // Disabled falls back to the read-only presentation.
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    await user.click(screen.getByRole('img'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
