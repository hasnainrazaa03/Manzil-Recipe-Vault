import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useCuisines, useTags } from '../lib/queries';
import type { Difficulty, SortOption } from '../types';

interface SearchFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  tagMode: 'any' | 'all';
  onTagModeChange: (mode: 'any' | 'all') => void;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
  difficulty?: Difficulty;
  onDifficultyChange: (difficulty: Difficulty | undefined) => void;
  cuisine?: string;
  onCuisineChange: (cuisine: string | undefined) => void;
  maxMinutes?: number;
  onMaxMinutesChange: (minutes: number | undefined) => void;
  resultCount?: number;
}

/** Thresholds people actually think in when they want something fast. */
const TIME_OPTIONS = [15, 30, 45, 60] as const;

const SORT_LABELS: Record<SortOption, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  rating: 'Highest rated',
  popular: 'Most rated',
  relevance: 'Best match',
  quickest: 'Quickest',
};

export function SearchFilters({
  search,
  onSearchChange,
  selectedTags,
  onTagsChange,
  tagMode,
  onTagModeChange,
  sort,
  onSortChange,
  difficulty,
  onDifficultyChange,
  cuisine,
  onCuisineChange,
  maxMinutes,
  onMaxMinutesChange,
  resultCount,
}: SearchFiltersProps) {
  const { data: tags = [] } = useTags();
  const { data: cuisines = [] } = useCuisines();
  const [draft, setDraft] = useState(search);

  /**
   * Debounce locally so typing stays responsive but the API sees one request
   * per pause rather than one per keystroke.
   *
   * The early return is load-bearing, not an optimisation. `onSearchChange` is
   * recreated by the parent on every render, so this effect re-arms on every
   * render; without the guard, firing it pushes a navigation, the navigation
   * re-renders the parent, the parent mints a new callback, and the effect
   * re-arms — a self-sustaining loop that also wiped `?page` several times a
   * second, making pagination unusable.
   */
  useEffect(() => {
    if (draft === search) return;
    const timer = setTimeout(() => onSearchChange(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, search, onSearchChange]);

  // Keep in step when a parent clears the search (e.g. "clear all filters").
  useEffect(() => {
    setDraft((current) => (search === '' && current !== '' ? '' : current));
  }, [search]);

  const toggleTag = (tag: string) => {
    onTagsChange(
      selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag],
    );
  };

  const hasFilters =
    selectedTags.length > 0 || search !== '' || Boolean(difficulty || cuisine || maxMinutes);

  return (
    <div className="filters">
      <div className="search-container">
        <div className="search-input-wrapper">
          <Icon name="search" size={18} className="search-icon" />
          <label htmlFor="recipe-search" className="visually-hidden">
            Search recipes
          </label>
          <input
            id="recipe-search"
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search by title, ingredient, or tag…"
            className="search-input"
            maxLength={100}
          />
        </div>
      </div>

      <div className="filter-bar">
        {tags.length > 0 && (
          <div className="tag-filter-container" role="group" aria-label="Filter by tag">
            {tags.map(({ tag, count }) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`tag-filter-btn ${active ? 'active' : ''}`}
                  aria-pressed={active}
                >
                  {tag}
                  <span className="tag-count">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="filter-controls">
          <div className="filter-control">
            <label htmlFor="time-select">Ready in</label>
            <select
              id="time-select"
              value={maxMinutes ?? ''}
              onChange={(event) =>
                onMaxMinutesChange(event.target.value ? Number(event.target.value) : undefined)
              }
            >
              <option value="">Any time</option>
              {TIME_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  Under {minutes} min
                </option>
              ))}
            </select>
          </div>

          <div className="filter-control">
            <label htmlFor="difficulty-select">Difficulty</label>
            <select
              id="difficulty-select"
              value={difficulty ?? ''}
              onChange={(event) =>
                onDifficultyChange((event.target.value || undefined) as Difficulty | undefined)
              }
            >
              <option value="">Any</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          {/* Only offered once there is something to choose between. */}
          {cuisines.length > 0 && (
            <div className="filter-control">
              <label htmlFor="cuisine-select">Cuisine</label>
              <select
                id="cuisine-select"
                value={cuisine ?? ''}
                onChange={(event) => onCuisineChange(event.target.value || undefined)}
              >
                <option value="">Any</option>
                {cuisines.map((entry) => (
                  <option key={entry.cuisine} value={entry.cuisine}>
                    {entry.cuisine} ({entry.count})
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedTags.length > 1 && (
            <div className="filter-control tag-mode">
              <label htmlFor="tag-mode-select">Match</label>
              <select
                id="tag-mode-select"
                value={tagMode}
                onChange={(event) => onTagModeChange(event.target.value as 'any' | 'all')}
              >
                <option value="any">Any tag</option>
                <option value="all">All tags</option>
              </select>
            </div>
          )}

          <div className="filter-control sort-container">
            <label htmlFor="sort-select">Sort by</label>
            <select
              id="sort-select"
              value={sort}
              onChange={(event) => onSortChange(event.target.value as SortOption)}
              className="sort-select"
            >
              {(Object.keys(SORT_LABELS) as SortOption[])
                // "Best match" only means something when there is a query.
                .filter((option) => option !== 'relevance' || search !== '')
                .map((option) => (
                  <option key={option} value={option}>
                    {SORT_LABELS[option]}
                  </option>
                ))}
            </select>
          </div>

          {hasFilters && (
            <button
              type="button"
              className="btn-link btn-sm"
              onClick={() => {
                setDraft('');
                onSearchChange('');
                onTagsChange([]);
                onDifficultyChange(undefined);
                onCuisineChange(undefined);
                onMaxMinutesChange(undefined);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Announces result counts to screen readers as filters change. */}
      <p className="results-summary" role="status" aria-live="polite">
        {resultCount === undefined
          ? ''
          : `${resultCount} ${resultCount === 1 ? 'recipe' : 'recipes'}${hasFilters ? ' match your filters' : ''}`}
      </p>
    </div>
  );
}
