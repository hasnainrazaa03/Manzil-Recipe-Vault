import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import DOMPurify from 'dompurify';

import { Icon } from '../components/Icon';
import { StarRating } from '../components/StarRating';
import { CommentSection } from '../components/CommentSection';
import { DetailSkeleton } from '../components/Skeleton';
import { ErrorState } from '../components/EmptyState';
import { MetadataStrip } from '../components/MetadataStrip';
import { ServingsStepper } from '../components/ServingsStepper';
import { IngredientList } from '../components/IngredientList';
import { CookMode } from '../components/CookMode';
import { RelatedRecipes } from '../components/RelatedRecipes';
import { Lightbox } from '../components/Lightbox';
import { ReadingProgress } from '../components/ReadingProgress';
import { VersionHistory } from '../components/VersionHistory';
import { AddToCollectionButton } from '../components/AddToCollectionButton';

import { useAuth } from '../context/AuthContext';
import { useRecipeEditor } from '../context/RecipeEditorContext';
import { useRateRecipe, useRecipe, useSavedIds, useToggleSave } from '../lib/queries';
import { useShoppingList } from '../hooks/useShoppingList';
import { useRecordView } from '../hooks/useRecentlyViewed';
import { scaleAmount } from '../lib/amount';
import { formatDate } from '../lib/format';
import { ApiError } from '../lib/api';

const FALLBACK_IMAGE =
  'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=1200';

