import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { STORAGE_KEYS } from '../lib/storage';

type CheckedMap = Record<string, number[]>;

const isCheckedMap = (value: unknown): value is CheckedMap =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (entry) => Array.isArray(entry) && entry.every((n) => typeof n === 'number'),
  );

/**
 * Which ingredients have been ticked off, per recipe.
 *
 * Persisted because a phone on a kitchen counter locks, sleeps and reloads
 * constantly, and losing your place halfway through a mise en place is exactly
 * the moment the app would feel broken.
 */
export function useCheckedIngredients(recipeId: string) {
  const [map, setMap] = useLocalStorage<CheckedMap>(
    STORAGE_KEYS.checkedIngredients,
    {},
    isCheckedMap,
  );

  const checked = new Set(map[recipeId] ?? []);

  const toggle = useCallback(
    (index: number) => {
      setMap((current) => {
        const existing = new Set(current[recipeId] ?? []);
        if (existing.has(index)) existing.delete(index);
        else existing.add(index);

        const next = { ...current };
        if (existing.size === 0) delete next[recipeId];
        else next[recipeId] = [...existing].sort((a, b) => a - b);
        return next;
      });
    },
    [recipeId, setMap],
  );

  const clear = useCallback(() => {
    setMap((current) => {
      const next = { ...current };
      delete next[recipeId];
      return next;
    });
  }, [recipeId, setMap]);

  return { checked, toggle, clear, hasAny: checked.size > 0 };
}
