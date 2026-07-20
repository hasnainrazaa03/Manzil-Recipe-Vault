import { Router } from 'express';
import { Follow } from '../models/Follow.js';
import { Profile } from '../models/Profile.js';
import { Recipe, RECIPE_LIST_PROJECTION } from '../models/Recipe.js';
import { optionalAuth, requireAuth, requireUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, badRequest, conflict } from '../lib/errors.js';
import { publicRecipes } from '../lib/serialize.js';
import { paginate, paginationQuery } from '../schemas/common.js';
import { userIdParams } from '../schemas/user.js';
import { LIMITS } from '../models/constants.js';

const router = Router();

/** Resolves uids to display names in one query rather than one per row. */
async function profilesFor(uids: string[]) {
  const profiles = await Profile.find({ user: { $in: uids } })
    .select('user displayName profilePictureUrl bio followerCount')
    .lean();

  return new Map(profiles.map((p) => [p.user, p]));
}

function publicUser(uid: string, profile?: { displayName?: string; profilePictureUrl?: string; bio?: string; followerCount?: number }) {
  return {
    uid,
    displayName: profile?.displayName ?? 'Anonymous cook',
    profilePictureUrl: profile?.profilePictureUrl ?? '',
    bio: profile?.bio ?? '',
    followerCount: profile?.followerCount ?? 0,
  };
}

/**
 * PUT /api/social/follow/:userId — idempotent toggle.
 *
 * The unique index on `(follower, following)` is what actually makes this safe:
 * two rapid taps cannot create two rows however the requests interleave, and
 * the duplicate-key error is caught and treated as "already following".
 */
router.put(
  '/follow/:userId',
  writeLimiter,
  requireAuth,
  validate({ params: userIdParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { userId } = req.params as { userId: string };

    if (userId === user.uid) throw badRequest('You cannot follow yourself');

    /**
     * Try to remove first, and let the result of that write decide what
     * happened. Every counter change is gated on a write that actually took
     * effect.
     *
     * The previous version read the row, deleted it, then decremented
     * unconditionally. Two parallel requests both saw the row and both issued
     * a delete — only one of which matched anything — yet both decremented, so
     * five concurrent taps left the counters at -1 with no follow row at all.
     * `min: 0` does not save it: `$inc` through `updateOne` skips validators,
     * and nothing recomputes the counter, so the drift was permanent.
     */
    const removed = await Follow.deleteOne({ follower: user.uid, following: userId });

    if (removed.deletedCount === 1) {
      await adjustCounts(user.uid, userId, -1);
      res.json({ following: false });
      return;
    }

    const followingCount = await Follow.countDocuments({ follower: user.uid });
    if (followingCount >= LIMITS.followingPerUser) {
      throw conflict(`You can follow at most ${LIMITS.followingPerUser} people.`);
    }

    try {
      await Follow.create({ follower: user.uid, following: userId });
    } catch (error) {
      // The unique index rejected a duplicate, so a concurrent request created
      // the row first — and already counted it. The end state is the one that
      // was asked for, so this is a success with no adjustment of its own.
      if ((error as { code?: number }).code === 11000) {
        res.json({ following: true });
        return;
      }
      throw error;
    }

    await adjustCounts(user.uid, userId, 1);
    res.json({ following: true });
  }),
);

/**
 * Moves both denormalised counters by the same delta.
 *
 * Upserts, because someone who has never saved a profile can still be
 * followed, and a counter with nowhere to live would diverge from the rows.
 */
async function adjustCounts(follower: string, following: string, delta: 1 | -1): Promise<void> {
  await Promise.all([
    Profile.updateOne(
      { user: following },
      { $inc: { followerCount: delta }, $setOnInsert: { displayName: 'Anonymous cook' } },
      { upsert: true },
    ),
    Profile.updateOne(
      { user: follower },
      { $inc: { followingCount: delta }, $setOnInsert: { displayName: 'Anonymous cook' } },
      { upsert: true },
    ),
  ]);
}

