import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * One person following another.
 *
 * A join collection rather than an array on the profile, because arrays are
 * what the rest of this codebase keeps getting bitten by: they are unbounded,
 * they make "is A following B?" a scan, and they cannot be indexed usefully in
 * both directions. A row per relationship answers followers and following with
 * the same two indexes.
 */
const followSchema = new Schema(
  {
    follower: { type: String, required: true },
    following: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Makes the relationship idempotent at the database level, so a double-tap
// cannot create two rows no matter how the requests interleave.
followSchema.index({ follower: 1, following: 1 }, { unique: true });

// "Who do I follow?" — drives the feed.
followSchema.index({ follower: 1, createdAt: -1 });
// "Who follows this person?" — drives the profile.
followSchema.index({ following: 1, createdAt: -1 });

export type FollowDoc = HydratedDocument<InferSchemaType<typeof followSchema>>;

export const Follow = mongoose.model('Follow', followSchema);
