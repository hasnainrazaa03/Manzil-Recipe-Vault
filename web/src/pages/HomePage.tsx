import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';

import { RecipeCard } from '../components/RecipeCard';
import { SearchFilters } from '../components/SearchFilters';
import { FilterChips, type ActiveFilters } from '../components/FilterChips';
import { FeaturedRecipe } from '../components/FeaturedRecipe';
import { RecentlyViewed } from '../components/RecentlyViewed';
import { Pagination } from '../components/Pagination';
import { RecipeGridSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/EmptyState';

import { useAuth } from '../context/AuthContext';
import { useRecipeEditor } from '../context/RecipeEditorContext';
import { useFetchRecipeDetail, useRecipes, useSavedIds, useToggleSave } from '../lib/queries';
import { ApiError } from '../lib/api';
import type { Difficulty, RecipeListParams, RecipeSummary, SortOption } from '../types';

const SORTS: SortOption[] = ['newest', 'oldest', 'rating', 'popular', 'relevance', 'quickest'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export default function HomePage() {
  const { user } = useAuth();
  const { openCreate, openEdit, confirmDelete } = useRecipeEditor();
  const savedIds = useSavedIds();
  const toggleSave = useToggleSave();

  /**
   * Filters live in the URL rather than component state, so a filtered view can
   * be shared, bookmarked, and survives the back button.
   */
  const [searchParams, setSearchParams] = useSearchParams();

  const view = searchParams.get('view') === 'mine' && user ? 'mine' : 'all';
  const search = searchParams.get('q') ?? '';
  const tags = searchParams.getAll('tag');
  const tagMode = searchParams.get('tagMode') === 'all' ? 'all' : 'any';
  const sortParam = searchParams.get('sort') as SortOption | null;
  const sort: SortOption = sortParam && SORTS.includes(sortParam) ? sortParam : 'newest';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const difficultyParam = searchParams.get('difficulty') as Difficulty | null;
  const difficulty = difficultyParam && DIFFICULTIES.includes(difficultyParam) ? difficultyParam : undefined;
  const cuisine = searchParams.get('cuisine') ?? undefined;
  const maxMinutes = Number(searchParams.get('maxMinutes')) || undefined;

  /**
   * Any change other than paging resets to page 1. Otherwise applying a filter
   * while on page 3 of an unfiltered list lands on an empty grid.
   */
  const updateParams = useCallback(
    (changes: Record<string, string | string[] | null>, { keepPage = false } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            next.delete(key);
            if (Array.isArray(value)) value.forEach((item) => next.append(key, item));
            else if (value !== null && value !== '') next.set(key, value);
          }
          if (!keepPage) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const params = useMemo<RecipeListParams>(
    () => ({
      page,
      search: search || undefined,
      tag: tags.length > 0 ? tags : undefined,
      tagMode,
      sort,
      author: view === 'mine' ? 'me' : undefined,
      difficulty,
      cuisine,
      maxMinutes,
    }),
    // `tags` is a fresh array each render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, search, tags.join(','), tagMode, sort, view, difficulty, cuisine, maxMinutes],
  );

  const { data, isPending, isError, error, refetch } = useRecipes(params);
  const fetchRecipeDetail = useFetchRecipeDetail();

  const handleEdit = async (recipe: RecipeSummary) => {
    const full = await fetchRecipeDetail(recipe._id);
    if (full) openEdit(full);
    else toast.error('Could not open that recipe for editing.');
  };

  const activeFilters: ActiveFilters = { search, tags, difficulty, cuisine, maxMinutes };
  const hasFilters =
    search !== '' || tags.length > 0 || Boolean(difficulty || cuisine || maxMinutes);

  const removeFilter = (kind: keyof ActiveFilters, value?: string) => {
    if (kind === 'search') updateParams({ q: null });
    else if (kind === 'tags') updateParams({ tag: tags.filter((tag) => tag !== value) });
    else if (kind === 'difficulty') updateParams({ difficulty: null });
    else if (kind === 'cuisine') updateParams({ cuisine: null });
    else if (kind === 'maxMinutes') updateParams({ maxMinutes: null });
  };

  const clearAllFilters = () =>
    updateParams({ q: null, tag: [], difficulty: null, cuisine: null, maxMinutes: null });

  return (
    <div className="home-page">
      {/* The hero and the history rail are for browsing. Once someone is
          filtering they have a specific intent, and both become noise. */}
      {!hasFilters && view === 'all' && page === 1 && (
        <>
          <FeaturedRecipe />
          <RecentlyViewed />
        </>
      )}

      <nav className="view-toggle" aria-label="Recipe collection">
        <button
          type="button"
          onClick={() => updateParams({ view: null })}
          className={view === 'all' ? 'active' : ''}
          aria-pressed={view === 'all'}
        >
          All recipes
        </button>
        {user && (
          <button
            type="button"
            onClick={() => updateParams({ view: 'mine' })}
            className={view === 'mine' ? 'active' : ''}
            aria-pressed={view === 'mine'}
          >
            My recipes
          </button>
        )}
      </nav>

      <SearchFilters
        search={search}
        onSearchChange={(value) => updateParams({ q: value || null })}
        selectedTags={tags}
        onTagsChange={(value) => updateParams({ tag: value })}
        tagMode={tagMode}
        onTagModeChange={(mode) => updateParams({ tagMode: mode === 'any' ? null : mode })}
        sort={sort}
        onSortChange={(value) => updateParams({ sort: value === 'newest' ? null : value })}
        difficulty={difficulty}
        onDifficultyChange={(value) => updateParams({ difficulty: value ?? null })}
        cuisine={cuisine}
        onCuisineChange={(value) => updateParams({ cuisine: value ?? null })}
        maxMinutes={maxMinutes}
        onMaxMinutesChange={(value) => updateParams({ maxMinutes: value ? String(value) : null })}
        resultCount={data?.total}
      />

      <FilterChips filters={activeFilters} onRemove={removeFilter} onClearAll={clearAllFilters} />

      {isPending ? (
        <RecipeGridSkeleton />
      ) : isError ? (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load recipes.'}
          onRetry={() => void refetch()}
        />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={view === 'mine' ? 'book' : 'folder'}
          title={view === 'mine' ? "You haven't added any recipes yet" : 'No recipes found'}
          message={
            view === 'mine'
              ? 'Your recipes will appear here once you add one.'
              : 'Try a different search or clear your filters.'
          }
          action={
            view === 'mine' ? (
              <button type="button" onClick={openCreate} className="btn-primary">
                Add your first recipe
              </button>
            ) : hasFilters ? (
              <button type="button" onClick={clearAllFilters} className="btn-secondary">
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div id="recipe-grid">
          {data.items.map((recipe) => (
            <RecipeCard
              key={recipe._id}
              recipe={recipe}
              currentUserId={user?.uid}
              isSaved={savedIds.has(recipe._id)}
              onToggleSave={user ? (id) => toggleSave.mutate(id) : undefined}
              onEdit={handleEdit}
              onDelete={(target) => confirmDelete(target)}
              searchTerm={search}
            />
          ))}
        </div>
      )}

      {data && (
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          onChange={(next) => {
            updateParams({ page: String(next) }, { keepPage: true });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
    </div>
  );
}
