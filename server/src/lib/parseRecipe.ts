import { sanitizeHtml, sanitizeText } from './sanitize.js';
import { LIMITS } from '../models/constants.js';

/**
 * Extracts a recipe from a web page's schema.org JSON-LD.
 *
 * Google requires this markup for the recipe rich result, so essentially every
 * site that wants search traffic publishes it. That makes a structured read far
 * more reliable than scraping markup, which differs per site and breaks on
 * every redesign.
 *
 * Nothing here trusts the input. A page can put anything in its JSON-LD, so
 * every string is sanitised and every list bounded exactly as if it had been
 * typed into the form — because from the database's point of view, it was.
 */

export interface ParsedRecipe {
  title: string;
  overview: string;
  image: string;
  ingredients: { amount: string; name: string }[];
  instructions: string;
  tags: string[];
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  cuisine: string;
  sourceUrl: string;
  sourceName: string;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** schema.org lets almost every field be a value, an object, or an array. */
function firstString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstString(entry);
      if (found) return found;
    }
    return '';
  }
  if (isObject(value)) {
    // Common shapes: {"@value": "..."}, {"name": "..."}, {"url": "..."}
    return firstString(value['@value'] ?? value.name ?? value.url ?? value.text);
  }
  return '';
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function hasType(node: Json, type: string): boolean {
  const raw = node['@type'];
  const types = Array.isArray(raw) ? raw : [raw];
  return types.some((entry) => typeof entry === 'string' && entry.toLowerCase() === type);
}

/** Walks the graph, since a Recipe is often nested inside @graph or an array. */
function findRecipeNode(value: unknown, depth = 0): Json | null {
  if (depth > 6) return null;

  for (const entry of toArray(value)) {
    if (!isObject(entry)) continue;
    if (hasType(entry, 'recipe')) return entry;

    const nested = findRecipeNode(entry['@graph'] ?? entry.mainEntity ?? entry.itemListElement, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/** Pulls every JSON-LD block out of the page, tolerating malformed ones. */
function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // One malformed block should not lose the others; sites frequently ship
      // a broken analytics blob alongside a perfectly good Recipe.
    }
  }
  return blocks;
}

/**
 * Parses an ISO 8601 duration (`PT1H30M`) into minutes.
 * Returns null for anything unrecognised rather than guessing.
 */
export function parseDuration(value: unknown): number | null {
  const text = firstString(value).trim().toUpperCase();
  if (!text.startsWith('P')) return null;

  const match = /^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:[\d.]+S)?)?$/.exec(text);
  if (!match) return null;

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const total = Math.round(days * 1440 + hours * 60 + minutes);

  if (!Number.isFinite(total) || total <= 0 || total > LIMITS.minutes) return null;
  return total;
}

/** `recipeYield` is "4", "4 servings", ["4", "4 servings"] or nonsense. */
export function parseServings(value: unknown): number | null {
  const text = firstString(value);
  const match = /(\d+)/.exec(text);
  if (!match?.[1]) return null;

  const count = Number(match[1]);
  if (!Number.isInteger(count) || count < 1 || count > LIMITS.servings) return null;
  return count;
}

/**
 * Splits "200g plain flour" into an amount and a name.
 *
 * schema.org gives ingredients as single strings, but the form has two fields
 * and scaling depends on the amount being separable. The split takes a leading
 * quantity and an optional unit; anything it cannot read confidently goes in
 * the name with an empty amount, so nothing is lost or mangled.
 */
export function splitIngredient(line: string): { amount: string; name: string } {
  const text = sanitizeText(line).replace(/\s+/g, ' ').trim();
  if (!text) return { amount: '', name: '' };

  const UNITS =
    'g|kg|mg|ml|l|litre|litres|liter|liters|tsp|teaspoon|teaspoons|tbsp|tablespoon|tablespoons|' +
    'cup|cups|oz|ounce|ounces|lb|lbs|pound|pounds|clove|cloves|pinch|pinches|handful|handfuls|' +
    'slice|slices|can|cans|tin|tins|packet|packets|bunch|bunches|sprig|sprigs';

  const pattern = new RegExp(
    `^((?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|[\\d.]+|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\\s*[-–—]\\s*(?:[\\d.]+|\\d+/\\d+))?` +
      `(?:\\s*(?:${UNITS})\\b\\.?)?)\\s+(.*)$`,
    'i',
  );

  const match = pattern.exec(text);
  if (!match?.[1] || !match[2]) return { amount: '', name: text.slice(0, LIMITS.ingredientName) };

  return {
    amount: match[1].trim().slice(0, LIMITS.ingredientAmount),
    name: match[2].trim().slice(0, LIMITS.ingredientName),
  };
}

