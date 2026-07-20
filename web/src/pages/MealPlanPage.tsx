import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';

import { Icon } from '../components/Icon';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  useMealPlan,
  useMealPlanToShoppingList,
  useRemoveMealPlanEntry,
  useUpdateMealPlanEntry,
} from '../lib/queries';
import { ApiError } from '../lib/api';
import { imageProps } from '../lib/images';
import { pluralise } from '../lib/format';
import type { MealPlanEntry, MealType } from '../types';

const MEALS: { type: MealType; label: string }[] = [
  { type: 'breakfast', label: 'Breakfast' },
  { type: 'lunch', label: 'Lunch' },
  { type: 'dinner', label: 'Dinner' },
];

const FALLBACK_IMAGE =
  'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=300';

/** Monday of the current week, as a calendar date. */
function currentWeek(): string {
  const today = new Date();
  const day = today.getDay();
  today.setDate(today.getDate() + (day === 0 ? -6 : 1 - day));
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function shiftWeek(weekStart: string, weeks: number): string {
  const [y, m, d] = weekStart.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

function formatDay(date: string): { weekday: string; day: string } {
  const parsed = new Date(`${date}T12:00:00Z`);
  return {
    weekday: parsed.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
    day: parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  };
}

const isToday = (date: string) => date === currentDate();
function currentDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function MealPlanPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const week = searchParams.get('week') ?? currentWeek();

  const { data, isPending, isError, error, refetch } = useMealPlan(week);
  const removeEntry = useRemoveMealPlanEntry(week);
  const updateEntry = useUpdateMealPlanEntry(week);
  const toShoppingList = useMealPlanToShoppingList(week);

  const [pendingRemoval, setPendingRemoval] = useState<MealPlanEntry | null>(null);

  const goToWeek = (next: string) =>
    setSearchParams(next === currentWeek() ? {} : { week: next }, { replace: true });

  const handleShoppingList = async () => {
    try {
      const result = await toShoppingList.mutateAsync();
      toast.success(
        `Added ${pluralise(result.added, 'ingredient')} from ${pluralise(result.meals, 'meal')} to your shopping list.`,
      );
    } catch (listError) {
      toast.error(
        listError instanceof ApiError ? listError.message : 'Could not build the shopping list.',
      );
    }
  };

  if (isPending) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <p>Loading your week…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        message={error instanceof ApiError ? error.message : 'Could not load your meal plan.'}
        onRetry={() => void refetch()}
      />
    );
  }

  const entriesFor = (date: string, mealType: MealType) =>
    data.entries.filter((entry) => entry.date === date && entry.mealType === mealType);

  const isEmpty = data.entries.length === 0;

  return (
    <div className="meal-plan-page">
      <header className="meal-plan-header">
        <div>
          <h1>Meal plan</h1>
          <p className="field-hint">
            {isEmpty
              ? 'Nothing planned this week yet.'
              : `${pluralise(data.entries.length, 'meal')} planned.`}
          </p>
        </div>

        <nav className="meal-plan-weeks" aria-label="Change week">
          <button type="button" onClick={() => goToWeek(shiftWeek(week, -1))} aria-label="Previous week">
            <Icon name="chevron-left" size={18} />
          </button>
          <button
            type="button"
            className="meal-plan-this-week"
            onClick={() => goToWeek(currentWeek())}
            disabled={week === currentWeek()}
          >
            {week === currentWeek() ? 'This week' : 'Back to this week'}
          </button>
          <button type="button" onClick={() => goToWeek(shiftWeek(week, 1))} aria-label="Next week">
            <Icon name="chevron-right" size={18} />
          </button>
        </nav>

        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleShoppingList()}
          disabled={isEmpty || toShoppingList.isPending}
        >
          <Icon name="cart" size={16} />
          <span>{toShoppingList.isPending ? 'Building…' : 'Add week to shopping list'}</span>
        </button>
      </header>

      {isEmpty && (
        <EmptyState
          icon="book"
          title="No meals planned for this week"
          message="Open any recipe and choose “Add to plan” to put it on a day."
          action={
            <Link to="/" className="btn-primary">
              Browse recipes
            </Link>
          }
        />
      )}

      {/* A table would be semantically neat but reads poorly on a phone, where
          this becomes seven stacked day cards rather than a grid. */}
      <div className="meal-plan-grid">
        {data.days.map((date) => {
          const { weekday, day } = formatDay(date);
          return (
            <section
              key={date}
              className={`meal-plan-day ${isToday(date) ? 'is-today' : ''}`}
              aria-label={`${weekday} ${day}`}
            >
              <h2 className="meal-plan-date">
                <span className="meal-plan-weekday">{weekday}</span>
                <span className="meal-plan-daynum">{day}</span>
                {isToday(date) && <span className="meal-plan-today-badge">Today</span>}
              </h2>

              {MEALS.map((meal) => {
                const entries = entriesFor(date, meal.type);
                return (
                  <div key={meal.type} className="meal-plan-slot">
                    <h3 className="meal-plan-slot-label">{meal.label}</h3>

                    {entries.length === 0 ? (
                      <p className="meal-plan-slot-empty">—</p>
                    ) : (
                      <ul className="meal-plan-entries">
                        {entries.map((entry) => (
                          <li key={entry._id} className="meal-plan-entry">
                            <Link to={`/recipe/${entry.recipe._id}`} className="meal-plan-entry-link">
                              <img
                                {...imageProps(entry.recipe.image || FALLBACK_IMAGE, 'thumb')}
                                referrerPolicy="no-referrer"
                                alt=""
                                loading="lazy"
                              />
                              <span className="meal-plan-entry-title">{entry.recipe.title}</span>
                            </Link>

                            <div className="meal-plan-entry-actions">
                              <label className="visually-hidden" htmlFor={`servings-${entry._id}`}>
                                Servings for {entry.recipe.title}
                              </label>
                              <input
                                id={`servings-${entry._id}`}
                                type="number"
                                min={1}
                                max={100}
                                className="meal-plan-servings"
                                value={entry.servings ?? entry.recipe.servings ?? ''}
                                placeholder="—"
                                onChange={(event) => {
                                  const value = event.target.value;
                                  void updateEntry.mutateAsync({
                                    entryId: entry._id,
                                    servings: value === '' ? null : Number(value),
                                  });
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => setPendingRemoval(entry)}
                                aria-label={`Remove ${entry.recipe.title} from ${weekday}`}
                              >
                                <Icon name="close" size={15} />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      <ConfirmDialog
        isOpen={pendingRemoval !== null}
        title="Remove from plan"
        message={
          pendingRemoval
            ? `"${pendingRemoval.recipe.title}" will be taken off your plan. The recipe itself is not affected.`
            : ''
        }
        confirmLabel="Remove"
        isDestructive
        isPending={removeEntry.isPending}
        onConfirm={async () => {
          if (!pendingRemoval) return;
          try {
            await removeEntry.mutateAsync(pendingRemoval._id);
          } catch {
            toast.error('Could not remove that meal.');
          } finally {
            setPendingRemoval(null);
          }
        }}
        onCancel={() => setPendingRemoval(null)}
      />
    </div>
  );
}
