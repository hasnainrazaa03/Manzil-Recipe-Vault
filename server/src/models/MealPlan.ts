import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { DATE_PATTERN, MEAL_TYPES } from '../lib/weeks.js';
import { LIMITS } from './constants.js';

const entrySchema = new Schema(
  {
    /**
     * `YYYY-MM-DD`, not a Date. A plan is a fact about a calendar, and a
     * timestamp lands on a different day depending on who is reading it.
     */
    date: { type: String, required: true, match: DATE_PATTERN },
    mealType: { type: String, required: true, enum: MEAL_TYPES },
    recipe: { type: Schema.Types.ObjectId, ref: 'Recipe', required: true },

    /**
     * How many this is being cooked for, when that differs from what the recipe
     * was written for. Null means "as written". This is what lets the generated
     * shopping list carry the right quantities.
     */
    servings: { type: Number, default: null, min: 1, max: LIMITS.servings },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const mealPlanSchema = new Schema(
  {
    user: { type: String, required: true },
    /** The Monday of the week, normalised on write. */
    weekStart: { type: String, required: true, match: DATE_PATTERN },
    entries: { type: [entrySchema], default: [] },
  },
  { timestamps: true },
);

// One plan per user per week, enforced rather than assumed — two tabs planning
// the same week must not create two documents.
mealPlanSchema.index({ user: 1, weekStart: 1 }, { unique: true });

export type MealPlanDoc = HydratedDocument<InferSchemaType<typeof mealPlanSchema>>;

export const MealPlan = mongoose.model('MealPlan', mealPlanSchema);
