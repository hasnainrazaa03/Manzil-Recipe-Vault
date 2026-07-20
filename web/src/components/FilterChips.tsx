import { Icon } from './Icon';
import { formatDifficulty, formatDuration } from '../lib/format';
import type { Difficulty } from '../types';

export interface ActiveFilters {
  search: string;
  tags: string[];
  difficulty?: Difficulty;
  cuisine?: string;
  maxMinutes?: number;
}

interface FilterChipsProps {
  filters: ActiveFilters;
  onRemove: (kind: keyof ActiveFilters, value?: string) => void;
  onClearAll: () => void;
}

/**
 * Makes the active filter set visible and individually removable. Filters live
 * in the URL, which makes them shareable but invisible — it is otherwise easy
 * to be looking at three results and not know why.
 */
export function FilterChips({ filters, onRemove, onClearAll }: FilterChipsProps) {
  const chips: { key: string; label: string; remove: () => void }[] = [];

  if (filters.search) {
    chips.push({
      key: 'search',
      label: `“${filters.search}”`,
      remove: () => onRemove('search'),
    });
  }

  for (const tag of filters.tags) {
    chips.push({ key: `tag-${tag}`, label: tag, remove: () => onRemove('tags', tag) });
  }

  if (filters.difficulty) {
    chips.push({
      key: 'difficulty',
      label: formatDifficulty(filters.difficulty) ?? filters.difficulty,
      remove: () => onRemove('difficulty'),
    });
  }

  if (filters.cuisine) {
    chips.push({ key: 'cuisine', label: filters.cuisine, remove: () => onRemove('cuisine') });
  }

  if (filters.maxMinutes) {
    chips.push({
      key: 'maxMinutes',
      label: `Under ${formatDuration(filters.maxMinutes)}`,
      remove: () => onRemove('maxMinutes'),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="filter-chips" role="group" aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="filter-chip"
          onClick={chip.remove}
          aria-label={`Remove filter: ${chip.label}`}
        >
          <span>{chip.label}</span>
          <Icon name="close" size={13} />
        </button>
      ))}

      {chips.length > 1 && (
        <button type="button" className="btn-link btn-sm" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
