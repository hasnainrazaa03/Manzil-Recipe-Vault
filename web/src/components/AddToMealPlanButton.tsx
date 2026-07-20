import { useState } from 'react';
import { toast } from 'react-toastify';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { useAddMealPlanEntry } from '../lib/queries';
import { ApiError } from '../lib/api';
import type { MealType } from '../types';

const MEALS: { type: MealType; label: string }[] = [
  { type: 'breakfast', label: 'Breakfast' },
  { type: 'lunch', label: 'Lunch' },
  { type: 'dinner', label: 'Dinner' },
];

/** Monday of the current week, as a calendar date rather than an instant. */
function currentWeek(): string {
  const today = new Date();
  today.setDate(today.getDate() + (today.getDay() === 0 ? -6 : 1 - today.getDay()));
  return toDateString(today);
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The next fourteen days, so "next Saturday" is reachable without paging. */
function upcomingDays(): { date: string; label: string }[] {
  const today = new Date();

  return Array.from({ length: 14 }, (_, offset) => {
    const day = new Date(today);
    day.setDate(today.getDate() + offset);

    const label =
      offset === 0
        ? 'Today'
        : offset === 1
          ? 'Tomorrow'
          : day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

    return { date: toDateString(day), label };
  });
}

interface AddToMealPlanButtonProps {
  recipeId: string;
  recipeTitle: string;
}

export function AddToMealPlanButton({ recipeId, recipeTitle }: AddToMealPlanButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [date, setDate] = useState(() => toDateString(new Date()));
  const [mealType, setMealType] = useState<MealType>('dinner');

  // Keyed on the week the chosen day belongs to, so the cache entry updated is
  // the one the plan page will read.
  const addEntry = useAddMealPlanEntry(currentWeek());

  const days = upcomingDays();

  const handleAdd = async () => {
    try {
      await addEntry.mutateAsync({ date, mealType, recipe: recipeId });
      const label = days.find((day) => day.date === date)?.label ?? date;
      toast.success(`Added to ${label.toLowerCase()}'s ${mealType}.`);
      setIsOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not add that to your plan.');
    }
  };

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => setIsOpen(true)}>
        <Icon name="calendar" size={16} />
        <span>Add to plan</span>
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title={`Plan “${recipeTitle}”`}>
        <div className="meal-plan-picker">
          <div className="field">
            <label htmlFor="plan-day">Day</label>
            <select id="plan-day" value={date} onChange={(event) => setDate(event.target.value)}>
              {days.map((day) => (
                <option key={day.date} value={day.date}>
                  {day.label}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="field">
            <legend>Meal</legend>
            <div className="meal-plan-picker-meals" role="radiogroup" aria-label="Meal">
              {MEALS.map((meal) => (
                <button
                  key={meal.type}
                  type="button"
                  role="radio"
                  aria-checked={mealType === meal.type}
                  className={`meal-plan-picker-meal ${mealType === meal.type ? 'is-selected' : ''}`}
                  onClick={() => setMealType(meal.type)}
                >
                  {meal.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleAdd()}
              disabled={addEntry.isPending}
            >
              {addEntry.isPending ? 'Adding…' : 'Add to plan'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
