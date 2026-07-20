import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';

import { Icon } from '../components/Icon';
import { Pagination } from '../components/Pagination';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { CollectionFormModal } from '../components/CollectionFormModal';
import { useCollections, useCreateCollection } from '../lib/queries';
import { ApiError } from '../lib/api';
import type { CollectionInput } from '../types';

function CollectionsSkeleton() {
  return (
    <div className="collection-grid" aria-busy="true" aria-label="Loading collections">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="collection-card collection-card--skeleton" key={index} aria-hidden="true">
          <div className="skeleton skeleton-line skeleton-line--title" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line skeleton-line--short" />
        </div>
      ))}
    </div>
  );
}

export default function CollectionsPage() {
  const [page, setPage] = useState(1);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const { data, isPending, isError, error, refetch } = useCollections('me', page);
  const createCollection = useCreateCollection();

  const handleCreate = async (input: CollectionInput) => {
    setErrors([]);
    try {
      const created = await createCollection.mutateAsync(input);
      setIsFormOpen(false);
      toast.success(`Created “${created.name}”.`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setErrors(caught.fieldMessages.length > 0 ? caught.fieldMessages : [caught.message]);
      } else {
        setErrors([(caught as Error).message || 'Could not create that collection.']);
      }
    }
  };

  const newCollectionButton = (
    <button type="button" className="btn-primary" onClick={() => setIsFormOpen(true)}>
      <Icon name="plus" size={17} />
      <span>New collection</span>
    </button>
  );

  return (
    <div className="collections-page">
      <header className="collections-header">
        <h1>Collections</h1>
        {!isPending && !isError && data.items.length > 0 && newCollectionButton}
      </header>

      {isPending ? (
        <CollectionsSkeleton />
      ) : isError ? (
        <ErrorState
          message={
            error instanceof ApiError ? error.message : 'Could not load your collections.'
          }
          onRetry={() => void refetch()}
        />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon="folder"
          title="No collections yet"
          message="Collections group saved recipes into something you can actually cook from — “Weeknight dinners”, “Eid”, “Things I keep meaning to try”. Saving stays one tap; a collection is the organising step on top of it."
          action={newCollectionButton}
        />
      ) : (
        <ul className="collection-grid">
          {data.items.map((collection) => (
            <li className="collection-card" key={collection._id}>
              <Link to={`/collections/${collection._id}`} className="collection-card-link">
                <h2 className="collection-card-name">{collection.name}</h2>
                {collection.description && (
                  <p className="collection-card-description">{collection.description}</p>
                )}
              </Link>
              <p className="collection-card-meta">
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
            </li>
          ))}
        </ul>
      )}

      {!isPending && !isError && (
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      )}

      <CollectionFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setErrors([]);
        }}
        title="New collection"
        submitLabel="Create collection"
        isSaving={createCollection.isPending}
        errors={errors}
        onSubmit={(input) => void handleCreate(input)}
      />
    </div>
  );
}
