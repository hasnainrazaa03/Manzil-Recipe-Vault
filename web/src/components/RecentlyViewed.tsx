import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { useRecentlyViewed } from '../hooks/useRecentlyViewed';

const FALLBACK_IMAGE =
  'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=300';

export function RecentlyViewed() {
  const { recent, clear } = useRecentlyViewed();

  if (recent.length === 0) return null;

  return (
    <section className="recently-viewed" aria-labelledby="recent-heading">
      <div className="section-header">
        <h2 id="recent-heading">
          <Icon name="history" size={18} />
          <span>Recently viewed</span>
        </h2>
        <button type="button" className="btn-link btn-sm" onClick={clear}>
          Clear
        </button>
      </div>

      {/* A horizontal rail rather than a grid: this is a quick way back to
          something, not a browsing surface competing with the main list. */}
      <ul className="recent-rail">
        {recent.map((entry) => (
          <li key={entry.id}>
            <Link to={`/recipe/${entry.id}`} className="recent-item">
              <img
                src={entry.image || FALLBACK_IMAGE}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.src = FALLBACK_IMAGE;
                }}
              />
              <span>{entry.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
