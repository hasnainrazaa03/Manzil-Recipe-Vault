import { AppError } from './errors.js';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * A minimal client for Gemini's `generateContent`, used only for structured
 * JSON responses.
 *
 * No SDK. The one call this app makes is a POST with a JSON body, and the
 * official client brings a large dependency tree, its own auth layers and its
 * own retry semantics for that. Fetch is enough, and the failure modes stay
 * visible in this file rather than three layers down someone else's stack.
 *
 * Two rules hold everywhere below:
 *
 *   1. **The key never leaves this process.** It is not logged, not echoed in
 *      an error, and not returned to a client. Gemini wants it in a header
 *      rather than the query string, which also keeps it out of any proxy's
 *      access log.
 *   2. **The model's output is never trusted.** `responseSchema` constrains the
 *      shape, but the caller still validates the parsed object against its own
 *      schema. A constrained decode is a strong hint, not a guarantee, and the
 *      values inside a correctly-shaped object are unconstrained anyway.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Aborts a call that will cost more in waiting than the answer is worth. */
const TIMEOUT_MS = 25_000;

/** Bounds the reply, which bounds both the cost and the parse. */
const MAX_OUTPUT_TOKENS = 4_096;

export const geminiConfigured = (): boolean => Boolean(env.GEMINI_API_KEY);

interface GenerateOptions {
  /** The instruction block; sent as `system_instruction`, not as user text. */
  system: string;
  /** The untrusted content being worked on. */
  user: string;
  /** An OpenAPI-subset schema the reply must conform to. */
  schema: Record<string, unknown>;
  signal?: AbortSignal;
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Calls the model and returns the parsed JSON reply.
 *
 * Throws `AppError` for everything a client should be told about, and only
 * messages that are safe to show: an upstream error body can quote the request,
 * and the request contains the user's recipe.
 */
export async function generateJson({ system, user, schema, signal }: GenerateOptions): Promise<unknown> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new AppError(503, 'The writing assistant is not configured', 'ai_unavailable');

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  // Either the caller giving up or the deadline passing should abort the call.
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // Near-deterministic. This is a formatting task with a right answer,
          // not a creative one, and a low temperature also makes the model far
          // less inclined to fill a gap with something plausible.
          temperature: 0.1,
        },
      }),
      signal: combined,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new AppError(504, 'The writing assistant took too long to answer', 'ai_timeout');
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError(499, 'Request cancelled', 'ai_cancelled');
    }
    logger.error({ err: error }, 'Gemini request failed');
    throw new AppError(502, 'Could not reach the writing assistant', 'ai_unreachable');
  }

  if (!response.ok) {
    /**
     * Logged with the status but without the body, and never returned to the
     * client. An upstream error body routinely quotes the offending request,
     * and the request is the user's recipe.
     */
    logger.error({ status: response.status }, 'Gemini returned an error');

    if (response.status === 429) {
      throw new AppError(503, 'The writing assistant is busy. Please try again shortly.', 'ai_busy');
    }
    if (response.status === 400 || response.status === 403) {
      // A rejected key or malformed request is our misconfiguration, not the
      // caller's mistake, so it must not read as though they did something wrong.
      throw new AppError(503, 'The writing assistant is not available right now', 'ai_unavailable');
    }
    throw new AppError(502, 'The writing assistant failed', 'ai_failed');
  }

  const body = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!body) throw new AppError(502, 'The writing assistant sent an unreadable reply', 'ai_failed');

  if (body.promptFeedback?.blockReason) {
    throw new AppError(422, 'The assistant declined to process that text', 'ai_blocked');
  }

  const candidate = body.candidates?.[0];

  /**
   * `MAX_TOKENS` means the JSON is cut off mid-structure. It would fail to
   * parse anyway, but saying so plainly beats "unreadable reply" — the fix is
   * a shorter recipe, and the caller can only say that if it knows.
   */
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new AppError(422, 'That recipe is too long for the assistant to tidy in one go', 'ai_too_long');
  }

  const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (text.trim() === '') throw new AppError(502, 'The writing assistant sent an empty reply', 'ai_failed');

  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(502, 'The writing assistant sent a malformed reply', 'ai_failed');
  }
}
