import { Icon } from './Icon';
import { isScalable, scaleAmount } from '../lib/amount';
import { useCheckedIngredients } from '../hooks/useCheckedIngredients';
import type { Ingredient } from '../types';

interface IngredientListProps {
  recipeId: string;
  ingredients: Ingredient[];
  /** 1 when the reader has not adjusted the yield. */
  scaleFactor?: number;
  /** Read-only rendering, used inside cook mode. */
  interactive?: boolean;
}

export function IngredientList({
  recipeId,
  ingredients,
  scaleFactor = 1,
  interactive = true,
}: IngredientListProps) {
  const { checked, toggle, clear, hasAny } = useCheckedIngredients(recipeId);

  if (ingredients.length === 0) {
    return <p className="field-hint">No ingredients listed.</p>;
  }

  return (
    <div className="ingredient-section">
      <ul className="ingredient-list">
        {ingredients.map((ingredient, index) => {
          const scaled = scaleAmount(ingredient.amount, scaleFactor);
          const isChecked = checked.has(index);

          // An amount the parser could not read is shown with a marker, so the
          // reader knows to scale it themselves rather than assuming it changed.
          const unscalable = scaleFactor !== 1 && ingredient.amount.trim() !== '' && !isScalable(ingredient.amount);

          if (!interactive) {
            return (
              <li key={index} className="ingredient-row">
                {scaled && <span className="ingredient-amount">{scaled}</span>}
                <span className="ingredient-name">{ingredient.name}</span>
              </li>
            );
          }

          return (
            <li key={index} className={`ingredient-row ${isChecked ? 'is-checked' : ''}`}>
              <label className="ingredient-check">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(index)}
                  aria-label={`${ingredient.amount} ${ingredient.name}`.trim()}
                />
                <span className="ingredient-check-box" aria-hidden="true">
                  <Icon name="check" size={14} />
                </span>
                <span className="ingredient-text">
                  {scaled && <span className="ingredient-amount">{scaled}</span>}
                  <span className="ingredient-name">{ingredient.name}</span>
                  {unscalable && (
                    <span
                      className="ingredient-unscaled"
                      title="This amount could not be scaled automatically"
                    >
                      not scaled
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {interactive && hasAny && (
        <button type="button" className="btn-link btn-sm" onClick={clear}>
          Clear ticks
        </button>
      )}
    </div>
  );
}
