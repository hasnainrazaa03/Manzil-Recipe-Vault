import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { LIMITS } from './constants.js';

const commentSchema = new Schema(
  {
    text: { type: String, required: true, maxlength: LIMITS.commentText, trim: true },
    authorId: { type: String, required: true },
    /**
     * Optional: a Firebase token need not carry an email claim (phone,
     * anonymous, and custom-token sign-in do not). Requiring it rejected those
     * callers with a validation error naming a field they never sent and could
     * not set. Nothing renders it — `authorDisplayName` is what gets displayed.
     */
    authorEmail: { type: String, default: '' },
    authorDisplayName: { type: String, default: '' },
    authorProfilePictureUrl: { type: String, default: '' },
    editedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const ratingSchema = new Schema(
  {
    userId: { type: String, required: true },
    score: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  },
  { _id: false },
);

const ingredientSchema = new Schema(
  {
    amount: { type: String, default: '', maxlength: LIMITS.ingredientAmount, trim: true },
    name: { type: String, required: true, maxlength: LIMITS.ingredientName, trim: true },
  },
  { _id: false },
);

const recipeSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: LIMITS.title, trim: true },
    image: { type: String, default: '', maxlength: LIMITS.imageUrl },
    overview: { type: String, required: true, maxlength: LIMITS.overview, trim: true },
    ingredients: { type: [ingredientSchema], default: [] },
    instructions: { type: String, required: true, maxlength: LIMITS.instructions },
    author: { type: String, required: true },
    /**
     * Kept for the owner's own records and for support, but never projected
     * into a response — see RECIPE_LIST_PROJECTION. Optional because a token
     * need not carry an email claim; `authorName` is what gets displayed.
     */
    authorEmail: { type: String, default: '', select: false },
    /** Denormalised display name, so rendering a card needs no Profile lookup. */
    authorName: { type: String, default: '', maxlength: LIMITS.displayName },
    tags: { type: [String], default: [] },
    ratings: { type: [ratingSchema], default: [] },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    comments: { type: [commentSchema], default: [] },
    commentCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// --- Indexes -----------------------------------------------------------------
// Every list query in the app sorts by one of these while optionally filtering
// by author or tag. Without them each page view is a collection scan plus an
// in-memory sort.
recipeSchema.index({ createdAt: -1 });
recipeSchema.index({ author: 1, createdAt: -1 });
recipeSchema.index({ tags: 1, createdAt: -1 });
recipeSchema.index({ averageRating: -1, ratingCount: -1 });
recipeSchema.index({ ratingCount: -1, createdAt: -1 });

// Full-text search across the fields a person would actually search by. Weights
// bias matches in the title above a passing mention in the instructions.
recipeSchema.index(
  { title: 'text', overview: 'text', tags: 'text', 'ingredients.name': 'text' },
  {
    name: 'recipe_text_search',
    weights: { title: 10, tags: 5, 'ingredients.name': 3, overview: 1 },
  },
);

/**
 * Fields a list view needs. Excludes the unbounded comment and rating arrays —
 * and `authorEmail`, which previously travelled with every recipe in every list
 * and public profile response. Because uids are published alongside, that made
 * the entire authoring user base enumerable uid → email without a token, which
 * was the very thing hardening the profile route was meant to prevent.
 */
export const RECIPE_LIST_PROJECTION =
  'title image overview author authorName tags averageRating ratingCount commentCount createdAt updatedAt';

export type RecipeDoc = HydratedDocument<InferSchemaType<typeof recipeSchema>>;

export const Recipe = mongoose.model('Recipe', recipeSchema);
