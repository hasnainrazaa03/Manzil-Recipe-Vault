import { Link } from 'react-router-dom';
import { StarRating } from './StarRating';
import { formatDuration } from '../lib/format';
import { useRelatedRecipes } from '../lib/queries';

const FALLBACK_IMAGE =
  'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=400';

export function RelatedRecipes({ recipeId }: { recipeId: string }) {
  const { data, isPending, isError } = useRelatedRecipes(recipeId);

  // A recommendations rail is the least important thing on the page — if it
  // fails or comes back empty, it simply is not there.
  if (isPending || isError || !data || data.length === 0) return null;

  return (
    <section className="related-recipes" aria-labelledby="related-heading">
      <h2 id="related-heading">You might also like</h2>
      <ul className="related-list">
        {data.map((recipe) => {
          const time = formatDuration(recipe.totalMinutes);
          return (
            <li key={recipe._id} className="related-item">
              <Link to={`/recipe/${recipe._id}`} className="related-link">
                <img
                  src={recipe.image || FALLBACK_IMAGE}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_IMAGE;
                  }}
                />
                <span className="related-body">
                  <span className="related-title">{recipe.title}</span>
                  <span className="related-meta">
                    <StarRating value={recipe.averageRating} size={13} label={`${recipe.title} rating`} />
                    {time && <span className="related-time">{time}</span>}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
