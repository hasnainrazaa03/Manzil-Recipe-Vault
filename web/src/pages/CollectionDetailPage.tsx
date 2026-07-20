import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';

import { RecipeCard } from '../components/RecipeCard';
import { Pagination } from '../components/Pagination';
import { RecipeGridSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CollectionFormModal } from '../components/CollectionFormModal';
import { Icon } from '../components/Icon';

import { useAuth } from '../context/AuthContext';
import {
  useCollection,
  useDeleteCollection,
  useSavedIds,
  useToggleSave,
  useUpdateCollection,
} from '../lib/queries';
import { ApiError } from '../lib/api';
import type { CollectionInput } from '../types';

export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const { data, isPending, isError, error, refetch } = useCollection(id, page);
  const savedIds = useSavedIds();
  const toggleSave = useToggleSave();
  const updateCollection = useUpdateCollection();
  const deleteCollection = useDeleteCollection();

  if (isPending) return <RecipeGridSkeleton />;

  /**
   * A private collection answers 404 rather than 403 — the server will not
   * confirm that an id it will not show you exists at all — so both cases land
   * here and share one message.
   */
  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <ErrorState
        title={notFound ? 'Collection not found' : 'Could not load this collection'}
        message={
          notFound
            ? 'It may have been deleted, or it may be private. Private collections are only visible to the person who made them.'
            : error instanceof ApiError
              ? error.message
              : 'Something went wrong.'
        }
        onRetry={notFound ? undefined : () => void refetch()}
      />
    );
  }

  const { collection, recipes } = data;
  const isOwner = Boolean(collection.isOwner);

  const handleUpdate = async (input: CollectionInput) => {
    if (!id) return;
    setErrors([]);
    try {
      await updateCollection.mutateAsync({ id, input });
      setIsEditOpen(false);
      toast.success('Collection updated.');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setErrors(caught.fieldMessages.length > 0 ? caught.fieldMessages : [caught.message]);
      } else {
        setErrors([(caught as Error).message || 'Could not save that collection.']);
      }
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteCollection.mutateAsync(id);
      setIsDeleteOpen(false);
      toast.success(`Deleted “${collection.name}”.`);
      navigate('/collections');
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : 'Could not delete that collection.',
      );
    }
  };

  return (
    <div className="collection-detail-page">
      <header className="collection-detail-header">
        <div className="collection-detail-info">
          <h1>{collection.name}</h1>
          {collection.description && (
            <p className="collection-detail-description">{collection.description}</p>
          )}
          <p className="collection-detail-meta">
            <span className="collection-card-count">
              {collection.recipeCount} {collection.recipeCount === 1 ? 'recipe' : 'recipes'}
            </span>
            <span
              className={`collection-visibility ${
                collection.isPublic ? 'collection-visibility--public' : 'collection-visibility--private'
              }`}
            >
              <Icon name={collection.isPublic ? 'globe' : 'user'} size={14} />
              <span>{collection.isPublic ? 'Public' : 'Private'}</span>
            </span>
          </p>
        </div>

        {isOwner && (
          <div className="collection-detail-actions">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                setErrors([]);
                setIsEditOpen(true);
              }}
            >
              <Icon name="edit" size={16} />
              <span>Edit</span>
            </button>
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={() => setIsDeleteOpen(true)}
            >
              <Icon name="trash" size={16} />
              <span>Delete</span>
            </button>
          </div>
        )}
      </header>

      {recipes.items.length === 0 ? (
        <EmptyState
          icon="folder"
          title="Nothing in this collection yet"
          message={
            isOwner
              ? 'Open a recipe and use “Add to collection” to put it in here.'
              : 'The owner has not added any recipes to this collection.'
          }
          action={
            isOwner ? (
              <Link to="/" className="btn-primary">
                Browse recipes
              </Link>
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
              onToggleSave={user ? (recipeId) => toggleSave.mutate(recipeId) : undefined}
            />
          ))}
        </div>
      )}

      <Pagination page={recipes.page} totalPages={recipes.totalPages} onChange={setPage} />

      <CollectionFormModal
        isOpen={isEditOpen}
        onClose={() => {
          setIsEditOpen(false);
          setErrors([]);
        }}
        initial={{
          name: collection.name,
          description: collection.description,
          isPublic: collection.isPublic,
        }}
        title="Edit collection"
        submitLabel="Save changes"
        isSaving={updateCollection.isPending}
        errors={errors}
        onSubmit={(input) => void handleUpdate(input)}
      />

      <ConfirmDialog
        isOpen={isDeleteOpen}
        title={`Delete “${collection.name}”?`}
        message="This deletes the collection only. The recipes in it stay where they are — in your saved list and on the site."
        confirmLabel="Delete collection"
        isDestructive
        isPending={deleteCollection.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setIsDeleteOpen(false)}
      />
    </div>
  );
}
