/**
 * The single place a database document becomes a response body.
 *
 * Two jobs, both load-bearing:
 *
 * 1. **Strip author email addresses.** `authorEmail` is `select: false` on the
 *    recipe, but a freshly created or saved document still carries it in
 *    memory, and comment subdocuments store their own copy.
 *
 * 2. **Fill in fields that legacy documents predate.** Mongoose defaults are
 *    applied when a document is *hydrated*, and every list query here uses
 *    `.lean()` — which skips hydration entirely. So a recipe written before
 *    `commentCount` or `authorName` existed comes back with those keys simply
 *    absent, and the client receives `undefined` where its types promise a
 *    `number` or a `string`. Normalising here makes the published contract true
 *    for every row regardless of when it was written.
 */

type Doc = Record<string, unknown>;

export function publicComment(comment: Doc): Doc {
  const { authorEmail: _authorEmail, ...rest } = comment;
  return {
    ...rest,
    authorDisplayName: rest.authorDisplayName ?? 'Anonymous cook',
    authorProfilePictureUrl: rest.authorProfilePictureUrl ?? '',
    editedAt: rest.editedAt ?? null,
  };
}

export function publicRecipe(recipe: Doc): Doc {
  const { authorEmail: _authorEmail, comments, ...rest } = recipe;

  const normalised: Doc = {
    ...rest,

    // Denormalised display name. Absent on anything written before it existed;
    // `npm run migrate:author-names` backfills it properly.
    authorName: rest.authorName ?? 'Anonymous cook',

    /**
     * Derived counter. Where the comments are present (the detail endpoint)
     * their length is the truth. List endpoints deliberately project comments
     * away, so there is nothing to count and this falls back to zero — which is
     * a sane value rather than a correct one. Fixing legacy rows properly is
     * what `npm run migrate:author-names` is for; it populates the stored
     * counter from `comments` directly in the database.
     */
    commentCount: Math.max(
      0,
      (rest.commentCount as number | undefined) ??
        (Array.isArray(comments) ? comments.length : 0),
    ),
    ratingCount: rest.ratingCount ?? 0,
    averageRating: rest.averageRating ?? 0,

    // Cooking metadata. `null` is meaningful — it means "the author did not say"
    // — and must be distinguishable from zero.
    servings: rest.servings ?? null,
    prepMinutes: rest.prepMinutes ?? null,
    cookMinutes: rest.cookMinutes ?? null,
    totalMinutes: rest.totalMinutes ?? null,
    difficulty: rest.difficulty ?? null,
    cuisine: rest.cuisine ?? '',

    tags: rest.tags ?? [],
    image: rest.image ?? '',
  };

  if (Array.isArray(comments)) {
    normalised.comments = comments.map((comment) => publicComment(comment as Doc));
  }

  return normalised;
}

/** Convenience for the list endpoints, which all return arrays of lean docs. */
export function publicRecipes(recipes: Doc[]): Doc[] {
  return recipes.map(publicRecipe);
}
