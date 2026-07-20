import { Router } from 'express';
import { admin } from '../config/firebase.js';
import { Profile } from '../models/Profile.js';
import { Recipe, RECIPE_LIST_PROJECTION } from '../models/Recipe.js';
import { optionalAuth, requireAuth, requireUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { objectId, paginate, paginationQuery } from '../schemas/common.js';
import { profileQuery, updateProfileBody, userIdParams } from '../schemas/user.js';
import { z } from 'zod';
import { logger } from '../lib/logger.js';

const router = Router();

/** Best-effort display name for a user who has never saved a profile. */
async function firebaseDisplayName(uid: string): Promise<string | null> {
  try {
    const record = await admin.auth().getUser(uid);
    // Deliberately not returning `record.email` — see the public route below.
    return record.displayName ?? null;
  } catch (error) {
    logger.debug({ err: error, uid }, 'Firebase user lookup failed');
    return null;
  }
}

// === CURRENT USER ============================================================

/** GET /api/users/me — the only route that returns the caller's own email. */
router.get(
  '/me',
  requireAuth,
  readLimiter,
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const profile = await Profile.findOne({ user: user.uid }).lean();

    res.json({
      uid: user.uid,
      email: user.email ?? '',
      displayName: profile?.displayName ?? user.name ?? user.email ?? '',
      bio: profile?.bio ?? '',
      profilePictureUrl: profile?.profilePictureUrl ?? '',
      savedRecipeIds: (profile?.savedRecipes ?? []).map((id) => id.toString()),
    });
  }),
);

router.put(
  '/me',
  requireAuth,
  writeLimiter,
  validate({ body: updateProfileBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const body = req.body as z.infer<typeof updateProfileBody>;

    const profile = await Profile.findOneAndUpdate(
      { user: user.uid },
      { $set: body },
      { new: true, upsert: true, runValidators: true },
    ).lean();

    // `authorName` is denormalised onto every recipe and comment so that
    // rendering a card needs no join; renaming has to fan out to keep them true.
    await Promise.all([
      Recipe.updateMany({ author: user.uid }, { $set: { authorName: body.displayName } }),
      Recipe.updateMany(
        { 'comments.authorId': user.uid },
        { $set: { 'comments.$[entry].authorDisplayName': body.displayName } },
        { arrayFilters: [{ 'entry.authorId': user.uid }] },
      ),
    ]);

    // Keep the Firebase record in step, but never fail the request over it —
    // the profile is our source of truth and is already saved.
    try {
      await admin.auth().updateUser(user.uid, { displayName: body.displayName });
    } catch (error) {
      logger.warn({ err: error, uid: user.uid }, 'Could not sync displayName to Firebase');
    }

    res.json({
      uid: user.uid,
      displayName: profile?.displayName ?? '',
      bio: profile?.bio ?? '',
      profilePictureUrl: profile?.profilePictureUrl ?? '',
    });
  }),
);

// === SAVED RECIPES ===========================================================

router.get(
  '/me/saved-recipes',
  requireAuth,
  readLimiter,
  validate({ query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const query = req.query as unknown as { page: number; limit: number };

    const profile = await Profile.findOne({ user: user.uid }).select('savedRecipes').lean();
    const savedIds = profile?.savedRecipes ?? [];

    if (savedIds.length === 0) {
      res.json(paginate([], 0, query));
      return;
    }

    const filter = { _id: { $in: savedIds } };

    // Counting the *matching recipes* rather than the length of savedRecipes is
    // the fix for phantom trailing pages: a saved recipe that has since been
    // deleted used to still count toward the total.
    const [total, recipes] = await Promise.all([
      Recipe.countDocuments(filter),
      Recipe.find(filter)
        .select(RECIPE_LIST_PROJECTION)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
    ]);

    res.json(paginate(recipes, total, query));
  }),
);

/** PUT /api/users/me/saved-recipes/:recipeId — idempotent toggle. */
router.put(
  '/me/saved-recipes/:recipeId',
  requireAuth,
  writeLimiter,
  validate({ params: z.object({ recipeId: objectId }) }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { recipeId } = req.params as { recipeId: string };

    const exists = await Recipe.exists({ _id: recipeId });
    if (!exists) throw notFound('Recipe not found');

    await Profile.updateOne(
      { user: user.uid },
      { $setOnInsert: { displayName: user.name ?? user.email ?? 'Anonymous' } },
      { upsert: true },
    );

    const alreadySaved = await Profile.exists({ user: user.uid, savedRecipes: recipeId });

    // Atomic $addToSet/$pull rather than read-modify-write, so two rapid taps
    // cannot leave a duplicate id or drop the write.
    const updated = await Profile.findOneAndUpdate(
      { user: user.uid },
      alreadySaved
        ? { $pull: { savedRecipes: recipeId } }
        : { $addToSet: { savedRecipes: recipeId } },
      { new: true },
    )
      .select('savedRecipes')
      .lean();

    res.json({
      saved: !alreadySaved,
      savedRecipeIds: (updated?.savedRecipes ?? []).map((id) => id.toString()),
    });
  }),
);

// === PUBLIC PROFILE ==========================================================

/**
 * GET /api/users/:userId/profile
 *
 * Public, and therefore email-free. The previous version returned the account's
 * real email address from Firebase Admin to any unauthenticated caller who knew
 * a uid — and uids are published in every recipe payload, so the whole user
 * table was enumerable. It also returned the user's private saved-recipe list.
 */
router.get(
  '/:userId/profile',
  readLimiter,
  optionalAuth,
  validate({ params: userIdParams, query: profileQuery }),
  asyncHandler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    const query = req.query as unknown as { page: number; limit: number };
    const isOwner = req.user?.uid === userId;

    const profile = await Profile.findOne({ user: userId }).lean();

    let displayName = profile?.displayName ?? null;
    if (!displayName) displayName = await firebaseDisplayName(userId);

    const filter = { author: userId };
    const [total, recipes] = await Promise.all([
      Recipe.countDocuments(filter),
      Recipe.find(filter)
        .select(RECIPE_LIST_PROJECTION)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
    ]);

    // A uid with neither a profile nor any recipes is not a user we know about.
    if (!profile && !displayName && total === 0) throw notFound('User not found');

    res.json({
      user: {
        uid: userId,
        displayName: displayName ?? 'Anonymous cook',
        bio: profile?.bio ?? '',
        profilePictureUrl: profile?.profilePictureUrl ?? '',
        recipeCount: total,
        isOwner,
      },
      recipes: paginate(recipes, total, query),
    });
  }),
);

export default router;
