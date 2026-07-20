import { useState } from 'react';
import { Icon } from './Icon';

interface StarRatingProps {
  value: number;
  /** Omit to render a read-only display. */
  onChange?: (score: number) => void;
  size?: number;
  disabled?: boolean;
  label?: string;
}

/**
 * Replaces `react-simple-star-rating`, which rendered a div soup with no
 * keyboard support and no accessible value.
 *
 * Read-only mode is an `img` with a text alternative; interactive mode is a
 * radio group, so arrow keys work and the current value is announced.
 */
export function StarRating({
  value,
  onChange,
  size = 20,
  disabled = false,
  label = 'Rating',
}: StarRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const interactive = Boolean(onChange) && !disabled;
  const displayed = hovered ?? value;

  if (!interactive) {
    return (
      <span className="star-rating star-rating--readonly" role="img" aria-label={`${label}: ${value.toFixed(1)} out of 5`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Icon
            key={star}
            // A half star at .5 or better reads as "half full" the way people expect.
            name={value >= star ? 'star-filled' : value >= star - 0.5 ? 'star-half' : 'star'}
            size={size}
            className="star"
          />
        ))}
      </span>
    );
  }

  return (
    <span
      className="star-rating star-rating--interactive"
      role="radiogroup"
      aria-label={label}
      onMouseLeave={() => setHovered(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
          className="star-button"
          disabled={disabled}
          // Only the selected star (or the first, when unset) is tabbable, so the
          // group is one tab stop and arrow keys move within it.
          tabIndex={value === star || (value === 0 && star === 1) ? 0 : -1}
          onMouseEnter={() => setHovered(star)}
          onFocus={() => setHovered(star)}
          onBlur={() => setHovered(null)}
          onClick={() => onChange?.(star)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault();
              onChange?.(Math.min(5, (value || 0) + 1));
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault();
              onChange?.(Math.max(1, (value || 1) - 1));
            }
          }}
        >
          <Icon name={displayed >= star ? 'star-filled' : 'star'} size={size} className="star" />
        </button>
      ))}
    </span>
  );
}
