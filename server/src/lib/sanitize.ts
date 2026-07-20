import DOMPurify from 'isomorphic-dompurify';

/**
 * Tags the rich-text editor (Tiptap StarterKit) can actually produce. Anything
 * outside this set is stripped, so a hand-crafted API call cannot store markup
 * the editor would never generate.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  's',
  'del',
  'u',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
];

/**
 * Sanitize rich-text HTML on the way *in*. The client sanitizes on render too,
 * but that is defence in depth — this is the actual control, because a direct
 * API call bypasses the client entirely.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [],
    // No URLs survive, so there is no javascript:/data: vector to consider.
    KEEP_CONTENT: true,
  });
}

/**
 * Strip all markup. Used for fields that are rendered as plain text, so that a
 * stored `<script>` never reaches a consumer that forgets to escape.
 */
export function sanitizeText(dirty: string): string {
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();
}

/**
 * Escape regex metacharacters so a user-supplied search string is matched
 * literally. Without this, `(a+)+$` is a CPU-pinning ReDoS on a public route.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
