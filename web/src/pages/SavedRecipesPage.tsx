import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RecipeCard } from '../components/RecipeCard';
import { Pagination } from '../components/Pagination';
import { RecipeGridSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useAuth } from '../context/AuthContext';
import { useSavedIds, useSavedRecipes, useToggleSave } from '../lib/queries';
import { ApiError } from '../lib/api';

export default function SavedRecipesPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);

  const { data, isPending, isError, error, refetch } = useSavedRecipes(page);
  const savedIds = useSavedIds();
  const toggleSave = useToggleSave();

  if (isPending) return <RecipeGridSkeleton />;

  if (isError) {
    return (
      <ErrorState
        message={error instanceof ApiError ? error.message : 'Could not load your saved recipes.'}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="saved-recipes-page">
      <h1>Saved recipes</h1>

      {data.items.length === 0 ? (
        <EmptyState
          icon="star"
          title="You haven't saved any recipes yet"
          message="Tap the star on any recipe to keep it here."
          action={
            <Link to="/" className="btn-primary">
              Browse recipes
            </Link>
          }
        />
      ) : (
        <div id="recipe-grid">
          {data.items.map((recipe) => (
            <RecipeCard
              key={recipe._id}
              recipe={recipe}
              currentUserId={user?.uid}
              isSaved={savedIds.has(recipe._id)}
              // Un-saving invalidates this list, so the card leaves the page.
              // It previously stayed on screen until a manual refresh.
              onToggleSave={(id) => toggleSave.mutate(id)}
            />
          ))}
        </div>
      )}

      <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
    </div>
  );
}
