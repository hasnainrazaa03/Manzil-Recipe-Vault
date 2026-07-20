import { Router } from 'express';
import mongoose, { type FilterQuery } from 'mongoose';
import { Recipe, RECIPE_LIST_PROJECTION } from '../models/Recipe.js';
import { Profile } from '../models/Profile.js';
import { optionalAuth, requireAuth, requireUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { interactionLimiter, readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { escapeRegex } from '../lib/sanitize.js';
import { publicComment, publicRecipe, publicRecipes } from '../lib/serialize.js';
import { paginate, paginationQuery } from '../schemas/common.js';
import {
  commentBody,
  commentIdParams,
  createRecipeBody,
  listRecipesQuery,
  ratingBody,
  recipeIdParams,
  updateRecipeBody,
  type ListRecipesQuery,
} from '../schemas/recipe.js';
import { LIMITS } from '../models/constants.js';

const router = Router();

/**
 * A publishable name derived from whatever identity we have. Takes the local
 * part of an email so an address is never displayed in full.
 */
export function displayNameFrom(value?: string): string {
  const name = value?.split('@')[0]?.trim();
  return name && name.length > 0 ? name : 'Anonymous cook';
}

/** Best display name for a new recipe's author, denormalised at write time. */
async function resolveAuthorName(uid: string, fallback?: string): Promise<string> {
  const profile = await Profile.findOne({ user: uid }).select('displayName').lean();
  return profile?.displayName ?? displayNameFrom(fallback);
}

/**
 * Translate validated query params into a Mongo filter.
 *
 * The search term is regex-escaped before it ever reaches the driver — the
 * previous implementation interpolated it raw, which let an anonymous caller
 * pin a CPU core with `(a+)+$`.
 */
function buildFilter(query: ListRecipesQuery, viewerUid?: string): FilterQuery<unknown> {
  const filter: FilterQuery<unknown> = {};

  if (query.author) {
    filter.author = query.author === 'me' ? (viewerUid ?? '__anonymous__') : query.author;
  }

  if (query.tag) {
    filter.tags = query.tagMode === 'all' ? { $all: query.tag } : { $in: query.tag };
  }

  if (query.difficulty) filter.difficulty = query.difficulty;
  if (query.cuisine) filter.cuisine = new RegExp(`^${escapeRegex(query.cuisine)}$`, 'i');

  // A recipe with no stated time is excluded rather than assumed fast — the
  // alternative silently recommends dishes we know nothing about. The same
  // applies to sorting by speed: Mongo orders null before any number ascending,
  // so without this every untimed recipe would head a "quickest first" list.
  if (query.maxMinutes || query.sort === 'quickest') {
    filter.totalMinutes = {
      $ne: null,
      ...(query.maxMinutes ? { $lte: query.maxMinutes } : {}),
    };
  }

  if (query.search) {
    if (query.sort === 'relevance') {
      // Indexed, stemmed, weighted — but whole-word only.
      filter.$text = { $search: query.search };
    } else {
      // Substring matching, which is what people expect while typing.
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [
        { title: pattern },
        { overview: pattern },
        { tags: pattern },
        { 'ingredients.name': pattern },
      ];
    }
  }

  return filter;
}

type SortSpec = Record<string, 1 | -1 | { $meta: 'textScore' }>;

function buildSort(query: ListRecipesQuery): SortSpec {
  switch (query.sort) {
    case 'oldest':
      return { createdAt: 1 };
    case 'rating':
      return { averageRating: -1, ratingCount: -1 };
    case 'popular':
      return { ratingCount: -1, createdAt: -1 };
    case 'quickest':
      return { totalMinutes: 1, createdAt: -1 };
    case 'relevance':
      return query.search ? { score: { $meta: 'textScore' }, createdAt: -1 } : { createdAt: -1 };
    case 'newest':
    default:
      return { createdAt: -1 };
  }
}

// === PUBLIC READS ============================================================

/**
 * GET /api/recipes
 * One endpoint for every list view. `?author=me` replaces the old split between
 * `/public` and `/`, which duplicated the same 30 lines with one filter changed.
 */
router.get(
  '/',
  optionalAuth,
  readLimiter,
  validate({ query: listRecipesQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListRecipesQuery;

    // "My recipes" is meaningless without an identity. Answering 200 with an
    // empty list told a user whose token had just expired that they had written
    // nothing at all.
    if (query.author === 'me' && !req.user) {
      throw unauthorized(
        req.authExpired ? 'Your session has expired. Please sign in again.' : 'Sign in to see your recipes',
      );
    }

    const filter = buildFilter(query, req.user?.uid);
    const skip = (query.page - 1) * query.limit;

    const projection =
      query.sort === 'relevance' && query.search
        ? { score: { $meta: 'textScore' } }
        : undefined;

    // These two are independent; running them sequentially doubled list latency.
    const [total, recipes] = await Promise.all([
      Recipe.countDocuments(filter),
      Recipe.find(filter, projection)
        .select(RECIPE_LIST_PROJECTION)
        .sort(buildSort(query))
        .skip(skip)
        .limit(query.limit)
        .lean(),
    ]);

    res.json(paginate(publicRecipes(recipes as unknown as Record<string, unknown>[]), total, query));
  }),
);

/**
 * GET /api/recipes/tags
 * Returns tags with usage counts, most-used first, so the UI can render a
 * bounded, meaningful filter bar instead of every tag ever typed.
 */
router.get(
  '/tags',
  readLimiter,
  asyncHandler(async (_req, res) => {
    const tags = await Recipe.aggregate<{ tag: string; count: number }>([
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 50 },
      { $project: { _id: 0, tag: '$_id', count: 1 } },
    ]);

    res.json(tags);
  }),
);

/** GET /api/recipes/cuisines — populated cuisines with counts, for the filter bar. */
router.get(
  '/cuisines',
  readLimiter,
  asyncHandler(async (_req, res) => {
    const cuisines = await Recipe.aggregate<{ cuisine: string; count: number }>([
      { $match: { cuisine: { $nin: [null, ''] } } },
      // Grouped case-insensitively: the write path preserves whatever casing
      // the author typed, so grouping on the raw string listed "Thai" and
      // "thai" as two separate filters that both matched the same recipes.
      // The first spelling encountered becomes the label.
      {
        $group: {
          _id: { $toLower: '$cuisine' },
          count: { $sum: 1 },
          label: { $first: '$cuisine' },
        },
      },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 30 },
      { $project: { _id: 0, cuisine: '$label', count: 1 } },
    ]);

    res.json(cuisines);
  }),
);

