import { useCallback, useEffect } from 'react';
import { useLocalStorageArray } from './useLocalStorage';
import { STORAGE_KEYS } from '../lib/storage';
import type { RecipeDetail } from '../types';

export interface RecentRecipe {
  id: string;
  title: string;
  image: string;
  viewedAt: number;
}

const MAX_ENTRIES = 12;

const isRecent = (value: unknown): value is RecentRecipe => {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.image === 'string' &&
    typeof entry.viewedAt === 'number'
  );
};

/**
 * The last few recipes opened, kept entirely in the browser. No server, no
 * tracking — this is a convenience for one person on one device, and treating
 * it as anything more would mean collecting reading history.
 */
export function useRecentlyViewed() {
  const [recent, setRecent] = useLocalStorageArray<RecentRecipe>(
    STORAGE_KEYS.recentlyViewed,
    isRecent,
  );

  const record = useCallback(
    (recipe: Pick<RecipeDetail, '_id' | 'title' | 'image'>) => {
      setRecent((current) => [
        { id: recipe._id, title: recipe.title, image: recipe.image, viewedAt: Date.now() },
        ...current.filter((entry) => entry.id !== recipe._id),
      ].slice(0, MAX_ENTRIES));
    },
    [setRecent],
  );

  const clear = useCallback(() => setRecent([]), [setRecent]);

  return { recent, record, clear };
}

/** Records a view as a side effect once the recipe has loaded. */
export function useRecordView(recipe: Pick<RecipeDetail, '_id' | 'title' | 'image'> | undefined) {
  const { record } = useRecentlyViewed();
  const id = recipe?._id;

  useEffect(() => {
    if (!recipe || !id) return;
    record(recipe);
    // Keyed on the id alone: `recipe` is a fresh object on every query update,
    // and depending on it would rewrite the entry on every rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}
