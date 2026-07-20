import { useState } from 'react';
import { Link } from 'react-router-dom';

import { RecipeCard } from '../components/RecipeCard';
import { Pagination } from '../components/Pagination';
import { RecipeGridSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { FollowSuggestions } from '../components/FollowSuggestions';

import { useAuth } from '../context/AuthContext';
import { useFeed, useSavedIds, useToggleSave } from '../lib/queries';
import { ApiError } from '../lib/api';

export default function FeedPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);

  const { data, isPending, isError, error, refetch } = useFeed(page);
  const savedIds = useSavedIds();
  const toggleSave = useToggleSave();

  if (isPending) return <RecipeGridSkeleton />;

  if (isError) {
    return (
      <ErrorState
        message={error instanceof ApiError ? error.message : 'Could not load your feed.'}
        onRetry={() => void refetch()}
      />
    );
  }

  const isEmpty = data.items.length === 0;

  return (
    <div className="feed-page">
      <h1>Your feed</h1>

      {/* Two different nothings. "You follow nobody" is a thing the reader can
          fix here and now; "nobody has posted" is not, and offering
          suggestions for it would be noise. */}
      {isEmpty && !data.followsAnyone ? (
        <div className="feed-empty feed-empty--no-follows">
          <EmptyState
            icon="users"
            title="You are not following anyone yet"
            message="Your feed shows the newest recipes from the cooks you follow. Follow a few people to fill it."
          />
          <FollowSuggestions description="Start with one of these — you can unfollow at any time." />
        </div>
      ) : isEmpty ? (
        <div className="feed-empty feed-empty--quiet">
          <EmptyState
            icon="book"
            title="Nothing new yet"
            message="Nobody you follow has posted a recipe. When they do, it appears here first."
            action={
              <Link to="/" className="btn-secondary">
                Browse all recipes
              </Link>
            }
          />
          <FollowSuggestions title="Follow a few more cooks" />
        </div>
      ) : (
        <div id="recipe-grid">
          {data.items.map((recipe) => (
            <RecipeCard
              key={recipe._id}
              recipe={recipe}
              currentUserId={user?.uid}
              isSaved={savedIds.has(recipe._id)}
              onToggleSave={(recipeId) => toggleSave.mutate(recipeId)}
            />
          ))}
        </div>
      )}

      <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
    </div>
  );
}
