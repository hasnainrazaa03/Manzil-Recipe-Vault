import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useTags } from '../lib/queries';
import type { SortOption } from '../types';

interface SearchFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  tagMode: 'any' | 'all';
  onTagModeChange: (mode: 'any' | 'all') => void;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
  resultCount?: number;
}

const SORT_LABELS: Record<SortOption, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  rating: 'Highest rated',
  popular: 'Most rated',
  relevance: 'Best match',
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
  resultCount,
}: SearchFiltersProps) {
  const { data: tags = [] } = useTags();
  const [draft, setDraft] = useState(search);

  // Debounce locally so typing stays responsive but the API sees one request
  // per pause rather than one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => onSearchChange(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, onSearchChange]);

  // Keep in step when a parent clears the search (e.g. "clear all filters").
  useEffect(() => {
    setDraft((current) => (search === '' && current !== '' ? '' : current));
  }, [search]);

  const toggleTag = (tag: string) => {
    onTagsChange(
      selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag],
    );
  };

  const hasFilters = selectedTags.length > 0 || search !== '';

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
          {selectedTags.length > 1 && (
            <div className="tag-mode">
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

          <div className="sort-container">
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
