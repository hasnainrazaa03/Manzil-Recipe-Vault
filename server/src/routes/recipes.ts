import { Router } from 'express';
import type { FilterQuery } from 'mongoose';
import { Recipe, RECIPE_LIST_PROJECTION } from '../models/Recipe.js';
import { Profile } from '../models/Profile.js';
import { Comment } from '../models/Comment.js';
import { Collection } from '../models/Collection.js';
import { RecipeVersion, MAX_VERSIONS_PER_RECIPE } from '../models/RecipeVersion.js';
import { optionalAuth, requireAuth, requireUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { interactionLimiter, readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { escapeRegex } from '../lib/sanitize.js';
import { publicRecipe, publicRecipes } from '../lib/serialize.js';
import { paginate, paginationQuery } from '../schemas/common.js';
import {
  commentBody,
  commentIdParams,
  createRecipeBody,
  listRecipesQuery,
  ratingBody,
  recipeIdParams,
  updateRecipeBody,
  versionParams,
  type ListRecipesQuery,
} from '../schemas/recipe.js';

const router = Router();

/**
 * A publishable name derived from whatever identity we have. Takes the local
 * part of an email so an address is never displayed in full.
 */
export function displayNameFrom(value?: string): string {
  const name = value?.split('@')[0]?.trim();
  return name && name.length > 0 ? name : 'Anonymous cook';
}

/**
 * Records the current state of a recipe as a new version.
 *
 * Called before an edit is applied, so version N is what the recipe looked like
 * before edit N — which is the thing a reader wants to restore. History is
 * append-only and capped; a restore writes a new version rather than rewinding,
 * so the restore itself can be undone.
 */
async function saveVersion(
  recipe: { _id: unknown; toObject: () => Record<string, unknown> },
  editedBy: string,
  restoredFrom: number | null = null,
): Promise<void> {
  const doc = recipe.toObject();
  const latest = await RecipeVersion.findOne({ recipe: recipe._id })
    .sort({ version: -1 })
    .select('version')
    .lean();

  const version = (latest?.version ?? 0) + 1;

  await RecipeVersion.create({
    recipe: recipe._id,
    version,
    editedBy,
    restoredFrom,
    snapshot: {
      title: doc.title,
      image: doc.image,
      overview: doc.overview,
      ingredients: doc.ingredients,
      instructions: doc.instructions,
      tags: doc.tags,
      servings: doc.servings ?? null,
      prepMinutes: doc.prepMinutes ?? null,
      cookMinutes: doc.cookMinutes ?? null,
      difficulty: doc.difficulty ?? null,
      cuisine: doc.cuisine ?? '',
    },
  });

  // Keep the history bounded. Unbounded, an actively edited recipe accumulates
  // a snapshot per save forever.
  const excess = await RecipeVersion.find({ recipe: recipe._id })
    .sort({ version: -1 })
    .skip(MAX_VERSIONS_PER_RECIPE)
    .select('_id')
    .lean();

  if (excess.length > 0) {
    await RecipeVersion.deleteMany({ _id: { $in: excess.map((v) => v._id) } });
  }
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
      Object.assign(filter, searchFilter(query.search));
    }
  }

  return filter;
}

/**
 * Substring matching across the fields people actually search by.
 *
 * The term is regex-escaped before it reaches the driver — interpolating it raw
 * let an anonymous caller pin a CPU core with `(a+)+$`.
 */
function searchFilter(search: string): FilterQuery<unknown> {
  const pattern = new RegExp(escapeRegex(search), 'i');
  return {
    $or: [
      { title: pattern },
      { overview: pattern },
      { tags: pattern },
      { 'ingredients.name': pattern },
    ],
  };
}

/**
 * A forgiving second pass for a search that found nothing.
 *
 * The exact-substring match above fails completely on a typo — "chiken" returns
 * an empty page even though the answer is obviously "Chicken Karahi". This
 * builds a pattern that tolerates one wrong, missing or extra character by
 * allowing any single character between each pair of letters, which catches the
 * overwhelming majority of real typos without needing a fuzzy-search engine.
 *
 * Only ever runs when the strict search returned nothing, so it costs nothing
 * on the normal path — and the results are flagged so the UI can say it guessed.
 */
