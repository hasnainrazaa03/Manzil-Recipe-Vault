import { useId, useState, type FormEvent } from 'react';
import { toast } from 'react-toastify';

import { Modal } from './Modal';
import { Icon } from './Icon';
import { useAuth } from '../context/AuthContext';
import {
  useCollectionsContaining,
  useCreateCollection,
  useToggleRecipeInCollection,
} from '../lib/queries';
import { ApiError } from '../lib/api';

interface AddToCollectionButtonProps {
  recipeId: string;
  recipeTitle: string;
}

/**
 * Saving is the one-tap action; this is the deliberate organising step on top
 * of it. The dialog lists every collection the signed-in user owns with its
 * membership already resolved, so a recipe can be filed in one click.
 */
export function AddToCollectionButton({ recipeId, recipeTitle }: AddToCollectionButtonProps) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const newNameId = useId();

  const { data, isPending, isError, error, refetch } = useCollectionsContaining(
    isOpen ? recipeId : undefined,
  );
  const toggleRecipe = useToggleRecipeInCollection();
  const createCollection = useCreateCollection();

  if (!user) return null;

  const handleToggle = (collectionId: string, name: string, contains: boolean) => {
    toggleRecipe.mutate(
      { collectionId, recipeId },
      {
        onSuccess: () => {
          toast.success(contains ? `Removed from “${name}”.` : `Added to “${name}”.`);
        },
        onError: (caught) => {
          toast.error(
            caught instanceof ApiError ? caught.message : 'Could not update that collection.',
          );
        },
      },
    );
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name === '') return;

    try {
      await createCollection.mutateAsync({
        name,
        description: '',
        isPublic: false,
        recipes: [recipeId],
      });
      setNewName('');
      toast.success(`Created “${name}” with this recipe in it.`);
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.fieldMessages[0] ?? caught.message
          : 'Could not create that collection.';
      toast.error(message);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn-secondary btn-sm add-to-collection-trigger"
        onClick={() => setIsOpen(true)}
      >
        <Icon name="folder" size={16} />
        <span>Add to collection</span>
      </button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={`Add “${recipeTitle}” to a collection`}
      >
        <div className="add-to-collection">
          {isPending ? (
            <p className="add-to-collection-status" aria-live="polite">
              Loading your collections…
            </p>
          ) : isError ? (
            <div className="add-to-collection-error" role="alert">
              <p>{error instanceof ApiError ? error.message : 'Could not load your collections.'}</p>
              <button type="button" className="btn-secondary btn-sm" onClick={() => void refetch()}>
                Try again
              </button>
            </div>
          ) : data.length === 0 ? (
            <p className="add-to-collection-status">
              You have no collections yet. Name one below and this recipe goes straight into it.
            </p>
          ) : (
            <ul className="collection-checklist">
              {data.map((collection) => (
                <li className="collection-checklist-item" key={collection._id}>
                  <label className="collection-checklist-label">
                    <input
                      type="checkbox"
                      checked={collection.containsRecipe}
                      disabled={toggleRecipe.isPending}
                      onChange={() =>
                        handleToggle(collection._id, collection.name, collection.containsRecipe)
                      }
                    />
                    <span className="collection-checklist-name">{collection.name}</span>
                    <span className="collection-checklist-meta">
                      {collection.recipeCount} {collection.recipeCount === 1 ? 'recipe' : 'recipes'}
                      {' · '}
                      {collection.isPublic ? 'Public' : 'Private'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <form className="collection-quick-create" onSubmit={(event) => void handleCreate(event)}>
            <label htmlFor={newNameId}>New collection with this recipe in it</label>
            <div className="collection-quick-create-row">
              <input
                id={newNameId}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                maxLength={60}
                placeholder="Weeknight dinners"
              />
              <button
                type="submit"
                className="btn-primary btn-sm"
                disabled={createCollection.isPending || newName.trim() === ''}
              >
                {createCollection.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </>
  );
}
