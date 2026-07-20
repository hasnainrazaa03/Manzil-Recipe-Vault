/**
 * The API contract, mirrored from the server's Zod schemas and Mongoose models.
 * Keeping these in one file means a change to the server surface breaks the
 * build here rather than silently producing `undefined` at runtime.
 */

export interface Ingredient {
  amount: string;
  name: string;
}

export interface Comment {
  _id: string;
  text: string;
  authorId: string;
  /** Author email is never sent to clients — see the server's `publicComment`. */
  authorDisplayName: string;
  authorProfilePictureUrl: string;
  createdAt: string;
  editedAt: string | null;
}

/** What list endpoints return — no `comments` or `ratings` arrays. */
export interface RecipeSummary {
  _id: string;
  title: string;
  image: string;
  overview: string;
  author: string;
  /** Denormalised display name. Email addresses are never exposed publicly. */
  authorName: string;
  tags: string[];
  averageRating: number;
  ratingCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;

  /** Cooking metadata. `null` means the author did not state it. */
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  /** Derived server-side from prep + cook; never sent by a client. */
  totalMinutes: number | null;
  difficulty: Difficulty | null;
  cuisine: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface CuisineCount {
  cuisine: string;
  count: number;
}

export interface RecipeDetail extends RecipeSummary {
  ingredients: Ingredient[];
  instructions: string;
  comments: Comment[];
  viewer: {
    userScore: number;
    isSaved: boolean;
    isAuthor: boolean;
  };
}

export interface RecipeInput {
  title: string;
  image: string;
  overview: string;
  ingredients: Ingredient[];
  instructions: string;
  tags: string[];
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: Difficulty | null;
  cuisine: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export type SortOption = 'newest' | 'oldest' | 'rating' | 'popular' | 'relevance' | 'quickest';

export interface RecipeListParams {
  page?: number;
  limit?: number;
  search?: string;
  tag?: string[];
  tagMode?: 'any' | 'all';
  sort?: SortOption;
  author?: string;
  difficulty?: Difficulty;
  cuisine?: string;
  maxMinutes?: number;
}

export interface CurrentUser {
  uid: string;
  email: string;
  displayName: string;
  bio: string;
  profilePictureUrl: string;
  savedRecipeIds: string[];
}

export interface PublicProfile {
  uid: string;
  displayName: string;
  bio: string;
  profilePictureUrl: string;
  recipeCount: number;
  isOwner: boolean;
}

export interface ProfileResponse {
  user: PublicProfile;
  recipes: Paginated<RecipeSummary>;
}

export interface ProfileInput {
  displayName: string;
  bio: string;
  profilePictureUrl: string;
}

export interface RatingResponse {
  averageRating: number;
  ratingCount: number;
  userScore: number;
}

export interface SaveResponse {
  saved: boolean;
  savedRecipeIds: string[];
}

export interface UploadSignature {
  signature: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  transformation: string;
  apiKey: string;
  cloudName: string;
  uploadUrl: string;
}
