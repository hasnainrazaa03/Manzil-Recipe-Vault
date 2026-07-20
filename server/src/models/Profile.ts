import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { LIMITS } from './constants.js';

const profileSchema = new Schema(
  {
    /** Firebase uid. */
    user: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true, maxlength: LIMITS.displayName, trim: true },
    bio: { type: String, default: '', maxlength: LIMITS.bio, trim: true },
    profilePictureUrl: { type: String, default: '', maxlength: LIMITS.imageUrl },
    savedRecipes: [{ type: Schema.Types.ObjectId, ref: 'Recipe' }],

    /**
     * Denormalised follow counts. A profile header shows both, and counting
     * rows on every render is a query per visit for a number that changes
     * rarely. Kept in step by the follow toggle.
     */
    followerCount: { type: Number, default: 0, min: 0 },
    followingCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export type ProfileDoc = HydratedDocument<InferSchemaType<typeof profileSchema>>;

export const Profile = mongoose.model('Profile', profileSchema);
