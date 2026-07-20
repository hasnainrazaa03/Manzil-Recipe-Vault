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
  },
  { timestamps: true },
);

export type ProfileDoc = HydratedDocument<InferSchemaType<typeof profileSchema>>;

export const Profile = mongoose.model('Profile', profileSchema);
