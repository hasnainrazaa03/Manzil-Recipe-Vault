import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { LIMITS } from './constants.js';

/**
 * Comments as their own collection.
 *
 * They were embedded in the recipe document, which meant every recipe write
 * rewrote the entire comment array, every detail read loaded all of them, and
 * the document carried a hard 16 MB ceiling — which is why a 500-comment cap
 * had to exist at all. None of that is true of a separate collection.
 *
 * `Recipe.commentCount` remains as a denormalised counter: it is what a card
 * renders, and counting per card would be one query per card.
 */
const commentSchema = new Schema(
  {
    recipe: { type: Schema.Types.ObjectId, ref: 'Recipe', required: true },

    authorId: { type: String, required: true },
    /** Denormalised so rendering a thread needs no join. */
    authorName: { type: String, default: 'Anonymous cook', maxlength: LIMITS.displayName },
    authorPictureUrl: { type: String, default: '', maxlength: LIMITS.imageUrl },

    text: { type: String, required: true, maxlength: LIMITS.commentText, trim: true },

    /**
     * One level of replies and no deeper. Arbitrarily deep threading becomes a
     * moderation and layout problem long before it becomes a feature.
     */
    parent: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },

    editedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The thread query: a recipe's comments, newest first.
commentSchema.index({ recipe: 1, createdAt: -1 });
// Replies to a given comment.
commentSchema.index({ parent: 1, createdAt: 1 });
// "Everything this person has written", for a profile or for moderation.
commentSchema.index({ authorId: 1, createdAt: -1 });

export type CommentDoc = HydratedDocument<InferSchemaType<typeof commentSchema>>;

export const Comment = mongoose.model('Comment', commentSchema);
