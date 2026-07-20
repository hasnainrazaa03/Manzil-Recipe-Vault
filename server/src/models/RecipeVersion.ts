import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * A point-in-time snapshot of a recipe's editable fields.
 *
 * Written on every update, so an author can see what changed and undo a bad
 * edit. Restoring writes a *new* version rather than rewinding, which keeps the
 * history append-only and means a restore can itself be undone — the property
 * that makes the feature safe to use rather than another thing to be careful
 * with.
 */
const recipeVersionSchema = new Schema(
  {
    recipe: { type: Schema.Types.ObjectId, ref: 'Recipe', required: true },

    /** Monotonic per recipe, starting at 1. */
    version: { type: Number, required: true, min: 1 },

    /** The writable surface only — never counters, ratings or comments. */
    snapshot: {
      title: String,
      image: String,
      overview: String,
      ingredients: [{ amount: String, name: String, _id: false }],
      instructions: String,
      tags: [String],
      servings: { type: Number, default: null },
      prepMinutes: { type: Number, default: null },
      cookMinutes: { type: Number, default: null },
      difficulty: { type: String, default: null },
      cuisine: String,
    },

    editedBy: { type: String, required: true },
    /** Set when this version was produced by restoring an earlier one. */
    restoredFrom: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The history query, and the uniqueness that keeps version numbers meaningful.
recipeVersionSchema.index({ recipe: 1, version: -1 }, { unique: true });

/** Keep only the most recent N versions of a recipe. */
export const MAX_VERSIONS_PER_RECIPE = 20;

export type RecipeVersionDoc = HydratedDocument<InferSchemaType<typeof recipeVersionSchema>>;

export const RecipeVersion = mongoose.model('RecipeVersion', recipeVersionSchema);
