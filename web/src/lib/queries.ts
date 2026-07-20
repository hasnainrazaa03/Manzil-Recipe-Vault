import { useCallback, useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from '../context/AuthContext';
import type {
  CollectionInput,
  MealPlanEntryInput,
  MealPlanWeek,
  Comment,
  CurrentUser,
  Relationship,
  Paginated,
  ProfileInput,
  RecipeDetail,
  RecipeInput,
  RecipeListParams,
  RecipeSummary,
  SaveResponse,
  TidyInput,
} from '../types';

/**
 * Query keys, centralised so invalidation is precise instead of the previous
 * `refetchTrigger` counter that re-fetched everything on any change.
 */
export const keys = {
  recipes: ['recipes'] as const,
  recipeList: (params: RecipeListParams) => ['recipes', 'list', params] as const,
  recipe: (id: string) => ['recipes', 'detail', id] as const,
  comments: (id: string, page: number) => ['recipes', id, 'comments', page] as const,
  tags: ['tags'] as const,
  cuisines: ['cuisines'] as const,
  related: (id: string) => ['recipes', 'related', id] as const,
  me: ['users', 'me'] as const,
  profile: (userId: string, page: number) => ['users', userId, 'profile', page] as const,
  saved: (page: number) => ['users', 'me', 'saved', page] as const,

  collections: (owner: string, page: number) => ['collections', owner, page] as const,
  collection: (id: string, page: number) => ['collections', 'detail', id, page] as const,
  collectionsContaining: (recipeId: string) => ['collections', 'containing', recipeId] as const,

  feed: (page: number) => ['social', 'feed', page] as const,
  relationship: (userId: string) => ['social', 'relationship', userId] as const,
  followers: (userId: string, page: number) => ['social', userId, 'followers', page] as const,
  followingList: (userId: string, page: number) => ['social', userId, 'following', page] as const,
  suggestions: ['social', 'suggestions'] as const,

  versions: (recipeId: string) => ['recipes', recipeId, 'versions'] as const,
  serverShoppingList: ['shopping-list'] as const,
  mealPlan: (week: string) => ['meal-plan', week] as const,
  aiStatus: ['ai', 'status'] as const,
};

// === Queries =================================================================

export function useRecipes(params: RecipeListParams) {
  return useQuery({
    queryKey: keys.recipeList(params),
    queryFn: ({ signal }) => api.recipes.list(params, signal),
    // Keeps the previous page on screen while the next loads, instead of
    // flashing an empty grid on every pagination click.
    placeholderData: (previous) => previous,
  });
}

export function useRecipe(id: string | undefined, options?: Partial<UseQueryOptions<RecipeDetail>>) {
  return useQuery({
    queryKey: keys.recipe(id ?? ''),
    queryFn: ({ signal }) => api.recipes.get(id!, signal),
    enabled: Boolean(id),
    ...options,
  });
}

export function useTags() {
  return useQuery({
    queryKey: keys.tags,
    queryFn: ({ signal }) => api.recipes.tags(signal),
    // Tags change rarely; refetching them on every navigation is waste.
    staleTime: 5 * 60 * 1000,
  });
}

export function useCuisines() {
  return useQuery({
    queryKey: keys.cuisines,
    queryFn: ({ signal }) => api.recipes.cuisines(signal),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRelatedRecipes(id: string | undefined) {
  return useQuery({
    queryKey: keys.related(id ?? ''),
    queryFn: ({ signal }) => api.recipes.related(id!, signal),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCurrentUser() {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.me,
    queryFn: ({ signal }) => api.users.me(signal),
    enabled: Boolean(user),
    staleTime: 60 * 1000,
  });
}

/**
 * The set of saved recipe ids, for the star toggle on every card. Memoised on
 * the id list so consumers get a stable reference between renders.
 */
export function useSavedIds(): Set<string> {
  const { data } = useCurrentUser();
  const ids = data?.savedRecipeIds;
  return useMemo(() => new Set(ids ?? []), [ids]);
}

export function useProfile(userId: string | undefined, page: number) {
  return useQuery({
    queryKey: keys.profile(userId ?? '', page),
    queryFn: ({ signal }) => api.users.profile(userId!, page, signal),
    enabled: Boolean(userId),
    placeholderData: (previous) => previous,
  });
}

export function useSavedRecipes(page: number) {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.saved(page),
    queryFn: ({ signal }) => api.users.savedRecipes(page, signal),
    enabled: Boolean(user),
    placeholderData: (previous) => previous,
  });
}

export function useComments(recipeId: string, page: number, enabled = true) {
  return useQuery({
    queryKey: keys.comments(recipeId, page),
    queryFn: () => api.recipes.comments(recipeId, page),
    enabled: enabled && Boolean(recipeId),
    placeholderData: (previous) => previous,
  });
}

// === Mutations ===============================================================

export function useCreateRecipe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RecipeInput) => api.recipes.create(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.recipes });
      void client.invalidateQueries({ queryKey: keys.tags });
    },
  });
}