/**
 * GET /api/recipes/:id/related
 *
 * Recipes sharing the most tags with this one. Ranked by overlap size, then by
 * rating, so a single shared tag does not outrank a genuine match. Falls back
 * to same-cuisine and then to well-rated recipes, so the section is never empty
 * on a recipe that happens to have no tags.
 */
router.get(
  '/:id/related',
  readLimiter,
  validate({ params: recipeIdParams }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const LIMIT = 6;

    const recipe = await Recipe.findById(id).select('tags cuisine').lean();
    if (!recipe) throw notFound('Recipe not found');

    const byTags =
      recipe.tags.length > 0
        ? await Recipe.aggregate([
            { $match: { _id: { $ne: recipe._id }, tags: { $in: recipe.tags } } },
            {
              $addFields: {
                overlap: { $size: { $setIntersection: ['$tags', recipe.tags] } },
              },
            },
            { $sort: { overlap: -1, averageRating: -1, createdAt: -1 } },
            { $limit: LIMIT },
            // An inclusion list matching RECIPE_LIST_PROJECTION. The previous
            // exclusion list left this branch returning `ingredients` and `__v`
            // while the fallback branch below did not — two shapes from one
            // endpoint, and a bigger payload than a rail of cards needs.
            {
              $project: {
                title: 1, image: 1, overview: 1, author: 1, authorName: 1, tags: 1,
                averageRating: 1, ratingCount: 1, commentCount: 1, createdAt: 1, updatedAt: 1,
                servings: 1, prepMinutes: 1, cookMinutes: 1, totalMinutes: 1,
                difficulty: 1, cuisine: 1,
              },
            },
          ])
        : [];

    let results = byTags;

    /**
     * Top up with same-cuisine recipes, then with anything well rated.
     *
     * The second pass matters: a recipe whose cuisine nothing else shares got
     * an empty rail, despite the docstring promising otherwise, because the
     * only fallback was cuisine-restricted.
     */
    for (const extraFilter of [recipe.cuisine ? { cuisine: recipe.cuisine } : null, {}]) {
      if (results.length >= LIMIT || extraFilter === null) continue;

      const seen = new Set(results.map((item) => String(item._id)));
      const filler = await Recipe.find({
        _id: { $ne: recipe._id, $nin: [...seen] },
        ...extraFilter,
      })
        .select(RECIPE_LIST_PROJECTION)
        .sort({ averageRating: -1, ratingCount: -1, createdAt: -1 })
        .limit(LIMIT - results.length)
        .lean();

      results = [...results, ...filler];
    }

    res.json(results.map((item) => publicRecipe(item as Record<string, unknown>)));
  }),
);

