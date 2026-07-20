import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../context/ThemeContext';
import { AuthProvider } from '../context/AuthContext';
import { RecipeEditorProvider } from '../context/RecipeEditorContext';

interface Options extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  /** Include the auth and recipe-editor contexts. Off by default so a simple
   *  presentational component does not drag the whole provider tree in. */
  withAppProviders?: boolean;
}

/**
 * Renders with the providers a component would have in the real tree. Retries
 * are off so a deliberately failing request surfaces immediately rather than
 * after backoff.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', withAppProviders = false, ...options }: Options = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    const routed = <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>;

    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {withAppProviders ? (
            <AuthProvider>
              <MemoryRouter initialEntries={[route]}>
                <RecipeEditorProvider>{children}</RecipeEditorProvider>
              </MemoryRouter>
            </AuthProvider>
          ) : (
            routed
          )}
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}
