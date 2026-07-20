import type { Comment, Paginated, RecipeDetail, RecipeSummary } from '../types';

export function makeRecipeSummary(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    _id: '507f1f77bcf86cd799439011',
    title: 'Lemon drizzle cake',
    image: '',
    overview: 'A bright, sharp sponge that keeps for days.',
    author: 'user-1',
    authorName: 'Amina',
    tags: ['dessert', 'baking'],
    averageRating: 4.5,
    ratingCount: 8,
    commentCount: 2,
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    servings: 8,
    prepMinutes: 20,
    cookMinutes: 45,
    totalMinutes: 65,
    difficulty: 'easy',
    cuisine: 'British',
    ...overrides,
  };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    _id: '607f1f77bcf86cd799439011',
    text: 'Made this twice already.',
    authorId: 'user-2',
    authorDisplayName: 'Bilal',
    authorProfilePictureUrl: '',
    createdAt: '2026-01-16T10:00:00.000Z',
    editedAt: null,
    ...overrides,
  };
}

export function makeRecipeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    ...makeRecipeSummary(),
    ingredients: [
      { amount: '200 g', name: 'plain flour' },
      { amount: '2', name: 'lemons' },
    ],
    instructions: '<p>Mix everything. Bake.</p>',
    comments: [makeComment()],
    viewer: { userScore: 0, isSaved: false, isAuthor: false },
    ...overrides,
  };
}

export function paginated<T>(items: T[], overrides: Partial<Paginated<T>> = {}): Paginated<T> {
  return {
    items,
    page: 1,
    limit: 6,
    total: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / 6)),
    ...overrides,
  };
}