/** Instructions come as a string, a list of strings, or HowToStep objects. */
function parseInstructions(value: unknown): string {
  const steps: string[] = [];

  const collect = (entry: unknown, depth = 0): void => {
    if (depth > 4) return;

    if (typeof entry === 'string') {
      // A single blob of prose with real paragraph breaks becomes several steps.
      for (const part of entry.split(/\n{2,}|\r\n{2,}/)) {
        const clean = sanitizeText(part).trim();
        if (clean) steps.push(clean);
      }
      return;
    }

    if (Array.isArray(entry)) {
      entry.forEach((item) => collect(item, depth + 1));
      return;
    }

    if (isObject(entry)) {
      // HowToSection wraps a nested itemListElement of HowToSteps.
      if (entry.itemListElement) {
        collect(entry.itemListElement, depth + 1);
        return;
      }
      const text = firstString(entry.text ?? entry.name);
      const clean = sanitizeText(text).trim();
      if (clean) steps.push(clean);
    }
  };

  collect(value);

  if (steps.length === 0) return '';

  // Rebuilt as paragraphs, which is what the editor produces and what cook mode
  // splits on — so an imported recipe walks through step by step like any other.
  return sanitizeHtml(steps.map((step) => `<p>${escapeHtml(step)}</p>`).join(''));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Only images we can actually display; everything else is dropped. */
function parseImage(value: unknown): string {
  const url = firstString(value).trim();
  if (!url) return '';
  try {
    return new URL(url).protocol === 'https:' ? url.slice(0, LIMITS.imageUrl) : '';
  } catch {
    return '';
  }
}

function parseTags(node: Json): string[] {
  const raw = [...toArray(node.recipeCategory), ...toArray(node.keywords)];

  const tags = raw
    .flatMap((entry) => firstString(entry).split(','))
    .map((tag) => sanitizeText(tag).trim().toLowerCase())
    .filter((tag) => tag.length > 0 && tag.length <= LIMITS.tag);

  return [...new Set(tags)].slice(0, LIMITS.tags);
}

/** The site's own name, for attribution. */
function siteName(html: string, url: string): string {
  const meta = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (meta?.[1]) return sanitizeText(meta[1]).slice(0, 80);
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function parseRecipeFromHtml(html: string, sourceUrl: string): ParsedRecipe | null {
  const node = findRecipeNode(jsonLdBlocks(html));
  if (!node) return null;

  const title = sanitizeText(firstString(node.name)).slice(0, LIMITS.title).trim();
  const instructions = parseInstructions(node.recipeInstructions);

  // Without at least a title and instructions there is nothing worth importing,
  // and a half-filled form is worse than an honest failure.
  if (!title || !instructions) return null;

  const ingredients = toArray(node.recipeIngredient)
    .map((entry) => splitIngredient(firstString(entry)))
    .filter((ingredient) => ingredient.name.length > 0)
    .slice(0, LIMITS.ingredients);

  const prepMinutes = parseDuration(node.prepTime);
  const cookMinutes = parseDuration(node.cookTime);
  const totalMinutes = parseDuration(node.totalTime);

  return {
    title,
    overview: sanitizeText(firstString(node.description)).slice(0, LIMITS.overview).trim(),
    image: parseImage(node.image),
    ingredients,
    instructions,
    tags: parseTags(node),
    servings: parseServings(node.recipeYield),
    prepMinutes,
    // Many sites give only a total. Attributing it to cooking is closer to
    // right than dropping it, and the reader can correct it in the form.
    cookMinutes: cookMinutes ?? (prepMinutes === null ? totalMinutes : null),
    cuisine: sanitizeText(firstString(node.recipeCuisine)).slice(0, LIMITS.cuisine).trim(),
    sourceUrl,
    sourceName: siteName(html, sourceUrl),
  };
}