function fuzzyFilter(search: string): FilterQuery<unknown> | null {
  const term = search.trim();
  // Too short to be worth guessing at: "ri" would match almost everything.
  if (term.length < 4) return null;

  const relaxed = term
    .split('')
    .map((character) => escapeRegex(character))
    .join('.?');

  const pattern = new RegExp(relaxed, 'i');
  return { $or: [{ title: pattern }, { tags: pattern }, { 'ingredients.name': pattern }] };
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

    /**
     * Nothing matched, but the reader clearly meant *something*. Retry with a
     * typo-tolerant pattern rather than showing an empty page, and tell the UI
     * so it can say the results are a guess.
     */
    if (total === 0 && query.search && query.sort !== 'relevance') {
      const fuzzy = fuzzyFilter(query.search);

      if (fuzzy) {
        const relaxed = { ...buildFilter({ ...query, search: undefined }, req.user?.uid), ...fuzzy };
        const [fuzzyTotal, fuzzyRecipes] = await Promise.all([
          Recipe.countDocuments(relaxed),
          Recipe.find(relaxed)
            .select(RECIPE_LIST_PROJECTION)
            .sort(buildSort(query))
            .skip(skip)
            .limit(query.limit)
            .lean(),
        ]);

        if (fuzzyTotal > 0) {
          res.json({
            ...paginate(
              publicRecipes(fuzzyRecipes as unknown as Record<string, unknown>[]),
              fuzzyTotal,
              query,
            ),
            approximate: true,
          });
          return;
        }
      }
    }

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

    // The first page of the thread, from the comments collection. Older
    // recipes may still carry an embedded array; it is ignored, and the
    // migration copies it across.
    const [comments, commentCount] = await Promise.all([
      Comment.find({ recipe: recipe._id, parent: null }).sort({ createdAt: -1 }).limit(10).lean(),
      Comment.countDocuments({ recipe: recipe._id }),
    ]);

    const replies = await Comment.find({ parent: { $in: comments.map((c) => c._id) } })
      .sort({ createdAt: 1 })
      .lean();

    const byParent = new Map<string, unknown[]>();
    for (const reply of replies) {
      const key = String(reply.parent);
      byParent.set(key, [...(byParent.get(key) ?? []), reply]);
    }

    const { ratings: _ratings, comments: _embedded, ...rest } = recipe;

    res.json({
      ...publicRecipe(rest as Record<string, unknown>),
      comments: comments.map((c) => ({ ...c, replies: byParent.get(String(c._id)) ?? [] })),
      commentCount,
      viewer: { userScore, isSaved, isAuthor: uid === recipe.author },
    });
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
    // Snapshot what the recipe looked like *before* this edit, so the history
    // shows the state you can go back to.
    await saveVersion(recipe, user.uid);

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
    // their saved-recipe page count with entries that render nothing. The same
    // applies to collections, and to the comments that now live in their own
    // collection rather than inside the recipe.
    await Promise.all([
      Profile.updateMany({ savedRecipes: id }, { $pull: { savedRecipes: id } }),
      Collection.updateMany({ recipes: id }, { $pull: { recipes: id } }),
      Comment.deleteMany({ recipe: id }),
      RecipeVersion.deleteMany({ recipe: id }),
    ]);

    res.json({ success: true });
  }),
);

// === COMMENTS ================================================================

/**
 * Comments live in their own collection.
 *
 * They used to be embedded, which meant every recipe write rewrote the whole
 * array, every detail read loaded all of them, and the 16 MB document ceiling
 * forced a 500-comment cap. `Recipe.commentCount` stays as a denormalised
 * counter because it is what a card renders, and counting per card would be one
 * query per card.
 */

/** Recomputes the counter from the collection, in one round trip. */
async function syncCommentCount(recipeId: string): Promise<number> {
  const total = await Comment.countDocuments({ recipe: recipeId });
  await Recipe.updateOne({ _id: recipeId }, { $set: { commentCount: total } });
  return total;
}

/** GET /api/recipes/:id/comments — top-level comments, newest first, with replies. */
router.get(
  '/:id/comments',
  readLimiter,
  validate({ params: recipeIdParams, query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const query = req.query as unknown as { page: number; limit: number };

    const exists = await Recipe.exists({ _id: id });
    if (!exists) throw notFound('Recipe not found');

    const filter = { recipe: id, parent: null };

    const [total, roots] = await Promise.all([
      Comment.countDocuments(filter),
      Comment.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
    ]);

    // One query for every reply on the page rather than one per comment.
    const replies = await Comment.find({ parent: { $in: roots.map((r) => r._id) } })
      .sort({ createdAt: 1 })
      .lean();

    const byParent = new Map<string, unknown[]>();
    for (const reply of replies) {
      const key = String(reply.parent);
      byParent.set(key, [...(byParent.get(key) ?? []), reply]);
    }

    const items = roots.map((root) => ({
      ...root,
      replies: byParent.get(String(root._id)) ?? [],
    }));

    res.json(paginate(items, total, query));
  }),
);

