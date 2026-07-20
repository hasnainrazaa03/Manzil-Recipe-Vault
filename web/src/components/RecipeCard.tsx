import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { StarRating } from './StarRating';
import { MetadataStrip } from './MetadataStrip';
import { Highlight } from './Highlight';
import type { RecipeSummary } from '../types';

const FALLBACK_IMAGE =
  'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=800';

interface RecipeCardProps {
  recipe: RecipeSummary;
  currentUserId?: string;
  isSaved?: boolean;
  onToggleSave?: (recipeId: string) => void;
  onEdit?: (recipe: RecipeSummary) => void;
  onDelete?: (recipe: RecipeSummary) => void;
  /** When set, matching substrings in the title and overview are marked. */
  searchTerm?: string;
}

export function RecipeCard({
  recipe,
  currentUserId,
  isSaved = false,
  onToggleSave,
  onEdit,
  onDelete,
  searchTerm,
}: RecipeCardProps) {
  const isAuthor = Boolean(currentUserId) && currentUserId === recipe.author;

  return (
    <article className="recipe-card">
      <div className="card-image-container">
        {/* The whole image and title are one link, so the card is reachable by
            keyboard — previously the only way in was clicking an <img>. */}
        <Link to={`/recipe/${recipe._id}`} className="card-image-link" tabIndex={-1} aria-hidden="true">
          <img
            src={recipe.image || FALLBACK_IMAGE}
            referrerPolicy="no-referrer"
            alt=""
            loading="lazy"
            decoding="async"
            onError={(event) => {
              event.currentTarget.src = FALLBACK_IMAGE;
            }}
          />
        </Link>

        {onToggleSave && (
          <button
            type="button"
            onClick={() => onToggleSave(recipe._id)}
            className={`save-btn ${isSaved ? 'saved' : ''}`}
            aria-pressed={isSaved}
            aria-label={isSaved ? `Remove ${recipe.title} from saved` : `Save ${recipe.title}`}
          >
            <Icon name={isSaved ? 'star-filled' : 'star'} size={18} />
          </button>
        )}
      </div>

      <div className="card-content">
        <h3 className="card-title">
          <Link to={`/recipe/${recipe._id}`}>
            {searchTerm ? <Highlight text={recipe.title} term={searchTerm} /> : recipe.title}
          </Link>
        </h3>

        <div className="card-rating">
          <StarRating value={recipe.averageRating} size={16} label={`${recipe.title} rating`} />
          <span className="rating-count">
            {recipe.ratingCount > 0
              ? `${recipe.averageRating.toFixed(1)} (${recipe.ratingCount})`
              : 'Not yet rated'}
          </span>
        </div>

        <MetadataStrip recipe={recipe} variant="card" />

        <p className="card-overview">
          {searchTerm ? <Highlight text={recipe.overview} term={searchTerm} /> : recipe.overview}
        </p>

        {recipe.tags.length > 0 && (
          <ul className="tags-container" aria-label="Tags">
            {recipe.tags.map((tag) => (
              <li key={tag} className="tag">
                {tag}
              </li>
            ))}
          </ul>
        )}

        <div className="card-footer">
          <Link to={`/profile/${recipe.author}`} className="card-author">
            <Icon name="user" size={14} />
            <span>{recipe.authorName || 'Anonymous cook'}</span>
          </Link>
          {recipe.commentCount > 0 && (
            <span className="card-comment-count">
              {recipe.commentCount} {recipe.commentCount === 1 ? 'comment' : 'comments'}
            </span>
          )}
        </div>

        {isAuthor && (onEdit ?? onDelete) && (
          <div className="card-actions">
            {onEdit && (
              <button type="button" onClick={() => onEdit(recipe)} className="btn-secondary btn-sm">
                <Icon name="edit" size={15} />
                <span>Edit</span>
              </button>
            )}
            {onDelete && (
              <button type="button" onClick={() => onDelete(recipe)} className="btn-danger btn-sm">
                <Icon name="trash" size={15} />
                <span>Delete</span>
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
