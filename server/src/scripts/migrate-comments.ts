/**
 * Moves comments out of the recipe document into their own collection.
 *
 *   npm run migrate:comments           # copy embedded comments across
 *   npm run migrate:comments -- --drop # afterwards, remove the embedded arrays
 *
 * **Deliberately two steps.** The copy is non-destructive: the embedded array
 * is left exactly as it was, so if anything is wrong with the new read path the
 * fix is to redeploy the previous build, with no data to restore. Only once the
 * new path has been verified in production is `--drop` worth running, and even
 * then it is optional — the embedded arrays are simply ignored.
 *
 * Idempotent. A recipe whose comments are already present in the collection is
 * skipped, so it is safe to run repeatedly, and safe to run while the old build
 * is still serving.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Recipe } from '../models/Recipe.js';
import { Comment } from '../models/Comment.js';
import { Profile } from '../models/Profile.js';
import { logger } from '../lib/logger.js';

interface EmbeddedComment {
  _id?: mongoose.Types.ObjectId;
  text?: string;
  authorId?: string;
  authorEmail?: string;
  authorDisplayName?: string;
  authorProfilePictureUrl?: string;
  createdAt?: Date;
  editedAt?: Date | null;
}

/** Never publish an email as a display name — see PLAN.md finding N6. */
function displayName(comment: EmbeddedComment, profileName?: string): string {
  if (profileName) return profileName;
  const stored = comment.authorDisplayName?.trim();
  if (stored && !stored.includes('@')) return stored;
  const local = (stored ?? comment.authorEmail ?? '').split('@')[0]?.trim();
  return local && local.length > 0 ? local : 'Anonymous cook';
}

async function copyComments(): Promise<void> {
  const recipes = await Recipe.find({ 'comments.0': { $exists: true } })
    .select('comments')
    .lean();

  if (recipes.length === 0) {
    logger.info('No recipes have embedded comments');
    return;
  }

  const uids = [
    ...new Set(
      recipes.flatMap((recipe) =>
        (recipe.comments as unknown as EmbeddedComment[]).map((c) => c.authorId ?? ''),
      ),
    ),
  ].filter(Boolean);

  const profiles = await Profile.find({ user: { $in: uids } })
    .select('user displayName profilePictureUrl')
    .lean();
  const byUid = new Map(profiles.map((p) => [p.user, p]));

  let copied = 0;
  let skipped = 0;

  for (const recipe of recipes) {
    const embedded = recipe.comments as unknown as EmbeddedComment[];

    for (const comment of embedded) {
      // Reuse the original _id so the migration is idempotent and so any link
      // to a specific comment keeps working.
      const _id = comment._id ?? new mongoose.Types.ObjectId();

      const already = await Comment.exists({ _id });
      if (already) {
        skipped += 1;
        continue;
      }

      const profile = byUid.get(comment.authorId ?? '');

      await Comment.create({
        _id,
        recipe: recipe._id,
        authorId: comment.authorId ?? 'unknown',
        authorName: displayName(comment, profile?.displayName),
        authorPictureUrl: profile?.profilePictureUrl ?? comment.authorProfilePictureUrl ?? '',
        text: comment.text ?? '',
        parent: null,
        createdAt: comment.createdAt ?? new Date(),
        editedAt: comment.editedAt ?? null,
      });

      copied += 1;
    }

    // Keep the counter true to the new source of truth.
    const total = await Comment.countDocuments({ recipe: recipe._id });
    await Recipe.updateOne({ _id: recipe._id }, { $set: { commentCount: total } });
  }

  logger.info(`Copied ${copied} comments (${skipped} already present) across ${recipes.length} recipes`);
}

/** Second, optional step. Only worth running once the new path is proven. */
async function dropEmbedded(): Promise<void> {
  const withEmbedded = await Recipe.countDocuments({ 'comments.0': { $exists: true } });
  if (withEmbedded === 0) {
    logger.info('No embedded comment arrays left to drop');
    return;
  }

  // Refuse to drop anything that has not been copied — the one way this script
  // could lose data is by running the two steps out of order.
  const recipes = await Recipe.find({ 'comments.0': { $exists: true } }).select('comments').lean();
  for (const recipe of recipes) {
    const embedded = (recipe.comments as unknown as EmbeddedComment[]).length;
    const migrated = await Comment.countDocuments({ recipe: recipe._id });
    if (migrated < embedded) {
      throw new Error(
        `Recipe ${String(recipe._id)} has ${embedded} embedded comments but only ${migrated} migrated. ` +
          'Run the copy step first; refusing to drop.',
      );
    }
  }

  const result = await Recipe.updateMany({}, { $unset: { comments: '' } });
  logger.info(`Dropped the embedded comment array from ${result.modifiedCount} recipes`);
}

async function run(): Promise<void> {
  const shouldDrop = process.argv.includes('--drop');

  await mongoose.connect(env.MONGO_URI);
  logger.info(shouldDrop ? 'Connected — dropping embedded comments' : 'Connected — copying comments');

  await Comment.syncIndexes();

  if (shouldDrop) await dropEmbedded();
  else await copyComments();

  await mongoose.connection.close();
  logger.info('Done');
}

run().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Comment migration failed');
  process.exit(1);
});
