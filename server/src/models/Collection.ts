import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { LIMITS } from './constants.js';

/**
 * A user-defined group of recipes — "Weeknight dinners", "Eid", "Things I keep
 * meaning to try".
 *
 * Deliberately separate from saving rather than replacing it. Saving stays the
 * one-tap action; a collection is the deliberate organising step on top, and
 * conflating the two would make the cheap action expensive.
 */
const collectionSchema = new Schema(
  {
    /** Firebase uid of the owner. */
    owner: { type: String, required: true },
    name: { type: String, required: true, maxlength: LIMITS.collectionName, trim: true },
    description: { type: String, default: '', maxlength: LIMITS.collectionDescription, trim: true },

    recipes: [{ type: Schema.Types.ObjectId, ref: 'Recipe' }],

    /** Public collections are readable by anyone with the link. */
    isPublic: { type: Boolean, default: false },

    /** Denormalised so a list of collections needs no per-row count. */
    recipeCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// Listing a user's own collections, newest activity first.
collectionSchema.index({ owner: 1, updatedAt: -1 });
// Browsing public collections.
collectionSchema.index({ isPublic: 1, updatedAt: -1 });
// "Which of my collections contain this recipe?" on the detail page.
collectionSchema.index({ owner: 1, recipes: 1 });

/** Keeps the denormalised count honest however the array was changed. */
collectionSchema.pre('save', function syncCount(next) {
  this.recipeCount = this.recipes.length;
  next();
});

export type CollectionDoc = HydratedDocument<InferSchemaType<typeof collectionSchema>>;

export const Collection = mongoose.model('Collection', collectionSchema);