router.post(
  '/:id/comments',
  interactionLimiter,
  requireAuth,
  validate({ params: recipeIdParams, body: commentBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const { text, parent } = req.body as { text: string; parent?: string };

    const recipe = await Recipe.exists({ _id: id });
    if (!recipe) throw notFound('Recipe not found');

    if (parent) {
      const parentComment = await Comment.findById(parent).select('recipe parent').lean();
      if (!parentComment || String(parentComment.recipe) !== id) {
        throw notFound('The comment you are replying to no longer exists');
      }
      // One level only. Replying to a reply attaches to its parent instead of
      // nesting further — arbitrarily deep threads are a moderation and layout
      // problem long before they are a feature.
      if (parentComment.parent) {
        throw badRequest('Replies cannot be nested more than one level deep');
      }
    }

    const profile = await Profile.findOne({ user: user.uid })
      .select('displayName profilePictureUrl')
      .lean();

    const comment = await Comment.create({
      recipe: id,
      authorId: user.uid,
      authorName: profile?.displayName ?? displayNameFrom(user.name ?? user.email),
      authorPictureUrl: profile?.profilePictureUrl ?? '',
      text,
      parent: parent ?? null,
    });

    await syncCommentCount(id);

    res.status(201).json({ ...comment.toJSON(), replies: [] });
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

    // Ownership in the filter, so the check and the write cannot be raced apart.
    const updated = await Comment.findOneAndUpdate(
      { _id: commentId, recipe: id, authorId: user.uid },
      { $set: { text: (req.body as { text: string }).text, editedAt: new Date() } },
      { new: true },
    ).lean();

    if (!updated) {
      const exists = await Comment.exists({ _id: commentId, recipe: id });
      // Only the author may rewrite the text. A recipe owner can remove a
      // comment but must not be able to put words in someone's mouth.
      throw exists ? forbidden('You can only edit your own comments') : notFound('Comment not found');
    }

    res.json(updated);
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

    const comment = await Comment.findOne({ _id: commentId, recipe: id }).select('authorId').lean();
    if (!comment) throw notFound('Comment not found');

    const recipe = await Recipe.findById(id).select('author').lean();
    const canDelete = comment.authorId === user.uid || recipe?.author === user.uid;
    if (!canDelete) throw forbidden('You cannot delete this comment');

    // Deleting a parent takes its replies with it; leaving them orphaned would
    // strand answers to a question nobody can see.
    await Comment.deleteMany({ $or: [{ _id: commentId }, { parent: commentId }] });

    const commentCount = await syncCommentCount(id);

    res.json({ success: true, commentCount });
  }),
);

// === VERSION HISTORY =========================================================

/** GET /api/recipes/:id/versions — the edit history, newest first. */
router.get(
  '/:id/versions',
  readLimiter,
  requireAuth,
  validate({ params: recipeIdParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    const recipe = await Recipe.findById(id).select('author').lean();
    if (!recipe) throw notFound('Recipe not found');
    // History is the author's working record, not public reading.
    if (recipe.author !== user.uid) throw forbidden('Only the author can see a recipe\'s history');

    const versions = await RecipeVersion.find({ recipe: id })
      .sort({ version: -1 })
      .select('version editedBy restoredFrom createdAt snapshot.title')
      .lean();

    res.json(versions);
  }),
);

/** GET /api/recipes/:id/versions/:version — one full snapshot. */
router.get(
  '/:id/versions/:version',
  readLimiter,
  requireAuth,
  validate({ params: versionParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id, version } = req.params as unknown as { id: string; version: number };

    const recipe = await Recipe.findById(id).select('author').lean();
    if (!recipe) throw notFound('Recipe not found');
    if (recipe.author !== user.uid) throw forbidden('Only the author can see a recipe\'s history');

    const snapshot = await RecipeVersion.findOne({ recipe: id, version }).lean();
    if (!snapshot) throw notFound('That version no longer exists');

    res.json(snapshot);
  }),
);

/**
 * POST /api/recipes/:id/versions/:version/restore
 *
 * Applies an old snapshot as a new edit. The current state is snapshotted
 * first, so restoring is itself undoable — which is what makes it safe to press.
 */
router.post(
  '/:id/versions/:version/restore',
  writeLimiter,
  requireAuth,
  validate({ params: versionParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id, version } = req.params as unknown as { id: string; version: number };

    const recipe = await Recipe.findById(id);
    if (!recipe) throw notFound('Recipe not found');
    if (recipe.author !== user.uid) throw forbidden('You can only restore your own recipes');

    const target = await RecipeVersion.findOne({ recipe: id, version }).lean();
    if (!target?.snapshot) throw notFound('That version no longer exists');

    await saveVersion(recipe, user.uid, version);

    recipe.set(target.snapshot as Record<string, unknown>);
    await recipe.save();

    res.json(publicRecipe(recipe.toJSON()));
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
