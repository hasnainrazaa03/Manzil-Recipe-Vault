import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The All / My recipes toggle, which had no test at all — which is how it came
 * to render as two loose pills whose widths changed as you clicked between
 * them, and how it kept rendering signed out where "My recipes" cannot exist.
 *
 * Auth is stubbed at the module boundary rather than through the real provider,
 * because the real one talks to Firebase. Stubbing lives in its own file: the
 * mock is hoisted to the top of whichever module declares it, so mixing signed
 * in and signed out cases in one file would silently sign in the tests next
 * door.
 */
const authState = { user: null as { uid: string } | null };

vi.mock('../../context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: authState.user, isLoading: false, logout: async () => {} }),
}));

import HomePage from '../HomePage';
import { ThemeProvider } from '../../context/ThemeContext';
import { RecipeEditorProvider } from '../../context/RecipeEditorContext';
import { makeRecipeSummary, paginated } from '../../test/factories';
import { API, HttpResponse, http, server } from '../../test/mswServer';

function Search() {
  return <span data-testid="search">{useLocation().search}</span>;
}

function renderHome(route = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[route]}>
          <RecipeEditorProvider>
            <Search />
            <HomePage />
          </RecipeEditorProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const toggle = () => screen.queryByRole('navigation', { name: /recipe collection/i });

describe('the recipe collection toggle', () => {
  it('offers both collections to someone signed in', () => {
    authState.user = { uid: 'cook-1' };
    renderHome();

    expect(screen.getByRole('button', { name: 'All recipes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My recipes' })).toBeInTheDocument();
  });

  /**
   * A segmented control with one segment is a label pretending to be a choice.
   * Signed out there is only one collection, so the control has nothing to
   * toggle between and should not be drawn at all.
   */
  it('is not drawn at all when signed out', () => {
    authState.user = null;
    renderHome();

    expect(toggle()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'My recipes' })).not.toBeInTheDocument();
  });

  it('puts the chosen collection in the URL and takes it back out', async () => {
    authState.user = { uid: 'cook-1' };
    const person = userEvent.setup();
    server.use(
      http.get(`${API}/api/recipes`, () => HttpResponse.json(paginated([makeRecipeSummary()]))),
    );

    renderHome();

    await person.click(screen.getByRole('button', { name: 'My recipes' }));
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('view=mine'));

    await person.click(screen.getByRole('button', { name: 'All recipes' }));
    await waitFor(() => expect(screen.getByTestId('search')).not.toHaveTextContent('view=mine'));
  });

  /**
   * Which segment is selected is announced, not merely coloured. Someone using
   * a screen reader gets no benefit from the highlight.
   */
  it('announces which segment is selected', async () => {
    authState.user = { uid: 'cook-1' };
    const person = userEvent.setup();
    renderHome();

    const all = screen.getByRole('button', { name: 'All recipes' });
    const mine = screen.getByRole('button', { name: 'My recipes' });

    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(mine).toHaveAttribute('aria-pressed', 'false');

    await person.click(mine);

    await waitFor(() => expect(mine).toHaveAttribute('aria-pressed', 'true'));
    expect(all).toHaveAttribute('aria-pressed', 'false');
  });
});
