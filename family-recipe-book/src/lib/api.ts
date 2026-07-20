import { auth } from '../firebase';
import type {
  Comment,
  CurrentUser,
  Paginated,
  ProfileInput,
  ProfileResponse,
  RatingResponse,
  RecipeDetail,
  RecipeInput,
  RecipeListParams,
  RecipeSummary,
  SaveResponse,
  TagCount,
  UploadSignature,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

/** An error carrying the server's structured `{error:{code,message}}` payload. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Validation failures carry a per-field breakdown worth surfacing. */
  get fieldMessages(): string[] {
    if (!Array.isArray(this.details)) return [];
    return this.details
      .filter((d): d is { path: string; message: string } => typeof d?.message === 'string')
      .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message));
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Attach the current user's ID token. `optional` sends it only if present. */
  auth?: 'required' | 'optional' | 'none';
  signal?: AbortSignal;
}

async function authHeader(mode: RequestOptions['auth']): Promise<Record<string, string>> {
  if (mode === 'none' || mode === undefined) return {};

  const user = auth.currentUser;
  if (!user) {
    if (mode === 'required') {
      throw new ApiError(401, 'unauthenticated', 'You need to be signed in to do that.');
    }
    return {};
  }

  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

/**
 * The single place a network call is made. Every caller gets consistent error
 * handling, so a failed request surfaces as a typed `ApiError` rather than the
 * previous pattern of `data.recipes` silently being `undefined`.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  const headers: Record<string, string> = {
    ...(await authHeader(options.auth)),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? 'error',
      envelope?.message ?? `Request failed with status ${response.status}`,
      envelope?.details,
    );
  }

  return payload as T;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, String(item)));
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const api = {
  recipes: {
    list: (params: RecipeListParams = {}, signal?: AbortSignal) =>
      request<Paginated<RecipeSummary>>(`/api/recipes${toQuery({ ...params })}`, {
        auth: 'optional',
        signal,
      }),

    get: (id: string, signal?: AbortSignal) =>
      request<RecipeDetail>(`/api/recipes/${id}`, { auth: 'optional', signal }),

    tags: (signal?: AbortSignal) => request<TagCount[]>('/api/recipes/tags', { signal }),

    create: (input: RecipeInput) =>
      request<RecipeDetail>('/api/recipes', { method: 'POST', body: input, auth: 'required' }),

    update: (id: string, input: Partial<RecipeInput>) =>
      request<RecipeDetail>(`/api/recipes/${id}`, { method: 'PUT', body: input, auth: 'required' }),

    remove: (id: string) =>
      request<{ success: true }>(`/api/recipes/${id}`, { method: 'DELETE', auth: 'required' }),

    comments: (id: string, page = 1, limit = 10) =>
      request<Paginated<Comment>>(`/api/recipes/${id}/comments${toQuery({ page, limit })}`),

    addComment: (id: string, text: string) =>
      request<Comment>(`/api/recipes/${id}/comments`, {
        method: 'POST',
        body: { text },
        auth: 'required',
      }),

    editComment: (id: string, commentId: string, text: string) =>
      request<Comment>(`/api/recipes/${id}/comments/${commentId}`, {
        method: 'PATCH',
        body: { text },
        auth: 'required',
      }),

    deleteComment: (id: string, commentId: string) =>
      request<{ success: true }>(`/api/recipes/${id}/comments/${commentId}`, {
        method: 'DELETE',
        auth: 'required',
      }),

    rate: (id: string, score: number) =>
      request<RatingResponse>(`/api/recipes/${id}/rating`, {
        method: 'PUT',
        body: { score },
        auth: 'required',
      }),

    clearRating: (id: string) =>
      request<RatingResponse>(`/api/recipes/${id}/rating`, { method: 'DELETE', auth: 'required' }),
  },

  users: {
    me: (signal?: AbortSignal) => request<CurrentUser>('/api/users/me', { auth: 'required', signal }),

    updateMe: (input: ProfileInput) =>
      request<Omit<CurrentUser, 'email' | 'savedRecipeIds'>>('/api/users/me', {
        method: 'PUT',
        body: input,
        auth: 'required',
      }),

    profile: (userId: string, page = 1, signal?: AbortSignal) =>
      request<ProfileResponse>(`/api/users/${userId}/profile${toQuery({ page })}`, {
        auth: 'optional',
        signal,
      }),

    savedRecipes: (page = 1, signal?: AbortSignal) =>
      request<Paginated<RecipeSummary>>(`/api/users/me/saved-recipes${toQuery({ page })}`, {
        auth: 'required',
        signal,
      }),

    toggleSave: (recipeId: string) =>
      request<SaveResponse>(`/api/users/me/saved-recipes/${recipeId}`, {
        method: 'PUT',
        auth: 'required',
      }),
  },

  uploads: {
    signature: (kind: 'recipe' | 'avatar') =>
      request<UploadSignature>('/api/upload/signature', {
        method: 'POST',
        body: { kind },
        auth: 'required',
      }),
  },
};

/**
 * Uploads through a server-issued signature. Every constraint that matters —
 * destination folder, permitted formats, size-capping transformation — is baked
 * into the signature by the server, so this function cannot widen them: altering
 * any signed field invalidates the signature and Cloudinary rejects the upload.
 */
export async function uploadImage(file: File, kind: 'recipe' | 'avatar'): Promise<string> {
  const MAX_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    throw new ApiError(400, 'file_too_large', 'Images must be 10 MB or smaller.');
  }
  if (!file.type.startsWith('image/')) {
    throw new ApiError(400, 'invalid_file_type', 'Only image files can be uploaded.');
  }

  const sig = await api.uploads.signature(kind);

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);
  form.append('allowed_formats', sig.allowedFormats);
  form.append('transformation', sig.transformation);

  const response = await fetch(sig.uploadUrl, { method: 'POST', body: form });
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (data as { error?: { message?: string } } | null)?.error?.message ?? 'Image upload failed.';
    throw new ApiError(response.status, 'upload_failed', message);
  }

  const url = (data as { secure_url?: string } | null)?.secure_url;
  if (!url) throw new ApiError(502, 'upload_failed', 'Upload succeeded but returned no URL.');

  return url;
}