/**
 * GET /api/recipes/:id
 * The endpoint that makes recipes linkable. Returns the recipe plus, for a
 * signed-in caller, their own rating and whether they saved it — details that
 * previously cost two extra round-trips.
 */
router.get(
  '/:id',
  optionalAuth,
  readLimiter,
  validate({ params: recipeIdParams, query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const recipe = await Recipe.findById(id).lean();
    if (!recipe) throw notFound('Recipe not found');

    const uid = req.user?.uid;
    const userScore = uid ? (recipe.ratings.find((r) => r.userId === uid)?.score ?? 0) : 0;

    let isSaved = false;
    if (uid) {
      const saved = await Profile.exists({ user: uid, savedRecipes: recipe._id });
      isSaved = Boolean(saved);
    }

    // Newest comments first, capped — the full array is never sent.
    const comments = [...recipe.comments]
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
      .slice(0, LIMITS.tags * 2);

    const { ratings: _ratings, comments: _comments, ...rest } = recipe;

    res.json({
      ...publicRecipe(rest as Record<string, unknown>),
      comments: comments.map((comment) => publicComment(comment as unknown as Record<string, unknown>)),
      commentCount: recipe.comments.length,
      viewer: { userScore, isSaved, isAuthor: uid === recipe.author },
    });
  }),
);

/** GET /api/recipes/:id/comments — paginated, so a busy recipe stays cheap. */
router.get(
  '/:id/comments',
  readLimiter,
  validate({ params: recipeIdParams, query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const query = req.query as unknown as { page: number; limit: number };

    const recipe = await Recipe.findById(id).select('comments').lean();
    if (!recipe) throw notFound('Recipe not found');

    const sorted = [...recipe.comments].sort(
      (a, b) => Number(b.createdAt) - Number(a.createdAt),
    );
    const start = (query.page - 1) * query.limit;
    const page = sorted
      .slice(start, start + query.limit)
      .map((comment) => publicComment(comment as unknown as Record<string, unknown>));

    res.json(paginate(page, sorted.length, query));
  }),
);

// === AUTHENTICATED WRITES ====================================================

router.post(
  '/',
  writeLimiter,
  requireAuth,
  validate({ body: createRecipeBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);

    // Author identity comes from the verified token, never from the body.
    const recipe = await Recipe.create({
      ...req.body,
      author: user.uid,
      authorEmail: user.email ?? '',
      authorName: await resolveAuthorName(user.uid, user.name ?? user.email),
    });

    res.status(201).json(publicRecipe(recipe.toJSON()));
  }),
);

router.put(
  '/:id',
  writeLimiter,
  requireAuth,
  validate({ params: recipeIdParams, body: updateRecipeBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    const recipe = await Recipe.findById(id);
    if (!recipe) throw notFound('Recipe not found');
    if (recipe.author !== user.uid) throw forbidden('You can only edit your own recipes');

    // `req.body` is the parsed output of a strict schema covering only writable
    // fields, so `author`, `ratings` and `averageRating` cannot be reached here.
    recipe.set(req.body);
    await recipe.save();

    res.json(publicRecipe(recipe.toJSON()));
  }),
);