export function useUpdateRecipe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<RecipeInput> }) =>
      api.recipes.update(id, input),
    onSuccess: (updated) => {
      client.setQueryData(keys.recipe(updated._id), updated);
      void client.invalidateQueries({ queryKey: keys.recipes });
      void client.invalidateQueries({ queryKey: keys.tags });
    },
  });
}

export function useDeleteRecipe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.recipes.remove(id),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: keys.recipe(id) });
      void client.invalidateQueries({ queryKey: keys.recipes });
      // A deleted recipe leaves everyone's saved list, so that view is stale too.
      void client.invalidateQueries({ queryKey: keys.me });
      void client.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

/**
 * Optimistic save toggle: the star flips instantly and rolls back if the
 * request fails. Also invalidates the saved-recipes list, which previously went
 * stale — un-saving from that page left the card on screen.
 */
export function useToggleSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (recipeId: string) => api.users.toggleSave(recipeId),
    onMutate: async (recipeId) => {
      await client.cancelQueries({ queryKey: keys.me });
      const previous = client.getQueryData<CurrentUser>(keys.me);

      if (previous) {
        const savedRecipeIds = previous.savedRecipeIds.includes(recipeId)
          ? previous.savedRecipeIds.filter((id) => id !== recipeId)
          : [...previous.savedRecipeIds, recipeId];
        client.setQueryData<CurrentUser>(keys.me, { ...previous, savedRecipeIds });
      }

      return { previous };
    },
    onError: (_error, _recipeId, context) => {
      if (context?.previous) client.setQueryData(keys.me, context.previous);
    },
    onSuccess: (result: SaveResponse) => {
      client.setQueryData<CurrentUser>(keys.me, (current) =>
        current ? { ...current, savedRecipeIds: result.savedRecipeIds } : current,
      );
    },
    onSettled: () => {
      // `keys.me` holds the id list every star on the page reads. Without
      // invalidating it, two quick toggles whose responses land out of order
      // leave the cache holding the older list — and nothing ever refetches it,
      // so a star stays wrong until a full reload.
      void client.invalidateQueries({ queryKey: keys.me });
      void client.invalidateQueries({ queryKey: ['users', 'me', 'saved'] });
    },
  });
}

export function useRateRecipe(recipeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (score: number) => api.recipes.rate(recipeId, score),
    onSuccess: (result) => {
      client.setQueryData<RecipeDetail>(keys.recipe(recipeId), (current) =>
        current
          ? {
              ...current,
              averageRating: result.averageRating,
              ratingCount: result.ratingCount,
              viewer: { ...current.viewer, userScore: result.userScore },
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: ['recipes', 'list'] });
    },
  });
}

export function useAddComment(recipeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.recipes.addComment(recipeId, text),
    onSuccess: (comment: Comment) => {
      client.setQueryData<RecipeDetail>(keys.recipe(recipeId), (current) =>
        current
          ? {
              ...current,
              comments: [comment, ...current.comments],
              commentCount: current.commentCount + 1,
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: ['recipes', recipeId, 'comments'] });
    },
  });
}