/** GET /api/social/:userId/followers */
router.get(
  '/:userId/followers',
  readLimiter,
  optionalAuth,
  validate({ params: userIdParams, query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    const query = req.query as unknown as { page: number; limit: number };

    const filter = { following: userId };
    const [total, rows] = await Promise.all([
      Follow.countDocuments(filter),
      Follow.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
    ]);

    const profiles = await profilesFor(rows.map((r) => r.follower));

    res.json(paginate(rows.map((r) => publicUser(r.follower, profiles.get(r.follower))), total, query));
  }),
);

/** GET /api/social/:userId/following */
router.get(
  '/:userId/following',
  readLimiter,
  optionalAuth,
  validate({ params: userIdParams, query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    const query = req.query as unknown as { page: number; limit: number };

    const filter = { follower: userId };
    const [total, rows] = await Promise.all([
      Follow.countDocuments(filter),
      Follow.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
    ]);

    const profiles = await profilesFor(rows.map((r) => r.following));

    res.json(paginate(rows.map((r) => publicUser(r.following, profiles.get(r.following))), total, query));
  }),
);

/** GET /api/social/relationship/:userId — does the caller follow this person? */
router.get(
  '/relationship/:userId',
  readLimiter,
  requireAuth,
  validate({ params: userIdParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { userId } = req.params as { userId: string };

    const [following, followsYou] = await Promise.all([
      Follow.exists({ follower: user.uid, following: userId }),
      Follow.exists({ follower: userId, following: user.uid }),
    ]);

    res.json({ following: Boolean(following), followsYou: Boolean(followsYou), isSelf: userId === user.uid });
  }),
);

/**
 * GET /api/social/feed — recipes from the people you follow.
 *
 * Fan-out on *read*: fetch the follow list, then query recipes by author. The
 * alternative — writing a copy of every recipe into each follower's feed —
 * is faster to read but has to be maintained, backfilled when someone follows,
 * and cleaned up when they unfollow. For an app of this size the read-time
 * query is both correct by construction and fast enough, and it cannot drift.
 */
router.get(
  '/feed',
  readLimiter,
  requireAuth,
  validate({ query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const query = req.query as unknown as { page: number; limit: number };

    const following = await Follow.find({ follower: user.uid }).select('following').lean();
    const authors = following.map((f) => f.following);

    if (authors.length === 0) {
      // An empty feed and "you follow nobody" are different states, and the UI
      // needs to tell them apart to show the right empty message.
      res.json({ ...paginate([], 0, query), followsAnyone: false });
      return;
    }

    const filter = { author: { $in: authors } };
    const [total, recipes] = await Promise.all([
      Recipe.countDocuments(filter),
      Recipe.find(filter)
        .select(RECIPE_LIST_PROJECTION)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
    ]);

    res.json({
      ...paginate(publicRecipes(recipes as unknown as Record<string, unknown>[]), total, query),
      followsAnyone: true,
    });
  }),
);

/**
 * GET /api/social/suggestions — cooks worth following.
 *
 * Authors of well-rated recipes the caller does not already follow. Deliberately
 * not personalised beyond that: a recommendation system is a much larger thing
 * than this app needs, and "people whose recipes are good" is a defensible
 * answer that nobody has to explain.
 */
router.get(
  '/suggestions',
  readLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = requireUser(req);

    const following = await Follow.find({ follower: user.uid }).select('following').lean();
    const exclude = [...following.map((f) => f.following), user.uid];

    const authors = await Recipe.aggregate<{ _id: string; recipes: number; rating: number }>([
      { $match: { author: { $nin: exclude } } },
      {
        $group: {
          _id: '$author',
          recipes: { $sum: 1 },
          rating: { $avg: '$averageRating' },
        },
      },
      { $sort: { rating: -1, recipes: -1 } },
      { $limit: 8 },
    ]);

    if (authors.length === 0) {
      res.json([]);
      return;
    }

    const profiles = await profilesFor(authors.map((a) => a._id));

    res.json(
      authors.map((author) => ({
        ...publicUser(author._id, profiles.get(author._id)),
        recipeCount: author.recipes,
        averageRating: Math.round((author.rating ?? 0) * 10) / 10,
      })),
    );
  }),
);

export default router;
