/**
 * Guarded `localStorage` access.
 *
 * Storage is hostile in three specific ways: it throws outright in Safari
 * private mode, it silently overflows its quota, and — most often — it hands
 * back data written by an older version of the app in a shape the current code
 * does not expect. Every read therefore validates before returning, and a value
 * that fails validation is discarded rather than handed to a component that
 * will crash on it.
 */

export function readJson<T>(key: string, isValid: (value: unknown) => value is T): T | null {
  if (typeof localStorage === 'undefined') return null;

  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }

  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValid(parsed)) {
      // Stale or corrupt. Clearing it stops the same failure recurring on
      // every mount for the rest of this browser's life.
      removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    removeItem(key);
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded, or storage disabled. Nothing here is important enough to
    // interrupt the user over.
    return false;
  }
}

export function removeItem(key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing useful to do */
  }
}

// --- Shape guards ------------------------------------------------------------

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export function isArrayOf<T>(guard: (item: unknown) => item is T) {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(guard);
}

export const STORAGE_KEYS = {
  theme: 'manzil-theme',
  checkedIngredients: 'manzil-checked-ingredients',
  recentlyViewed: 'manzil-recently-viewed',
  shoppingList: 'manzil-shopping-list',
} as const;
