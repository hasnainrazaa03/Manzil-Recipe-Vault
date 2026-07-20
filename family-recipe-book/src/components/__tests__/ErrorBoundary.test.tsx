import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../ErrorBoundary';

function Boom({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('Cannot read properties of undefined');
  return <p>Recovered content</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs caught errors to console.error; that noise is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('shows a recoverable fallback instead of unmounting the tree', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    // The regression this guards: an undefined list threw during render and
    // took the whole application down to a blank page.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).toHaveTextContent('Cannot read properties of undefined');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('clears the error when Try again is pressed', async () => {
    const user = userEvent.setup();

    function Harness() {
      return (
        <ErrorBoundary>
          <Boom shouldThrow={false} />
        </ErrorBoundary>
      );
    }

    const { rerender } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    rerender(<Harness />);

    expect(screen.getByText('Recovered content')).toBeInTheDocument();
  });

  it('resets when the resetKey changes, so navigating away clears the error', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/broken">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/somewhere-else">
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Recovered content')).toBeInTheDocument();
  });

  it('uses a custom fallback when given one', () => {
    render(
      <ErrorBoundary fallback={(error) => <p>Custom: {error.message}</p>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Custom: Cannot read properties of undefined/)).toBeInTheDocument();
  });
});
