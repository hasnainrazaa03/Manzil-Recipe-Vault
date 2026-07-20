import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { FollowButton } from './FollowButton';
import { useAuth } from '../context/AuthContext';
import { useFollowSuggestions } from '../lib/queries';

interface FollowSuggestionsProps {
  title?: string;
  description?: string;
}

/**
 * Cooks worth following, ranked server-side. Shown wherever an empty feed would
 * otherwise be a dead end — following someone is the only way out of it.
 */
export function FollowSuggestions({
  title = 'Cooks to follow',
  description,
}: FollowSuggestionsProps) {
  const { user } = useAuth();
  const { data, isPending, isError } = useFollowSuggestions();

  if (!user) return null;

  if (isPending) {
    return (
      <section className="follow-suggestions" aria-busy="true" aria-label="Loading suggestions">
        <h2 className="follow-suggestions-title">{title}</h2>
        <ul className="follow-suggestion-list">
          {Array.from({ length: 3 }, (_, index) => (
            <li className="follow-suggestion follow-suggestion--skeleton" key={index} aria-hidden="true">
              <div className="skeleton skeleton-avatar" />
              <div className="skeleton skeleton-line skeleton-line--short" />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  // A failed or empty suggestion list is not worth an error box — the surfaces
  // that use it are already complete without it.
  if (isError || !data || data.length === 0) return null;

  return (
    <section className="follow-suggestions" aria-labelledby="follow-suggestions-title">
      <h2 className="follow-suggestions-title" id="follow-suggestions-title">
        {title}
      </h2>
      {description && <p className="follow-suggestions-description">{description}</p>}

      <ul className="follow-suggestion-list">
        {data.map((suggestion) => (
          <li className="follow-suggestion" key={suggestion.uid}>
            <Link to={`/profile/${suggestion.uid}`} className="follow-suggestion-link">
              {suggestion.profilePictureUrl ? (
                <img
                  src={suggestion.profilePictureUrl}
                  alt=""
                  className="follow-suggestion-avatar"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
              ) : (
                <span className="follow-suggestion-avatar follow-suggestion-avatar--placeholder" aria-hidden="true">
                  <Icon name="user" size={20} />
                </span>
              )}
              <span className="follow-suggestion-details">
                <span className="follow-suggestion-name">{suggestion.displayName}</span>
                <span className="follow-suggestion-stats">
                  {suggestion.recipeCount} {suggestion.recipeCount === 1 ? 'recipe' : 'recipes'}
                  {suggestion.averageRating > 0 && (
                    <> · {suggestion.averageRating.toFixed(1)} average rating</>
                  )}
                </span>
              </span>
            </Link>

            <FollowButton userId={suggestion.uid} displayName={suggestion.displayName} size="small" />
          </li>
        ))}
      </ul>
    </section>
  );
}