router.delete(
  '/:id',
  writeLimiter,
  requireAuth,
  validate({ params: recipeIdParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    const recipe = await Recipe.findById(id).select('author');
    if (!recipe) throw notFound('Recipe not found');
    if (recipe.author !== user.uid) throw forbidden('You can only delete your own recipes');

    await recipe.deleteOne();

    // Without this, the id lingers in every saver's list forever, inflating
    // their saved-recipe page count with entries that render nothing.
    await Profile.updateMany({ savedRecipes: id }, { $pull: { savedRecipes: id } });

    res.json({ success: true });
  }),
);

// === COMMENTS ================================================================

/**
 * Every write below uses a single atomic update rather than
 * `findById` → mutate → `save()`.
 *
 * That read-modify-write cycle was actively corrupting data: Mongoose emits a
 * `$push` for the array but a plain `$set` for the counter computed from the
 * writer's stale copy, so two people commenting at once left `comments.length`
 * and `commentCount` permanently disagreeing. It also raised `VersionError` —
 * surfacing as a 500 — whenever anyone edited a comment while someone else
 * commented on the same recipe.
 *
 * Deriving the counter with `$size` inside the same update makes the two
 * impossible to diverge.
 */
router.post(
  '/:id/comments',
  interactionLimiter,
  requireAuth,
  validate({ params: recipeIdParams, body: commentBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    const profile = await Profile.findOne({ user: user.uid })
      .select('displayName profilePictureUrl')
      .lean();

    const comment = {
      _id: new mongoose.Types.ObjectId(),
      text: (req.body as { text: string }).text,
      authorId: user.uid,
      authorEmail: user.email ?? '',
      // Never the raw email: falling back to it published the full address of
      // any commenter without a saved profile, which is every new account.
      authorDisplayName: profile?.displayName ?? displayNameFrom(user.name ?? user.email),
      authorProfilePictureUrl: profile?.profilePictureUrl ?? '',
      createdAt: new Date(),
      editedAt: null,
    };

    const updated = await Recipe.findOneAndUpdate(
      {
        _id: id,
        // Bounds the document. Without a cap one account could push a recipe
        // past MongoDB's 16 MB ceiling, after which *no* write to it succeeds —
        // its owner could no longer edit it and no comment could be deleted.
        $expr: { $lt: [{ $size: { $ifNull: ['$comments', []] } }, LIMITS.commentsPerRecipe] },
      },
      [
        { $set: { comments: { $concatArrays: [{ $ifNull: ['$comments', []] }, [comment]] } } },
        { $set: { commentCount: { $size: '$comments' } } },
      ],
      { new: true, projection: { _id: 1 } },
    ).lean();

    if (!updated) {
      // Either the recipe is gone or it is full; say which.
      const exists = await Recipe.exists({ _id: id });
      if (!exists) throw notFound('Recipe not found');
      throw conflict(
        `This recipe has reached its limit of ${LIMITS.commentsPerRecipe} comments.`,
      );
    }

    res.status(201).json(publicComment(comment));
  }),
);

router.patch(
  '/:id/comments/:commentId',
  interactionLimiter,
  requireAuth,
  validate({ params: commentIdParams, body: commentBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id, commentId } = req.params as { id: string; commentId: string };
    const text = (req.body as { text: string }).text;
    const editedAt = new Date();

    // Ownership is part of the filter, so the permission check and the write
    // are one operation and cannot be raced apart.
    const updated = await Recipe.findOneAndUpdate(
      { _id: id, comments: { $elemMatch: { _id: commentId, authorId: user.uid } } },
      { $set: { 'comments.$.text': text, 'comments.$.editedAt': editedAt } },
      { new: true, projection: { comments: { $elemMatch: { _id: commentId } } } },
    ).lean();

    if (!updated) {
      const recipe = await Recipe.findOne({ _id: id }, { 'comments.$': 1 })
        .where('comments._id')
        .equals(commentId)
        .lean();
      if (!recipe) throw notFound('Comment not found');
      // The comment exists but is not this caller's. Only its author may
      // rewrite the text — a recipe owner can remove a comment but must not be
      // able to put words in someone's mouth.
      throw forbidden('You can only edit your own comments');
    }

    res.json(publicComment(updated.comments[0] as unknown as Record<string, unknown>));
  }),
);