export function useEditComment(recipeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, text }: { commentId: string; text: string }) =>
      api.recipes.editComment(recipeId, commentId, text),
    onSuccess: (updated) => {
      client.setQueryData<RecipeDetail>(keys.recipe(recipeId), (current) =>
        current
          ? {
              ...current,
              comments: current.comments.map((c) => (c._id === updated._id ? updated : c)),
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: ['recipes', recipeId, 'comments'] });
    },
  });
}

export function useDeleteComment(recipeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => api.recipes.deleteComment(recipeId, commentId),
    onSuccess: (_result, commentId) => {
      client.setQueryData<RecipeDetail>(keys.recipe(recipeId), (current) =>
        current
          ? {
              ...current,
              comments: current.comments.filter((c) => c._id !== commentId),
              commentCount: Math.max(0, current.commentCount - 1),
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: ['recipes', recipeId, 'comments'] });
    },
  });
}

/**
 * Fetches the full recipe on demand. List views only carry the summary
 * projection, so opening the editor from a card needs the ingredients and
 * instructions that the list deliberately leaves out.
 */
export function useFetchRecipeDetail() {
  const client = useQueryClient();
  return useCallback(
    async (id: string): Promise<RecipeDetail | null> => {
      try {
        return await client.fetchQuery({
          queryKey: keys.recipe(id),
          queryFn: () => api.recipes.get(id),
        });
      } catch {
        return null;
      }
    },
    [client],
  );
}

export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) => api.users.updateMe(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.me });
      void client.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export type { Paginated, RecipeSummary };


// === Wave 5 ==================================================================

export function useCollections(owner = 'me', page = 1) {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.collections(owner, page),
    queryFn: ({ signal }) => api.collections.list(owner, page, signal),
    // Your own collections need an identity; someone else's are public.
    enabled: owner !== 'me' || Boolean(user),
    placeholderData: (previous) => previous,
  });
}

export function useCollection(id: string | undefined, page = 1) {
  return useQuery({
    queryKey: keys.collection(id ?? '', page),
    queryFn: ({ signal }) => api.collections.get(id!, page, signal),
    enabled: Boolean(id),
    placeholderData: (previous) => previous,
  });
}

/** Which of the caller's collections already hold this recipe. */
export function useCollectionsContaining(recipeId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.collectionsContaining(recipeId ?? ''),
    queryFn: ({ signal }) => api.collections.containing(recipeId!, signal),
    enabled: Boolean(recipeId && user),
  });
}

export function useCreateCollection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CollectionInput) => api.collections.create(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useUpdateCollection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CollectionInput> }) =>
      api.collections.update(id, input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useDeleteCollection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.collections.remove(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useToggleRecipeInCollection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, recipeId }: { collectionId: string; recipeId: string }) =>
      api.collections.toggleRecipe(collectionId, recipeId),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useFeed(page = 1) {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.feed(page),
    queryFn: ({ signal }) => api.social.feed(page, signal),
    enabled: Boolean(user),
    placeholderData: (previous) => previous,
  });
}

export function useRelationship(userId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.relationship(userId ?? ''),
    queryFn: ({ signal }) => api.social.relationship(userId!, signal),
    enabled: Boolean(userId && user),
  });
}

export function useFollowers(userId: string | undefined, page = 1) {
  return useQuery({
    queryKey: keys.followers(userId ?? '', page),
    queryFn: ({ signal }) => api.social.followers(userId!, page, signal),
    enabled: Boolean(userId),
  });
}

export function useFollowing(userId: string | undefined, page = 1) {
  return useQuery({
    queryKey: keys.followingList(userId ?? '', page),
    queryFn: ({ signal }) => api.social.following(userId!, page, signal),
    enabled: Boolean(userId),
  });
}

