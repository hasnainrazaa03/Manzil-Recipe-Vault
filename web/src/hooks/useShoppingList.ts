import { useCallback, useMemo } from 'react';
import { useLocalStorageArray } from './useLocalStorage';
import { STORAGE_KEYS } from '../lib/storage';
import type { Ingredient } from '../types';

export interface ShoppingItem {
  id: string;
  amount: string;
  name: string;
  recipeId: string;
  recipeTitle: string;
  checked: boolean;
  addedAt: number;
}

/**
 * Validates every field a consumer actually reads, not just the identifiers.
 * A missing `amount` rendered `aria-label="undefined flour"` and copied
 * "- undefined flour" to the clipboard; a non-boolean `checked` mis-counted
 * how many items were left.
 */
const isItem = (value: unknown): value is ShoppingItem => {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.recipeId === 'string' &&
    typeof item.recipeTitle === 'string' &&
    typeof item.amount === 'string' &&
    typeof item.checked === 'boolean'
  );
};

/**
 * A shopping list held in the browser.
 *
 * Kept local on purpose for now: it delivers most of the value with none of the
 * schema and merge-conflict risk of a synced list, and it works offline in a
 * supermarket, which is precisely where it gets used.
 */
export function useShoppingList() {
  const [items, setItems] = useLocalStorageArray<ShoppingItem>(
    STORAGE_KEYS.shoppingList,
    isItem,
  );

  const addRecipe = useCallback(
    (recipeId: string, recipeTitle: string, ingredients: Ingredient[]) => {
      setItems((current) => {
        // Re-adding a recipe replaces its previous entries rather than
        // duplicating them — the amounts may have been rescaled since.
        const others = current.filter((item) => item.recipeId !== recipeId);
        const added = ingredients
          .filter((ingredient) => ingredient.name.trim() !== '')
          .map((ingredient, index) => ({
            id: `${recipeId}-${index}-${ingredient.name}`,
            amount: ingredient.amount,
            name: ingredient.name,
            recipeId,
            recipeTitle,
            checked: false,
            addedAt: Date.now(),
          }));

        return [...others, ...added];
      });
    },
    [setItems],
  );

  const toggle = useCallback(
    (id: string) => {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)),
      );
    },
    [setItems],
  );

  const remove = useCallback(
    (id: string) => setItems((current) => current.filter((item) => item.id !== id)),
    [setItems],
  );

  const removeRecipe = useCallback(
    (recipeId: string) =>
      setItems((current) => current.filter((item) => item.recipeId !== recipeId)),
    [setItems],
  );

  const clearChecked = useCallback(
    () => setItems((current) => current.filter((item) => !item.checked)),
    [setItems],
  );

  const clearAll = useCallback(() => setItems([]), [setItems]);

  /** Adopts a list wholesale — used by the sync hook after a server merge. */
  const replaceAll = useCallback((next: ShoppingItem[]) => setItems(next), [setItems]);

  /** Grouped by recipe, because that is how the list is built and reviewed. */
  const grouped = useMemo(() => {
    const groups = new Map<string, { recipeId: string; recipeTitle: string; items: ShoppingItem[] }>();
    for (const item of items) {
      const existing = groups.get(item.recipeId);
      if (existing) existing.items.push(item);
      else
        groups.set(item.recipeId, {
          recipeId: item.recipeId,
          recipeTitle: item.recipeTitle,
          items: [item],
        });
    }
    return [...groups.values()];
  }, [items]);

  const hasRecipe = useCallback(
    (recipeId: string) => items.some((item) => item.recipeId === recipeId),
    [items],
  );

  return {
    items,
    grouped,
    count: items.length,
    remaining: items.filter((item) => !item.checked).length,
    addRecipe,
    toggle,
    remove,
    removeRecipe,
    clearChecked,
    clearAll,
    replaceAll,
    hasRecipe,
  };
}
