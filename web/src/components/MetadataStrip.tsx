import { Icon, type IconName } from './Icon';
import { formatDifficulty, formatDuration } from '../lib/format';
import type { RecipeSummary } from '../types';

interface MetadataStripProps {
  recipe: Pick<
    RecipeSummary,
    'servings' | 'prepMinutes' | 'cookMinutes' | 'totalMinutes' | 'difficulty' | 'cuisine'
  >;
  variant?: 'detail' | 'card';
}

interface Entry {
  icon: IconName;
  label: string;
  value: string;
}

/**
 * The at-a-glance facts: time, yield, difficulty, cuisine. Entries with no
 * value are omitted rather than shown as "—", so a recipe that states nothing
 * renders nothing instead of a row of blanks.
 */
export function MetadataStrip({ recipe, variant = 'detail' }: MetadataStripProps) {
  const entries: Entry[] = [];

  const total = formatDuration(recipe.totalMinutes);
  if (total) entries.push({ icon: 'clock', label: 'Total time', value: total });

  if (variant === 'detail') {
    const prep = formatDuration(recipe.prepMinutes);
    const cook = formatDuration(recipe.cookMinutes);
    if (prep) entries.push({ icon: 'knife', label: 'Prep', value: prep });
    if (cook) entries.push({ icon: 'flame', label: 'Cook', value: cook });
  }

  if (recipe.servings) {
    entries.push({
      icon: 'users',
      label: 'Serves',
      value: String(recipe.servings),
    });
  }

  const difficulty = formatDifficulty(recipe.difficulty);
  if (difficulty) entries.push({ icon: 'gauge', label: 'Difficulty', value: difficulty });

  if (recipe.cuisine && variant === 'detail') {
    entries.push({ icon: 'globe', label: 'Cuisine', value: recipe.cuisine });
  }

  if (entries.length === 0) return null;

  return (
    <ul className={`metadata-strip metadata-strip--${variant}`}>
      {entries.map((entry) => (
        <li key={entry.label} className="metadata-item">
          <Icon name={entry.icon} size={variant === 'card' ? 14 : 18} />
          <span className="metadata-text">
            <span className="metadata-label">{entry.label}</span>
            <span className="metadata-value">{entry.value}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
