import { Router } from 'express';
import { Collection } from '../models/Collection.js';
import { Recipe, RECIPE_LIST_PROJECTION } from '../models/Recipe.js';
import { optionalAuth, requireAuth, requireUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { publicRecipes } from '../lib/serialize.js';
import { paginate, paginationQuery } from '../schemas/common.js';
import {
  collectionIdParams,
  collectionRecipeParams,
  createCollectionBody,
  listCollectionsQuery,
  updateCollectionBody,
} from '../schemas/collection.js';
import { LIMITS } from '../models/constants.js';

const router = Router();

/** Strips nothing sensitive today, but centralises the shape as it grows. */
function publicCollection(collection: Record<string, unknown>) {
  const { recipes, ...rest } = collection;
  return {
    ...rest,
    recipeCount: rest.recipeCount ?? (Array.isArray(recipes) ? recipes.length : 0),
    description: rest.description ?? '',
    isPublic: rest.isPublic ?? false,
  };
}

/**
 * GET /api/collections?owner=me|<uid>
 *
 * Your own collections include private ones; anyone else's are filtered to
 * public. The ownership check lives in the query rather than in a post-filter,
 * so a private collection cannot leak through a pagination edge.
 */
router.get(
  '/',
  optionalAuth,
  readLimiter,
  validate({ query: listCollectionsQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as { owner: string; page: number; limit: number };
    const viewer = req.user?.uid;

    const isOwnRequest = query.owner === 'me';
    if (isOwnRequest && !viewer) {
      throw unauthorized(
        req.authExpired ? 'Your session has expired. Please sign in again.' : 'Sign in to see your collections',
      );
    }

    const owner = isOwnRequest ? viewer! : query.owner;
    const filter = owner === viewer ? { owner } : { owner, isPublic: true };

    const [total, collections] = await Promise.all([
      Collection.countDocuments(filter),
      Collection.find(filter)
        .sort({ updatedAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
    ]);

    res.json(
      paginate(
        collections.map((c) => publicCollection(c as unknown as Record<string, unknown>)),
        total,
        query,
      ),
    );
  }),
);

/** GET /api/collections/:id — the collection plus a page of its recipes. */
router.get(
  '/:id',
  optionalAuth,
  readLimiter,
  validate({ params: collectionIdParams, query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const query = req.query as unknown as { page: number; limit: number };

    const collection = await Collection.findById(id).lean();
    if (!collection) throw notFound('Collection not found');

    const isOwner = req.user?.uid === collection.owner;
    if (!collection.isPublic && !isOwner) {
      // 404 rather than 403: revealing that a private collection exists at this
      // id is itself a small leak.
      throw notFound('Collection not found');
    }

    // Recipes are ordered as the owner added them, most recent first.
    const ids = [...collection.recipes].reverse();
    const pageIds = ids.slice((query.page - 1) * query.limit, query.page * query.limit);

    const recipes = await Recipe.find({ _id: { $in: pageIds } })
      .select(RECIPE_LIST_PROJECTION)
      .lean();

    // `$in` does not preserve order, so restore the owner's ordering.
    const byId = new Map(recipes.map((r) => [String(r._id), r]));
    const ordered = pageIds.map((rid) => byId.get(String(rid))).filter(Boolean);

    res.json({
      collection: { ...publicCollection(collection as unknown as Record<string, unknown>), isOwner },
      // Counted from the recipes that still exist, so a deleted one does not
      // create a phantom trailing page.
      recipes: paginate(
        publicRecipes(ordered as unknown as Record<string, unknown>[]),
        await Recipe.countDocuments({ _id: { $in: collection.recipes } }),
        query,
      ),
    });
  }),
);

router.post(
  '/',
  writeLimiter,
  requireAuth,
  validate({ body: createCollectionBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);

    const existing = await Collection.countDocuments({ owner: user.uid });
    if (existing >= LIMITS.collectionsPerUser) {
      throw conflict(`You can have at most ${LIMITS.collectionsPerUser} collections.`);
    }

    const collection = await Collection.create({ ...req.body, owner: user.uid });

    res.status(201).json(publicCollection(collection.toJSON()));
  }),
);

router.patch(
  '/:id',
  writeLimiter,
  requireAuth,
  validate({ params: collectionIdParams, body: updateCollectionBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    // Ownership is in the filter, so the check and the write are one operation.
    const updated = await Collection.findOneAndUpdate(
      { _id: id, owner: user.uid },
      { $set: req.body },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) {
      const exists = await Collection.exists({ _id: id });
      throw exists ? forbidden('You can only edit your own collections') : notFound('Collection not found');
    }

    res.json(publicCollection(updated as unknown as Record<string, unknown>));
  }),
);

router.delete(
  '/:id',
  writeLimiter,
  requireAuth,
  validate({ params: collectionIdParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    const deleted = await Collection.findOneAndDelete({ _id: id, owner: user.uid }).lean();
    if (!deleted) {
      const exists = await Collection.exists({ _id: id });
      throw exists ? forbidden('You can only delete your own collections') : notFound('Collection not found');
    }

    // Deleting a collection never deletes recipes — it is a grouping, not
    // ownership.
    res.json({ success: true });
  }),
);

/**
 * PUT /api/collections/:id/recipes/:recipeId — idempotent toggle.
 *
 * Atomic `$addToSet` / `$pull` with the count recomputed in the same update, so
 * two rapid taps cannot duplicate an entry or leave the count wrong.
 */
router.put(
  '/:id/recipes/:recipeId',
  writeLimiter,
  requireAuth,
  validate({ params: collectionRecipeParams }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { id, recipeId } = req.params as { id: string; recipeId: string };

    const collection = await Collection.findOne({ _id: id, owner: user.uid }).select('recipes').lean();
    if (!collection) {
      const exists = await Collection.exists({ _id: id });
      throw exists ? forbidden('You can only change your own collections') : notFound('Collection not found');
    }

    const present = collection.recipes.some((r) => String(r) === recipeId);

    if (!present) {
      if (collection.recipes.length >= LIMITS.recipesPerCollection) {
        throw conflict(`A collection can hold at most ${LIMITS.recipesPerCollection} recipes.`);
      }
      const recipeExists = await Recipe.exists({ _id: recipeId });
      if (!recipeExists) throw notFound('Recipe not found');
    }

    const updated = await Collection.findOneAndUpdate(
      { _id: id, owner: user.uid },
      [
        {
          $set: {
            recipes: present
              ? {
                  $filter: {
                    input: '$recipes',
                    as: 'r',
                    cond: { $ne: ['$$r', { $toObjectId: recipeId }] },
                  },
                }
              : { $concatArrays: ['$recipes', [{ $toObjectId: recipeId }]] },
          },
        },
        { $set: { recipeCount: { $size: '$recipes' } } },
      ],
      { new: true, projection: { recipeCount: 1, recipes: 1 } },
    ).lean();

    res.json({
      added: !present,
      recipeCount: updated?.recipeCount ?? 0,
      recipeIds: (updated?.recipes ?? []).map(String),
    });
  }),
);

/**
 * GET /api/collections/containing/:recipeId
 *
 * Which of the caller's collections hold this recipe — drives the checkbox list
 * in the "add to collection" menu without fetching every collection's contents.
 */
router.get(
  '/containing/:recipeId',
  readLimiter,
  requireAuth,
  validate({ params: collectionRecipeParams.pick({ recipeId: true }) }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { recipeId } = req.params as { recipeId: string };

    const collections = await Collection.find({ owner: user.uid })
      .select('name recipes recipeCount isPublic')
      .sort({ updatedAt: -1 })
      .lean();

    res.json(
      collections.map((c) => ({
        _id: String(c._id),
        name: c.name,
        recipeCount: c.recipeCount,
        isPublic: c.isPublic,
        containsRecipe: c.recipes.some((r) => String(r) === recipeId),
      })),
    );
  }),
);

export default router;
