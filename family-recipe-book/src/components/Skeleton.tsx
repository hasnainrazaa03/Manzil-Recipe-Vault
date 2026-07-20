/**
 * Placeholder shapes shown while data loads. Preserving the final layout stops
 * the spinner-then-reflow jump the app previously did on every navigation.
 */
export function RecipeCardSkeleton() {
  return (
    <div className="recipe-card recipe-card--skeleton" aria-hidden="true">
      <div className="skeleton skeleton-image" />
      <div className="card-content">
        <div className="skeleton skeleton-line skeleton-line--title" />
        <div className="skeleton skeleton-line skeleton-line--short" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line skeleton-line--short" />
      </div>
    </div>
  );
}

export function RecipeGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div id="recipe-grid" aria-busy="true" aria-label="Loading recipes">
      {Array.from({ length: count }, (_, index) => (
        <RecipeCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="recipe-detail" aria-busy="true" aria-label="Loading recipe">
      <div className="skeleton skeleton-hero" />
      <div className="skeleton skeleton-line skeleton-line--title" />
      <div className="skeleton skeleton-line skeleton-line--short" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" />
    </div>
  );
}