/** Sets the document title and description for the recipe being viewed. */
function useDocumentMeta(title?: string, description?: string) {
  useEffect(() => {
    if (!title) return;
    const previousTitle = document.title;
    document.title = `${title} · Manzil Recipe Vault`;

    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute('content') ?? '';
    if (meta && description) meta.setAttribute('content', description);

    return () => {
      document.title = previousTitle;
      if (meta) meta.setAttribute('content', previousDescription);
    };
  }, [title, description]);
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openEdit, confirmDelete } = useRecipeEditor();

  const { data: recipe, isPending, isError, error, refetch } = useRecipe(id);
  const rate = useRateRecipe(id ?? '');
  const toggleSave = useToggleSave();
  const savedIds = useSavedIds();
  const shoppingList = useShoppingList();

  const [servings, setServings] = useState<number | null>(null);
  const [isCooking, setIsCooking] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useDocumentMeta(recipe?.title, recipe?.overview);
  useRecordView(recipe);

  /**
   * Reset the chosen yield when navigating between recipes — during render,
   * not in an effect.
   *
   * An effect runs after paint, so when the next recipe is already cached
   * (back-navigation, or one prefetched to open the editor) `isPending` is
   * false on the very first render with the new id, and one committed frame
   * showed recipe B's ingredients multiplied by the servings chosen for A.
   */
  const previousId = useRef(id);
  if (previousId.current !== id) {
    previousId.current = id;
    if (servings !== null) setServings(null);
  }

  if (isPending) return <DetailSkeleton />;

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <ErrorState
        title={notFound ? 'Recipe not found' : 'Something went wrong'}
        message={
          notFound
            ? 'This recipe may have been deleted, or the link may be wrong.'
            : error instanceof ApiError
              ? error.message
              : 'Could not load this recipe.'
        }
        onRetry={notFound ? undefined : () => void refetch()}
      />
    );
  }

  const baseServings = recipe.servings ?? 0;
  const currentServings = servings ?? baseServings;
  const scaleFactor = baseServings > 0 && currentServings > 0 ? currentServings / baseServings : 1;

  const isSaved = savedIds.has(recipe._id);
  const isAuthor = recipe.viewer.isAuthor;
  const inShoppingList = shoppingList.hasRecipe(recipe._id);

  /**
   * The list stores the amounts as they were displayed when it was added, so
   * changing the yield afterwards leaves it stale. `addRecipe` already replaces
   * a recipe's entries for exactly this case, but the button was a plain toggle
   * and could never reach that branch — the only route to updated quantities
   * was to remove and re-add, with nothing saying so.
   */
  const scaleChanged = inShoppingList && scaleFactor !== 1;

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: recipe.title, text: recipe.overview, url });
        return;
      } catch {
        // Sheet dismissed — fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard.');
    } catch {
      toast.error('Could not copy the link.');
    }
  };

  const handleRate = async (score: number) => {
    try {
      await rate.mutateAsync(score);
      toast.success('Thanks for rating.');
    } catch (rateError) {
      toast.error(
        rateError instanceof ApiError ? rateError.message : 'Could not submit your rating.',
      );
    }
  };

  const handleShoppingList = () => {
    // Already on the list at the yield currently shown — the only sensible
    // action left is to take it off.
    if (inShoppingList && !scaleChanged) {
      shoppingList.removeRecipe(recipe._id);
      toast.info('Removed from your shopping list.');
      return;
    }

    // Amounts go in at whatever yield the reader chose, not the original.
    shoppingList.addRecipe(
      recipe._id,
      recipe.title,
      recipe.ingredients.map((ingredient) => ({
        ...ingredient,
        amount: scaleAmount(ingredient.amount, scaleFactor),
      })),
    );
    toast.success(
      inShoppingList ? 'Shopping list updated to the new servings.' : 'Added to your shopping list.',
    );
  };

  return (
    <article className="recipe-detail">
      <ReadingProgress title={recipe.title} />

      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">
          <Icon name="chevron-left" size={16} />
          <span>All recipes</span>
        </Link>
      </nav>

      <div className="recipe-hero">
        <button
          type="button"
          className="recipe-hero-button"
          onClick={() => setIsLightboxOpen(true)}
          aria-label={`View full-size image of ${recipe.title}`}
        >
          <img
            src={recipe.image || FALLBACK_IMAGE}
            referrerPolicy="no-referrer"
            alt={recipe.title}
            onError={(event) => {
              event.currentTarget.src = FALLBACK_IMAGE;
            }}
          />
          <span className="recipe-hero-expand" aria-hidden="true">
            <Icon name="expand" size={18} />
          </span>
        </button>
      </div>

      <header className="recipe-detail-header">
        <h1>{recipe.title}</h1>

        <div className="recipe-meta">
          <Link to={`/profile/${recipe.author}`} className="recipe-author">
            <Icon name="user" size={15} />
            <span>{recipe.authorName || 'Anonymous cook'}</span>
          </Link>
          <time dateTime={recipe.createdAt}>{formatDate(recipe.createdAt)}</time>
          {recipe.cuisine && (
            <Link to={`/?cuisine=${encodeURIComponent(recipe.cuisine)}`} className="recipe-cuisine">
              {recipe.cuisine}
            </Link>
          )}
        </div>

        <MetadataStrip recipe={recipe} />

        <div className="recipe-actions">
          <button type="button" onClick={() => setIsCooking(true)} className="btn-primary">
            <Icon name="play" size={17} />
            <span>Cook mode</span>
          </button>

          <button type="button" onClick={handleShoppingList} className="btn-secondary btn-sm">
            <Icon name="cart" size={16} />
            <span>
              {scaleChanged
                ? 'Update list'
                : inShoppingList
                  ? 'In shopping list'
                  : 'Add to list'}
            </span>
          </button>

          <button type="button" onClick={handleShare} className="btn-secondary btn-sm">
            <Icon name="share" size={16} />
            <span>Share</span>
          </button>

          <button type="button" onClick={() => window.print()} className="btn-secondary btn-sm">
            <Icon name="printer" size={16} />
            <span>Print</span>
          </button>

          {user && (
            <button
              type="button"
              onClick={() => toggleSave.mutate(recipe._id)}
              className={`btn-secondary btn-sm ${isSaved ? 'is-saved' : ''}`}
              aria-pressed={isSaved}
            >
              <Icon name={isSaved ? 'star-filled' : 'star'} size={16} />
              <span>{isSaved ? 'Saved' : 'Save'}</span>
            </button>
          )}

          <AddToCollectionButton recipeId={recipe._id} recipeTitle={recipe.title} />

          {isAuthor && (
            <>
              <button type="button" onClick={() => openEdit(recipe)} className="btn-secondary btn-sm">
                <Icon name="edit" size={16} />
                <span>Edit</span>
              </button>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(true)}
                className="btn-secondary btn-sm"
              >
                <Icon name="history" size={16} />
                <span>History</span>
              </button>
              <button
                type="button"
                onClick={() => confirmDelete(recipe, () => navigate('/'))}
                className="btn-danger btn-sm"
              >
                <Icon name="trash" size={16} />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>

        {recipe.tags.length > 0 && (
          <ul className="tags-container" aria-label="Tags">
            {recipe.tags.map((tag) => (
              <li key={tag}>
                <Link to={`/?tag=${encodeURIComponent(tag)}`} className="tag">
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </header>

      <section className="rating-section" aria-label="Ratings">
        <div className="average-rating">
          {/* Rendered from the recipe payload, so guests see real ratings. */}
          <StarRating value={recipe.averageRating} size={22} label="Average rating" />
          <span>
            {recipe.ratingCount > 0
              ? `${recipe.averageRating.toFixed(1)} from ${recipe.ratingCount} ${
                  recipe.ratingCount === 1 ? 'rating' : 'ratings'
                }`
              : 'No ratings yet'}
          </span>
        </div>

        {user && !isAuthor && (
          <div className="user-rating">
            <span>Your rating</span>
            <StarRating
              value={recipe.viewer.userScore}
              onChange={handleRate}
              size={26}
              disabled={rate.isPending}
              label="Your rating"
            />
          </div>
        )}
        {isAuthor && <p className="field-hint">You cannot rate your own recipe.</p>}
        {!user && (
          <p className="field-hint">
            <Link to="/login">Log in</Link> to rate this recipe.
          </p>
        )}
      </section>

      <p className="recipe-overview">{recipe.overview}</p>

      <div className="recipe-body">
        <section className="recipe-ingredients" aria-labelledby="ingredients-heading">
          <div className="section-header">
            <h2 id="ingredients-heading">Ingredients</h2>
            {/* Scaling only means something when we know what the recipe serves. */}
            {baseServings > 0 && (
              <ServingsStepper
                baseServings={baseServings}
                servings={currentServings}
                onChange={setServings}
              />
            )}
          </div>

          <IngredientList
            recipeId={recipe._id}
            ingredients={recipe.ingredients}
            scaleFactor={scaleFactor}
          />
        </section>

        <section className="recipe-instructions" aria-labelledby="instructions-heading">
          <h2 id="instructions-heading">Instructions</h2>
          {/* Sanitized server-side on write; this second pass is defence in depth. */}
          <div
            className="instruction-content"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(recipe.instructions) }}
          />
        </section>
      </div>

      <RelatedRecipes recipeId={recipe._id} />

      <CommentSection
        recipeId={recipe._id}
        comments={recipe.comments}
        commentCount={recipe.commentCount}
        currentUserId={user?.uid}
        recipeAuthorId={recipe.author}
      />

      <CookMode
        isOpen={isCooking}
        onClose={() => setIsCooking(false)}
        title={recipe.title}
        instructions={recipe.instructions}
        ingredients={recipe.ingredients}
        scaleFactor={scaleFactor}
      />

      <VersionHistory
        recipeId={recipe._id}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />

      <Lightbox
        isOpen={isLightboxOpen}
        onClose={() => setIsLightboxOpen(false)}
        src={recipe.image || FALLBACK_IMAGE}
        alt={recipe.title}
      />
    </article>
  );
}
