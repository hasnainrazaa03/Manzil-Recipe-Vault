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
  Comment,
  CurrentUser,
  Paginated,
  ProfileInput,
  RecipeDetail,
  RecipeInput,
  RecipeListParams,
  RecipeSummary,
  SaveResponse,
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
  me: ['users', 'me'] as const,
  profile: (userId: string, page: number) => ['users', userId, 'profile', page] as const,
  saved: (page: number) => ['users', 'me', 'saved', page] as const,
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