router.delete(
  '/:id/comments/:commentId',
  interactionLimiter,
  requireAuth,
  validate({ params: commentIdParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id, commentId } = req.params as { id: string; commentId: string };

    const recipe = await Recipe.findOne(
      { _id: id, 'comments._id': commentId },
      { author: 1, 'comments.$': 1 },
    ).lean();

    if (!recipe) throw notFound('Comment not found');

    const comment = recipe.comments[0];
    // The comment's author, or the owner of the recipe moderating their page.
    const canDelete = comment?.authorId === user.uid || recipe.author === user.uid;
    if (!canDelete) throw forbidden('You cannot delete this comment');

    await Recipe.updateOne({ _id: id }, [
      {
        $set: {
          comments: {
            $filter: {
              input: { $ifNull: ['$comments', []] },
              as: 'comment',
              cond: { $ne: ['$$comment._id', new mongoose.Types.ObjectId(commentId)] },
            },
          },
        },
      },
      { $set: { commentCount: { $size: '$comments' } } },
    ]);

    res.json({ success: true });
  }),
);

// === RATINGS =================================================================

/**
 * Recomputes both counters from the ratings array in the same update that
 * changes it, so they cannot drift apart under concurrency.
 */
const RECALCULATE_RATING = [
  {
    $set: {
      ratingCount: { $size: { $ifNull: ['$ratings', []] } },
      averageRating: {
        $round: [{ $ifNull: [{ $avg: '$ratings.score' }, 0] }, 1],
      },
    },
  },
];

router.put(
  '/:id/rating',
  interactionLimiter,
  requireAuth,
  validate({ params: recipeIdParams, body: ratingBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const { score } = req.body as { score: number };

    const recipe = await Recipe.findById(id).select('author').lean();
    if (!recipe) throw notFound('Recipe not found');
    // Otherwise the default "Highest Rated" sort is trivially gamed by authors.
    if (recipe.author === user.uid) throw forbidden('You cannot rate your own recipe');

    // Replace-or-append and recount in one write. The previous read-modify-write
    // let two concurrent raters leave `ratings.length` at 2 with `ratingCount`
    // at 1 — permanently, since nothing recomputed it until the next rating.
    const updated = await Recipe.findOneAndUpdate(
      { _id: id },
      [
        {
          $set: {
            ratings: {
              $concatArrays: [
                {
                  $filter: {
                    input: { $ifNull: ['$ratings', []] },
                    as: 'rating',
                    cond: { $ne: ['$$rating.userId', user.uid] },
                  },
                },
                [{ userId: user.uid, score }],
              ],
            },
          },
        },
        ...RECALCULATE_RATING,
      ],
      { new: true, projection: { averageRating: 1, ratingCount: 1 } },
    ).lean();

    res.json({
      averageRating: updated?.averageRating ?? 0,
      ratingCount: updated?.ratingCount ?? 0,
      userScore: score,
    });
  }),
);

router.delete(
  '/:id/rating',
  interactionLimiter,
  requireAuth,
  validate({ params: recipeIdParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    const updated = await Recipe.findOneAndUpdate(
      { _id: id },
      [
        {
          $set: {
            ratings: {
              $filter: {
                input: { $ifNull: ['$ratings', []] },
                as: 'rating',
                cond: { $ne: ['$$rating.userId', user.uid] },
              },
            },
          },
        },
        ...RECALCULATE_RATING,
      ],
      { new: true, projection: { averageRating: 1, ratingCount: 1 } },
    ).lean();

    if (!updated) throw notFound('Recipe not found');

    res.json({
      averageRating: updated.averageRating,
      ratingCount: updated.ratingCount,
      userScore: 0,
    });
  }),
);

export default router;
