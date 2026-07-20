import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { RecipeCard } from '../components/RecipeCard';
import { Pagination } from '../components/Pagination';
import { RecipeGridSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { useRecipeEditor } from '../context/RecipeEditorContext';
import { useFetchRecipeDetail, useProfile, useSavedIds, useToggleSave } from '../lib/queries';
import { ApiError } from '../lib/api';
import type { RecipeSummary } from '../types';

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const { openCreate, openEdit, confirmDelete } = useRecipeEditor();
  const [page, setPage] = useState(1);

  const { data, isPending, isError, error, refetch } = useProfile(userId, page);
  const savedIds = useSavedIds();
  const toggleSave = useToggleSave();
  const fetchRecipeDetail = useFetchRecipeDetail();

  const isOwner = Boolean(user && user.uid === userId);

  const handleEdit = async (recipe: RecipeSummary) => {
    const full = await fetchRecipeDetail(recipe._id);
    if (full) openEdit(full);
    else toast.error('Could not open that recipe for editing.');
  };

  if (isPending) return <RecipeGridSkeleton />;

  // A failed profile fetch renders this instead of leaving `recipes` undefined
  // and throwing on the next `.length`, which blanked the whole page.
  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <ErrorState
        title={notFound ? 'User not found' : 'Could not load this profile'}
        message={
          notFound
            ? 'This cook does not exist, or has not shared anything yet.'
            : error instanceof ApiError
              ? error.message
              : 'Something went wrong.'
        }
        onRetry={notFound ? undefined : () => void refetch()}
      />
    );
  }

  const { user: profile, recipes } = data;

  return (
    <div className="profile-page">
      <header className="profile-header">
        <div className="profile-info">
          {profile.profilePictureUrl ? (
            <img src={profile.profilePictureUrl} alt="" className="profile-avatar" />
          ) : (
            <div className="profile-avatar profile-avatar--placeholder" aria-hidden="true">
              <Icon name="user" size={32} />
            </div>
          )}
          <div>
            <h1>{profile.displayName}</h1>
            {profile.bio && <p className="profile-bio">{profile.bio}</p>}
            <p className="profile-stats">
              {profile.recipeCount} {profile.recipeCount === 1 ? 'recipe' : 'recipes'}
            </p>
          </div>
        </div>

        {isOwner && (
          <Link to="/profile/edit" className="edit-profile-btn">
            <Icon name="edit" size={16} />
            <span>Edit profile</span>
          </Link>
        )}
      </header>

      {recipes.items.length === 0 ? (
        <EmptyState
          icon="book"
          title={isOwner ? "You haven't added any recipes yet" : `${profile.displayName} hasn't shared any recipes yet`}
          action={
            isOwner ? (
              <button type="button" onClick={openCreate} className="btn-primary">
                Add your first recipe
              </button>
            ) : undefined
          }
        />
      ) : (
        <div id="recipe-grid">
          {recipes.items.map((recipe) => (
            <RecipeCard
              key={recipe._id}
              recipe={recipe}
              currentUserId={user?.uid}
              isSaved={savedIds.has(recipe._id)}
              onToggleSave={user ? (id) => toggleSave.mutate(id) : undefined}
              onEdit={isOwner ? handleEdit : undefined}
              onDelete={isOwner ? (target) => confirmDelete(target) : undefined}
            />
          ))}
        </div>
      )}

      <Pagination page={recipes.page} totalPages={recipes.totalPages} onChange={setPage} />
    </div>
  );
}
