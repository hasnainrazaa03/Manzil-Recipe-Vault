import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import DOMPurify from 'dompurify';
import { Icon } from '../components/Icon';
import { StarRating } from '../components/StarRating';
import { CommentSection } from '../components/CommentSection';
import { DetailSkeleton } from '../components/Skeleton';
import { ErrorState } from '../components/EmptyState';
import { useAuth } from '../context/AuthContext';
import { useRecipeEditor } from '../context/RecipeEditorContext';
import { useRateRecipe, useRecipe, useSavedIds, useToggleSave } from '../lib/queries';
import { ApiError } from '../lib/api';

const FALLBACK_IMAGE =
  'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=1200';

/** Sets the document title and meta description for the recipe being viewed. */
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

  useDocumentMeta(recipe?.title, recipe?.overview);

  if (isPending) return <DetailSkeleton />;

  if (isError) {
    const message = error instanceof ApiError ? error.message : 'Could not load this recipe.';
    return (
      <ErrorState
        title={error instanceof ApiError && error.status === 404 ? 'Recipe not found' : 'Something went wrong'}
        message={message}
        onRetry={error instanceof ApiError && error.status === 404 ? undefined : () => void refetch()}
      />
    );
  }

  const isSaved = savedIds.has(recipe._id);
  const isAuthor = recipe.viewer.isAuthor;

  const handleShare = async () => {
    const url = window.location.href;
    // The Web Share sheet on mobile, clipboard everywhere else.
    if (navigator.share) {
      try {
        await navigator.share({ title: recipe.title, text: recipe.overview, url });
        return;
      } catch {
        // The user dismissed the sheet — fall through to copying.
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
      toast.error(rateError instanceof ApiError ? rateError.message : 'Could not submit your rating.');
    }
  };

  return (
    <article className="recipe-detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">
          <Icon name="chevron-left" size={16} />
          <span>All recipes</span>
        </Link>
      </nav>

      <div className="recipe-hero">
        <img
          src={recipe.image || FALLBACK_IMAGE}
          alt={recipe.title}
          onError={(event) => {
            event.currentTarget.src = FALLBACK_IMAGE;
          }}
        />
      </div>

      <header className="recipe-detail-header">
        <h1>{recipe.title}</h1>

        <div className="recipe-meta">
          <Link to={`/profile/${recipe.author}`} className="recipe-author">
            <Icon name="user" size={15} />
            <span>{recipe.authorName || 'Anonymous cook'}</span>
          </Link>
          <time dateTime={recipe.createdAt}>
            {new Date(recipe.createdAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
        </div>

        <div className="recipe-actions">
          <button type="button" onClick={handleShare} className="btn-secondary btn-sm">
            <Icon name="share" size={16} />
            <span>Share</span>
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

          {isAuthor && (
            <>
              <button type="button" onClick={() => openEdit(recipe)} className="btn-secondary btn-sm">
                <Icon name="edit" size={16} />
                <span>Edit</span>
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
          {/* The average renders from the recipe payload, so it is visible to
              logged-out visitors. It used to be fetched behind auth, leaving
              every guest looking at "0.0 (0 reviews)". */}
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
            <span id="your-rating-label">Your rating</span>
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

      <section aria-labelledby="ingredients-heading">
        <h2 id="ingredients-heading">Ingredients</h2>
        <ul className="ingredient-list">
          {recipe.ingredients.map((ingredient, index) => (
            <li key={`${ingredient.name}-${index}`}>
              {ingredient.amount && <span className="ingredient-amount">{ingredient.amount}</span>}
              <strong>{ingredient.name}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="instructions-heading">
        <h2 id="instructions-heading">Instructions</h2>
        {/* Sanitized on write by the server and again here on render — the
            second pass is defence in depth, not the control. */}
        <div
          className="instruction-content"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(recipe.instructions) }}
        />
      </section>

      <CommentSection
        recipeId={recipe._id}
        comments={recipe.comments}
        commentCount={recipe.commentCount}
        currentUserId={user?.uid}
        recipeAuthorId={recipe.author}
      />
    </article>
  );
}
