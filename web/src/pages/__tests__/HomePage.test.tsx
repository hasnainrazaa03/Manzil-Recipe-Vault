import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import HomePage from '../HomePage';
import { ThemeProvider } from '../../context/ThemeContext';
import { AuthProvider } from '../../context/AuthContext';
import { RecipeEditorProvider } from '../../context/RecipeEditorContext';
import { API, HttpResponse, http, server } from '../../test/mswServer';
import { makeRecipeSummary, paginated } from '../../test/factories';

function LocationProbe({ navigations }: { navigations: string[] }) {
  const location = useLocation();
  if (navigations[navigations.length - 1] !== location.key) navigations.push(location.key);
  return <span data-testid="search">{location.search}</span>;
}

function renderHome(initialEntry = '/') {
  const navigations: string[] = [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <RecipeEditorProvider>
              <LocationProbe navigations={navigations} />
              <HomePage />
            </RecipeEditorProvider>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

  // The first entry is the initial location, not a navigation.
  return { navigations, count: () => Math.max(0, navigations.length - 1) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 900));

describe('HomePage URL state', () => {
  /**
   * Regression for a self-sustaining navigation loop.
   *
   * `SearchFilters`' debounce effect depends on `onSearchChange`, which the page
   * recreated on every render. Firing it pushed a navigation, the navigation
   * re-rendered the page, the page minted a new callback, and the effect
   * re-armed — several navigations a second, forever, on the most-visited page
   * in the app, on the mobile devices it is aimed at.
   */
  it('does not navigate on its own when left alone', async () => {
    const { count } = renderHome('/');
    await settle();

    expect(count()).toBe(0);
  });

  /**
   * The visible symptom of the same bug: each loop iteration ran the
   * "a filter changed, go back to page 1" branch, so the reader was bounced off
   * any page but the first within about a third of a second.
   */
  it('stays on the requested page', async () => {
    renderHome('/?page=2');
    await settle();

    expect(screen.getByTestId('search')).toHaveTextContent('page=2');
  });

  it('keeps other filters in the URL untouched', async () => {
    renderHome('/?q=cake&tag=dessert&sort=rating');
    await settle();

    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('q=cake');
    expect(search).toContain('tag=dessert');
    expect(search).toContain('sort=rating');
  });

  it('still returns to page 1 when a filter genuinely changes', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/api/recipes`, () =>
        HttpResponse.json(paginated([makeRecipeSummary()], { totalPages: 3 })),
      ),
    );

    renderHome('/?page=3');
    await settle();
    expect(screen.getByTestId('search')).toHaveTextContent('page=3');

    await user.type(screen.getByRole('searchbox', { name: /search recipes/i }), 'cake');

    await waitFor(() => {
      const search = screen.getByTestId('search').textContent ?? '';
      expect(search).toContain('q=cake');
      expect(search).not.toContain('page=3');
    });
  });

  it('records one navigation per search, not one per render', async () => {
    const user = userEvent.setup();
    const { count } = renderHome('/');
    await settle();

    await user.type(screen.getByRole('searchbox', { name: /search recipes/i }), 'cake');
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('q=cake'));
    await settle();

    // One for the debounced search. Anything more means the loop is back.
    expect(count()).toBe(1);
  });
});
