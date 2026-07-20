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
  /** One level only; a reply never has replies of its own. */
  replies?: Comment[];
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
  /** Set when an exact search found nothing and these are a best guess. */
  approximate?: boolean;
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
  followerCount: number;
  followingCount: number;
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


// === Wave 5 ==================================================================

export interface Collection {
  _id: string;
  owner: string;
  name: string;
  description: string;
  isPublic: boolean;
  recipeCount: number;
  createdAt: string;
  updatedAt: string;
  /** Only present on the detail response. */
  isOwner?: boolean;
}

export interface CollectionInput {
  name: string;
  description: string;
  isPublic: boolean;
  recipes?: string[];
}

export interface CollectionDetail {
  collection: Collection;
  recipes: Paginated<RecipeSummary>;
}

/** One row of the "add to collection" menu. */
export interface CollectionMembership {
  _id: string;
  name: string;
  recipeCount: number;
  isPublic: boolean;
  containsRecipe: boolean;
}

export interface PublicUser {
  uid: string;
  displayName: string;
  profilePictureUrl: string;
  bio: string;
  followerCount: number;
}

export interface FollowSuggestion extends PublicUser {
  recipeCount: number;
  averageRating: number;
}

export interface Relationship {
  following: boolean;
  followsYou: boolean;
  isSelf: boolean;
}

export interface Feed extends Paginated<RecipeSummary> {
  /** Distinguishes "nothing new" from "you follow nobody". */
  followsAnyone: boolean;
}

export interface RecipeVersionSummary {
  _id: string;
  version: number;
  editedBy: string;
  restoredFrom: number | null;
  createdAt: string;
  snapshot: { title: string };
}

export interface RecipeVersionDetail extends Omit<RecipeVersionSummary, 'snapshot'> {
  snapshot: RecipeInput;
}

export interface ServerShoppingItem {
  id: string;
  amount: string;
  name: string;
  recipeId: string;
  recipeTitle: string;
  checked: boolean;
  addedAt: number;
}

export interface ServerShoppingList {
  items: ServerShoppingItem[];
  updatedAt: string | null;
}

export interface ImportedRecipe {
  title: string;
  overview: string;
  image: string;
  ingredients: Ingredient[];
  instructions: string;
  tags: string[];
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  cuisine: string;
  /** Kept for attribution — shown to the user before they save. */
  sourceUrl: string;
  sourceName: string;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface MealPlanEntry {
  _id: string;
  /** `YYYY-MM-DD` — a calendar day, never a timestamp. */
  date: string;
  mealType: MealType;
  /** Null means "as the recipe was written". */
  servings: number | null;
  recipe: RecipeSummary;
}

export interface MealPlanWeek {
  weekStart: string;
  /** The seven dates of the week, Monday first. */
  days: string[];
  entries: MealPlanEntry[];
}

export interface MealPlanEntryInput {
  date: string;
  mealType: MealType;
  recipe: string;
  servings?: number | null;
}
