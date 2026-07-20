/**
 * One-off migration: populate `Recipe.authorName` for recipes created before
 * the field existed.
 *
 * Cards used to display the author's email address, which meant every list
 * response carried one. `authorName` replaced it, so existing recipes need a
 * name filled in or they render as "Anonymous cook".
 *
 * Run once after deploying:  npm run build && node dist/scripts/backfill-author-names.js
 * It is idempotent — only recipes with a missing or empty `authorName` are touched.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Recipe } from '../models/Recipe.js';
import { Profile } from '../models/Profile.js';
import { logger } from '../lib/logger.js';

async function run(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);
  logger.info('Connected — backfilling recipe author names');

  const pending = await Recipe.find({
    $or: [{ authorName: { $exists: false } }, { authorName: '' }],
  })
    .select('author authorEmail')
    .lean();

  if (pending.length === 0) {
    logger.info('Nothing to backfill');
    await mongoose.connection.close();
    return;
  }

  const uids = [...new Set(pending.map((recipe) => recipe.author))];
  const profiles = await Profile.find({ user: { $in: uids } })
    .select('user displayName')
    .lean();
  const names = new Map(profiles.map((profile) => [profile.user, profile.displayName]));

  const operations = pending.map((recipe) => ({
    updateOne: {
      filter: { _id: recipe._id },
      update: {
        $set: {
          authorName:
            names.get(recipe.author) || recipe.authorEmail?.split('@')[0] || 'Anonymous cook',
        },
      },
    },
  }));

  const result = await Recipe.bulkWrite(operations);
  logger.info(`Backfilled ${result.modifiedCount} of ${pending.length} recipes`);

  await repairCommentDisplayNames();
  await backfillCommentCounts();

  await mongoose.connection.close();
}

/**
 * Populate `commentCount` on recipes written before the field existed.
 *
 * List queries use `.lean()`, which skips hydration — so Mongoose's `default: 0`
 * never applies and the field simply arrives absent. The API normalises this on
 * read, but a stored counter is what `sort` and future queries can actually use,
 * and leaving the two representations disagreeing is the kind of thing that
 * bites later.
 */
async function backfillCommentCounts(): Promise<void> {
  const result = await Recipe.updateMany({ commentCount: { $exists: false } }, [
    { $set: { commentCount: { $size: { $ifNull: ['$comments', []] } } } },
  ]);

  logger.info(`Backfilled commentCount on ${result.modifiedCount} recipes`);

  // Same story for the rating counters, which predate nothing but can drift if
  // a document was ever written outside the application.
  const drifted = await Recipe.updateMany(
    { $expr: { $ne: ['$ratingCount', { $size: { $ifNull: ['$ratings', []] } }] } },
    [{ $set: { ratingCount: { $size: { $ifNull: ['$ratings', []] } } } }],
  );

  if (drifted.modifiedCount > 0) {
    logger.warn(`Corrected ${drifted.modifiedCount} recipes whose ratingCount had drifted`);
  }
}

/**
 * Comments written before the fix stored the commenter's full email address as
 * their display name whenever they had no saved profile — and that name is
 * served publicly. This rewrites any such name to the local part, or to the
 * user's profile name where one now exists.
 */
async function repairCommentDisplayNames(): Promise<void> {
  const affected = await Recipe.find({ 'comments.authorDisplayName': /@/ })
    .select('comments')
    .lean();

  if (affected.length === 0) {
    logger.info('No comment display names to repair');
    return;
  }

  const uids = [
    ...new Set(
      affected.flatMap((recipe) =>
        recipe.comments
          .filter((comment) => comment.authorDisplayName?.includes('@'))
          .map((comment) => comment.authorId),
      ),
    ),
  ];

  const profiles = await Profile.find({ user: { $in: uids } })
    .select('user displayName')
    .lean();
  const names = new Map(profiles.map((profile) => [profile.user, profile.displayName]));

  let repaired = 0;
  for (const recipe of affected) {
    for (const comment of recipe.comments) {
      if (!comment.authorDisplayName?.includes('@')) continue;

      // `||` not `??`: an empty string is the schema default and is exactly
      // the case that needs replacing, but `??` would keep it.
      const replacement =
        names.get(comment.authorId) ||
        comment.authorDisplayName.split('@')[0] ||
        'Anonymous cook';

      await Recipe.updateOne(
        { _id: recipe._id, 'comments._id': comment._id },
        { $set: { 'comments.$.authorDisplayName': replacement } },
      );
      repaired += 1;
    }
  }

  logger.info(`Repaired ${repaired} comment display names`);
}

run().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Backfill failed');
  process.exit(1);
});
