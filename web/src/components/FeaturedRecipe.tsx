import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { StarRating } from './StarRating';
import { MetadataStrip } from './MetadataStrip';
import { useRecipes } from '../lib/queries';

const FALLBACK_IMAGE =
  'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=1200';

/**
 * The recipe shown at the top of an unfiltered home page: the best-rated one
 * carrying enough ratings to mean something, falling back to the newest when
 * the collection is too young for that to be true.
 *
 * A single five-star rating from one person is not a recommendation, which is
 * why this asks for a minimum count rather than just taking the top of
 * `sort=rating`.
 */
const MIN_RATINGS = 3;

export function FeaturedRecipe() {
  const byRating = useRecipes({ sort: 'rating', limit: 4 });
  const newest = useRecipes({ sort: 'newest', limit: 1 });

  const wellRated = byRating.data?.items.find((recipe) => recipe.ratingCount >= MIN_RATINGS);
  const recipe = wellRated ?? newest.data?.items[0];

  if (byRating.isPending || newest.isPending || !recipe) return null;

  return (
    <section className="featured" aria-labelledby="featured-heading">
      <h2 id="featured-heading" className="visually-hidden">
        Featured recipe
      </h2>

      <Link to={`/recipe/${recipe._id}`} className="featured-card">
        <div className="featured-image">
          <img
            src={recipe.image || FALLBACK_IMAGE}
            alt=""
            onError={(event) => {
              event.currentTarget.src = FALLBACK_IMAGE;
            }}
          />
        </div>

        <div className="featured-body">
          <span className="featured-badge">
            <Icon name="sparkles" size={14} />
            <span>{wellRated ? 'Top rated' : 'Latest recipe'}</span>
          </span>

          <h3 className="featured-title">{recipe.title}</h3>
          <p className="featured-overview">{recipe.overview}</p>

          <div className="featured-rating">
            <StarRating value={recipe.averageRating} size={17} label={`${recipe.title} rating`} />
            {recipe.ratingCount > 0 && (
              <span>
                {recipe.averageRating.toFixed(1)} ({recipe.ratingCount})
              </span>
            )}
          </div>

          <MetadataStrip recipe={recipe} variant="card" />

          <span className="featured-cta">
            View recipe
            <Icon name="chevron-right" size={16} />
          </span>
        </div>
      </Link>
    </section>
  );
}