export function useFollowSuggestions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.suggestions,
    queryFn: ({ signal }) => api.social.suggestions(signal),
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Optimistic follow toggle. The button flips immediately and rolls back on
 * failure — the request is fast, but the button is the only feedback there is.
 */
export function useToggleFollow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.social.toggleFollow(userId),
    onMutate: async (userId) => {
      await client.cancelQueries({ queryKey: keys.relationship(userId) });
      const previous = client.getQueryData<Relationship>(keys.relationship(userId));

      if (previous) {
        client.setQueryData<Relationship>(keys.relationship(userId), {
          ...previous,
          following: !previous.following,
        });
      }
      return { previous };
    },
    onError: (_error, userId, context) => {
      if (context?.previous) client.setQueryData(keys.relationship(userId), context.previous);
    },
    onSettled: (_data, _error, userId) => {
      void client.invalidateQueries({ queryKey: keys.relationship(userId) });
      void client.invalidateQueries({ queryKey: ['social', 'feed'] });
      void client.invalidateQueries({ queryKey: keys.suggestions });
      void client.invalidateQueries({ queryKey: ['users', userId] });
    },
  });
}

export function useRecipeVersions(recipeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.versions(recipeId ?? ''),
    queryFn: () => api.recipes.versions(recipeId!),
    enabled: enabled && Boolean(recipeId),
  });
}

export function useRestoreVersion(recipeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => api.recipes.restoreVersion(recipeId, version),
    onSuccess: (restored) => {
      client.setQueryData(keys.recipe(recipeId), restored);
      void client.invalidateQueries({ queryKey: keys.versions(recipeId) });
      void client.invalidateQueries({ queryKey: keys.recipes });
    },
  });
}


// === Meal planner ============================================================

export function useMealPlan(week: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.mealPlan(week),
    queryFn: ({ signal }) => api.mealPlan.week(week, signal),
    enabled: Boolean(user),
    placeholderData: (previous) => previous,
  });
}

/**
 * Every meal-plan mutation returns the whole week, so the response is written
 * straight into the cache rather than triggering a refetch. The week is small
 * and the server already assembled it.
 */
function useMealPlanMutation<T>(week: string, fn: (input: T) => Promise<MealPlanWeek>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (updated) => {
      client.setQueryData(keys.mealPlan(updated.weekStart), updated);
      if (updated.weekStart !== week) {
        void client.invalidateQueries({ queryKey: keys.mealPlan(week) });
      }
    },
  });
}

export function useAddMealPlanEntry(week: string) {
  return useMealPlanMutation<MealPlanEntryInput>(week, (entry) => api.mealPlan.addEntry(entry));
}

export function useUpdateMealPlanEntry(week: string) {
  return useMealPlanMutation<{ entryId: string; servings: number | null }>(week, ({ entryId, servings }) =>
    api.mealPlan.updateEntry(entryId, servings),
  );
}

export function useRemoveMealPlanEntry(week: string) {
  return useMealPlanMutation<string>(week, (entryId) => api.mealPlan.removeEntry(entryId));
}

export function useMealPlanToShoppingList(week: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.mealPlan.toShoppingList(week),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.serverShoppingList }),
  });
}

/**
 * Whether the writing assistant is configured at all.
 *
 * Asked once and cached for the session: the answer is a deployment fact, not
 * a per-user one, and it gates whether a button exists. Retries are off because
 * a failure here should quietly mean "no assistant" rather than flashing an
 * error about a feature the reader never asked for.
 */
export function useAiAvailable() {
  const { data } = useQuery({
    queryKey: keys.aiStatus,
    queryFn: ({ signal }) => api.ai.status(signal),
    staleTime: Infinity,
    retry: false,
  });

  return data?.available ?? false;
}

/** Asks the assistant for a tidied version. Saves nothing. */
export function useTidyRecipe() {
  return useMutation({ mutationFn: (input: TidyInput) => api.ai.tidy(input) });
}
