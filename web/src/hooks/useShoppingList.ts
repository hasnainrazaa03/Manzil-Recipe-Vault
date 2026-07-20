import { useCallback, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';
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

const isItem = (value: unknown): value is ShoppingItem =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ShoppingItem).id === 'string' &&
  typeof (value as ShoppingItem).name === 'string' &&
  typeof (value as ShoppingItem).recipeId === 'string';

const isItemList = (value: unknown): value is ShoppingItem[] =>
  Array.isArray(value) && value.every(isItem);

/**
 * A shopping list held in the browser.
 *
 * Kept local on purpose for now: it delivers most of the value with none of the
 * schema and merge-conflict risk of a synced list, and it works offline in a
 * supermarket, which is precisely where it gets used.
 */
export function useShoppingList() {
  const [items, setItems] = useLocalStorage<ShoppingItem[]>(
    STORAGE_KEYS.shoppingList,
    [],
    isItemList,
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
    hasRecipe,
  };
}
