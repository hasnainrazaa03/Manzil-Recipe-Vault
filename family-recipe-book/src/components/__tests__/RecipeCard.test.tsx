import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeCard } from '../RecipeCard';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeRecipeSummary } from '../../test/factories';

describe('RecipeCard', () => {
  it('links the title to the recipe detail page', () => {
    const recipe = makeRecipeSummary();
    renderWithProviders(<RecipeCard recipe={recipe} />);

    expect(screen.getByRole('link', { name: recipe.title })).toHaveAttribute(
      'href',
      `/recipe/${recipe._id}`,
    );
  });

  it('shows the author display name, never an email address', () => {
    renderWithProviders(<RecipeCard recipe={makeRecipeSummary({ authorName: 'Amina' })} />);

    expect(screen.getByText('Amina')).toBeInTheDocument();
    // Regression: recipes used to carry authorEmail in every list payload.
    expect(document.body.textContent).not.toMatch(/@/);
  });

  it('reports the save state through aria-pressed', async () => {
    const user = userEvent.setup();
    const onToggleSave = vi.fn();
    const recipe = makeRecipeSummary();

    const { rerender } = renderWithProviders(
      <RecipeCard recipe={recipe} isSaved={false} onToggleSave={onToggleSave} />,
    );

    const button = screen.getByRole('button', { name: `Save ${recipe.title}` });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);
    expect(onToggleSave).toHaveBeenCalledWith(recipe._id);

    rerender(<RecipeCard recipe={recipe} isSaved onToggleSave={onToggleSave} />);
    expect(
      screen.getByRole('button', { name: `Remove ${recipe.title} from saved` }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers edit and delete only to the author', () => {
    const recipe = makeRecipeSummary({ author: 'user-1' });
    const handlers = { onEdit: vi.fn(), onDelete: vi.fn() };

    const { rerender } = renderWithProviders(
      <RecipeCard recipe={recipe} currentUserId="someone-else" {...handlers} />,
    );
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();

    rerender(<RecipeCard recipe={recipe} currentUserId="user-1" {...handlers} />);
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('describes an unrated recipe rather than showing a bare zero', () => {
    renderWithProviders(
      <RecipeCard recipe={makeRecipeSummary({ averageRating: 0, ratingCount: 0 })} />,
    );

    expect(screen.getByText('Not yet rated')).toBeInTheDocument();
  });

  it('hides the save button for signed-out visitors', () => {
    renderWithProviders(<RecipeCard recipe={makeRecipeSummary()} />);
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });
});
