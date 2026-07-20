/**
 * Responsive image URLs.
 *
 * Cards currently download the full-size image and scale it down in CSS, which
 * on a phone means fetching a 2000px JPEG to paint it at 320px. Cloudinary
 * accepts transformations inline in the URL path, so a width can be requested
 * per breakpoint.
 *
 * This only works for images we host. A URL pasted from a food blog cannot be
 * transformed, so those are returned untouched rather than mangled into a 404 —
 * the same discipline as the ingredient scaler: if it cannot be done
 * confidently, leave it alone.
 */

const CLOUDINARY_HOST = 'res.cloudinary.com';

/** Widths worth generating. Beyond ~1600px the file size stops paying for itself. */
const CARD_WIDTHS = [320, 480, 640, 800] as const;
const HERO_WIDTHS = [640, 960, 1280, 1600] as const;

function isCloudinary(url: string): boolean {
  try {
    return new URL(url).hostname === CLOUDINARY_HOST;
  } catch {
    return false;
  }
}

/**
 * Inserts a transformation into a Cloudinary URL.
 *
 * The path is `/<cloud>/image/upload/<transforms>/<public-id>`. Anything
 * already between `upload/` and the id is an existing transformation, which is
 * preserved — dropping it would discard the size cap applied at upload time.
 */
function withTransform(url: string, transform: string): string {
  const marker = '/image/upload/';
  const index = url.indexOf(marker);
  if (index === -1) return url;

  const before = url.slice(0, index + marker.length);
  const after = url.slice(index + marker.length);

  return `${before}${transform}/${after}`;
}

/** A single resized variant. */
export function resizedImage(url: string, width: number): string {
  if (!url || !isCloudinary(url)) return url;
  return withTransform(url, `c_fill,w_${width},q_auto,f_auto`);
}

/**
 * A `srcset` string, or empty when the host cannot be transformed — in which
 * case the caller should simply omit the attribute rather than emit a
 * single-entry set that saves nothing.
 */
export function buildSrcSet(url: string, variant: 'card' | 'hero' = 'card'): string {
  if (!url || !isCloudinary(url)) return '';

  const widths = variant === 'hero' ? HERO_WIDTHS : CARD_WIDTHS;
  return widths.map((width) => `${resizedImage(url, width)} ${width}w`).join(', ');
}

/** What `sizes` should say for each context, so the browser picks correctly. */
export const IMAGE_SIZES = {
  /** Grid cards: full width on a phone, roughly a third on a wide screen. */
  card: '(max-width: 600px) 100vw, (max-width: 1024px) 50vw, 33vw',
  /** The detail hero and the home feature. */
  hero: '(max-width: 900px) 100vw, 900px',
  /** Small square thumbnails in rails and avatars. */
  thumb: '96px',
} as const;

/**
 * Everything an `<img>` needs. Spreading this keeps the decision about whether
 * a `srcset` is even possible in one place rather than at every call site.
 */
export function imageProps(
  url: string,
  variant: keyof typeof IMAGE_SIZES = 'card',
): { src: string; srcSet?: string; sizes?: string } {
  const srcSet = buildSrcSet(url, variant === 'hero' ? 'hero' : 'card');
  if (!srcSet) return { src: url };

  return { src: url, srcSet, sizes: IMAGE_SIZES[variant] };
}
