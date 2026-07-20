import { Router } from 'express';
import type { FilterQuery } from 'mongoose';
import { Recipe, RECIPE_LIST_PROJECTION } from '../models/Recipe.js';
import { Profile } from '../models/Profile.js';
import { optionalAuth, requireAuth, requireUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { interactionLimiter, readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, forbidden, notFound } from '../lib/errors.js';
import { escapeRegex } from '../lib/sanitize.js';
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
 * Strips author email addresses out of anything sent to a client.
 *
 * `authorEmail` is `select: false` on the recipe, but a freshly created or
 * saved document still carries it in memory, and comment subdocuments store
 * their own copy. Serialising through here is what guarantees no response path
 * leaks one.
 */
function publicComment(comment: Record<string, unknown>) {
  const { authorEmail: _authorEmail, ...rest } = comment;
  return rest;
}

function publicRecipe(recipe: Record<string, unknown>) {
  const { authorEmail: _authorEmail, comments, ...rest } = recipe;
  return {
    ...rest,
    ...(Array.isArray(comments)
      ? { comments: comments.map((comment) => publicComment(comment as Record<string, unknown>)) }
      : {}),
  };
}

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
  readLimiter,
  optionalAuth,
  validate({ query: listRecipesQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListRecipesQuery;
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

    res.json(paginate(recipes, total, query));
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

/**
 * GET /api/recipes/:id
 * The endpoint that makes recipes linkable. Returns the recipe plus, for a
 * signed-in caller, their own rating and whether they saved it — details that
 * previously cost two extra round-trips.
 */
router.get(
  '/:id',
  readLimiter,
  optionalAuth,
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
  requireAuth,
  writeLimiter,
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
  requireAuth,
  writeLimiter,
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
  requireAuth,
  writeLimiter,
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

router.post(
  '/:id/comments',
  requireAuth,
  interactionLimiter,
  validate({ params: recipeIdParams, body: commentBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    const recipe = await Recipe.findById(id);
    if (!recipe) throw notFound('Recipe not found');

    const profile = await Profile.findOne({ user: user.uid }).select('displayName profilePictureUrl').lean();

    recipe.comments.push({
      text: (req.body as { text: string }).text,
      authorId: user.uid,
      authorEmail: user.email ?? '',
      // Never the raw email. Falling back to `user.email` here published the
      // full address of any commenter without a saved profile — which is every
      // new account — and, since the comment also carries `authorId`, reopened
      // the uid → email walk that stripping `authorEmail` was meant to close.
      authorDisplayName: profile?.displayName ?? displayNameFrom(user.name ?? user.email),
      authorProfilePictureUrl: profile?.profilePictureUrl ?? '',
      editedAt: null,
    });
    recipe.commentCount = recipe.comments.length;
    await recipe.save();

    const created = recipe.comments[recipe.comments.length - 1]!;
    res.status(201).json(publicComment(created.toJSON()));
  }),
);

router.patch(
  '/:id/comments/:commentId',
  requireAuth,
  interactionLimiter,
  validate({ params: commentIdParams, body: commentBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id, commentId } = req.params as { id: string; commentId: string };

    const recipe = await Recipe.findById(id);
    if (!recipe) throw notFound('Recipe not found');

    const comment = recipe.comments.id(commentId);
    if (!comment) throw notFound('Comment not found');
    // Only the comment's author may rewrite its text. The recipe owner can
    // remove a comment but must not be able to put words in someone's mouth.
    if (comment.authorId !== user.uid) throw forbidden('You can only edit your own comments');

    comment.text = (req.body as { text: string }).text;
    comment.editedAt = new Date();
    await recipe.save();

    res.json(publicComment(comment.toJSON()));
  }),
);

router.delete(
  '/:id/comments/:commentId',
  requireAuth,
  interactionLimiter,
  validate({ params: commentIdParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id, commentId } = req.params as { id: string; commentId: string };

    const recipe = await Recipe.findById(id);
    if (!recipe) throw notFound('Recipe not found');

    const comment = recipe.comments.id(commentId);
    if (!comment) throw notFound('Comment not found');

    // Comment author, or the owner of the recipe moderating their own page.
    const canDelete = comment.authorId === user.uid || recipe.author === user.uid;
    if (!canDelete) throw forbidden('You cannot delete this comment');

    comment.deleteOne();
    recipe.commentCount = recipe.comments.length;
    await recipe.save();

    res.json({ success: true });
  }),
);

// === RATINGS =================================================================

router.put(
  '/:id/rating',
  requireAuth,
  interactionLimiter,
  validate({ params: recipeIdParams, body: ratingBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const { score } = req.body as { score: number };

    const recipe = await Recipe.findById(id);
    if (!recipe) throw notFound('Recipe not found');
    // Otherwise the default "Highest Rated" sort is trivially gamed by authors.
    if (recipe.author === user.uid) throw forbidden('You cannot rate your own recipe');

    const existing = recipe.ratings.find((rating) => rating.userId === user.uid);
    if (existing) {
      existing.score = score;
    } else {
      recipe.ratings.push({ userId: user.uid, score });
    }

    recalculateRating(recipe);
    await recipe.save();

    res.json({
      averageRating: recipe.averageRating,
      ratingCount: recipe.ratingCount,
      userScore: score,
    });
  }),
);

router.delete(
  '/:id/rating',
  requireAuth,
  interactionLimiter,
  validate({ params: recipeIdParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    const recipe = await Recipe.findById(id);
    if (!recipe) throw notFound('Recipe not found');

    // `pull({ userId })` looks right but is a no-op: the rating subdocument is
    // declared `{ _id: false }`, so Mongoose matches by deep equality of the
    // whole element and a partial object never matches. The array was left
    // untouched in memory, `recalculateRating` re-wrote the pre-delete counters,
    // and `save()` still emitted a `$pull` that Mongo honoured — leaving the
    // stored document with an empty array and non-zero counts.
    const existing = recipe.ratings.find((rating) => rating.userId === user.uid);
    if (existing) recipe.ratings.pull(existing);

    recalculateRating(recipe);
    await recipe.save();

    res.json({
      averageRating: recipe.averageRating,
      ratingCount: recipe.ratingCount,
      userScore: 0,
    });
  }),
);

function recalculateRating(recipe: { ratings: { score: number }[]; ratingCount: number; averageRating: number }) {
  const total = recipe.ratings.reduce((sum, rating) => sum + rating.score, 0);
  recipe.ratingCount = recipe.ratings.length;
  recipe.averageRating =
    recipe.ratingCount > 0 ? Math.round((total / recipe.ratingCount) * 10) / 10 : 0;
}

export default router;
