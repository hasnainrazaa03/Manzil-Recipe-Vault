/**
 * Renders a duration the way a recipe would say it: "1 hr 20 min", not "80".
 * Returns null for "not stated", which is distinct from zero.
 */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null;
  if (minutes === 0) return '0 min';

  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);

  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

/** "2 hours ago", "3 days ago" — falls back to a date past a fortnight. */
export function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86_400],
  ];

  for (const [unit, size] of units) {
    if (seconds < size * (unit === 'minute' ? 60 : unit === 'hour' ? 24 : 14)) {
      return formatter.format(-Math.round(seconds / size), unit);
    }
  }

  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;

export function formatDifficulty(value: string | null | undefined): string | null {
  if (!value) return null;
  return DIFFICULTY_LABELS[value as keyof typeof DIFFICULTY_LABELS] ?? null;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Escapes regex metacharacters — same discipline as the server-side search fix. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits text on a search term for highlighting, returning alternating
 * non-matching and matching segments.
 */
export function splitOnMatch(text: string, term: string): { text: string; match: boolean }[] {
  const needle = term.trim();
  if (needle === '') return [{ text, match: false }];

  const pattern = new RegExp(`(${escapeRegex(needle)})`, 'gi');
  return text
    .split(pattern)
    .filter((segment) => segment !== '')
    .map((segment) => ({ text: segment, match: segment.toLowerCase() === needle.toLowerCase() }));
}
