import { generateJson } from './gemini.js';
import { findInventedQuantities } from './quantities.js';
import { sanitizeHtml, sanitizeText } from './sanitize.js';
import { LIMITS, DIFFICULTIES } from '../models/constants.js';

/**
 * Turning rough notes into a presentable recipe, without inventing one.
 *
 * The shape of the problem: someone types `2 onion chopped, 1tbsp gg paste,
 * half kg chicken / fry onions till golden add gg paste then chicken / cook 20
 * min add tomatoes` and wants it to come out looking like the rest of the site.
 * That is a formatting job — splitting, ordering, capitalising, separating an
 * amount from an ingredient name — and models are very good at it.
 *
 * They are also very good at the adjacent job nobody asked for: filling in what
 * is missing. "Some flour" becomes "250 g flour". "Cook till done" becomes
 * "bake at 180°C for 25 minutes". The prose is better and the recipe is now
 * partly fiction, published under the author's name, for other people to cook
 * from.
 *
 * So this module draws a hard line down the middle:
 *
 *   - **Wording** is the model's to change. Anything it does to prose is at
 *     worst ugly and is shown to the author before it is saved.
 *   - **Quantities** are not. Every number in the output is checked against the
 *     input by `quantities.ts`, in code, after the model has spoken. Failing
 *     that check is not a warning the model can argue with.
 *
 * Inferred *metadata* — cuisine, difficulty, tags, timings — is a third case.
 * It is genuinely useful and genuinely a guess, so it is returned separately,
 * labelled as a guess, and never merged into the recipe without a human
 * accepting it field by field.
 */

export interface TidyInput {
  title: string;
  overview: string;
  ingredients: { amount: string; name: string }[];
  instructions: string;
}

export interface TidyIngredient {
  amount: string;
  name: string;
  /** Set when the model proposed an amount that the input did not support. */
  amountRemoved?: boolean;
}

export interface TidySuggestion<T> {
  value: T;
  /** Always true for this block; present so the client cannot forget to say so. */
  inferred: true;
}

export interface TidyResult {
  title: string;
  overview: string;
  ingredients: TidyIngredient[];
  instructions: string;
  suggestions: {
    cuisine?: TidySuggestion<string>;
    difficulty?: TidySuggestion<string>;
    tags?: TidySuggestion<string[]>;
    prepMinutes?: TidySuggestion<number>;
    cookMinutes?: TidySuggestion<number>;
    servings?: TidySuggestion<number>;
  };
  /** Plain sentences to show the author. Never silently swallowed. */
  warnings: string[];
}

/**
 * The reply shape, as an OpenAPI-subset schema Gemini decodes against.
 *
 * Constraining the decode removes a whole class of failure — no prose preamble,
 * no markdown fence, no missing key — but it constrains *shape*, not *content*.
 * Everything below is still validated and sanitised as if it had been typed
 * into the form by a stranger, because from the database's point of view it was.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    overview: { type: 'string' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          amount: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['amount', 'name'],
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    cuisine: { type: 'string' },
    difficulty: { type: 'string', enum: [...DIFFICULTIES] },
    tags: { type: 'array', items: { type: 'string' } },
    prepMinutes: { type: 'integer' },
    cookMinutes: { type: 'integer' },
    servings: { type: 'integer' },
  },
  required: ['title', 'overview', 'ingredients', 'steps'],
} as const;

const SYSTEM_PROMPT = `You are a careful recipe editor for a family recipe website.

You are given a recipe as its author typed it: often rough, unpunctuated, with
abbreviations and inconsistent spacing. Your job is to present it clearly.

WHAT YOU MAY DO
- Split run-on prose into separate, ordered steps. One action per step.
- Separate each ingredient's amount from its name. Put the quantity and unit in
  "amount" ("200 g", "1 tbsp", "2") and the ingredient plus any preparation in
  "name" ("plain flour", "onions, finely chopped").
- Fix spelling, capitalisation, spacing and grammar. Expand obvious shorthand
  where you are certain of it: "gg paste" is ginger-garlic paste, "tsp" is
  teaspoon, "med" is medium.
- Write in clear, plain English. Use the imperative: "Fry the onions", not "You
  should fry the onions". Do not be flowery. Do not add commentary, tips,
  serving suggestions or notes.
- Normalise units the author used ("half a kg" may become "500 g").

WHAT YOU MUST NOT DO — THIS IS THE IMPORTANT PART
- Do NOT invent any quantity, weight, volume, count, temperature or duration.
  If the author did not state an amount for an ingredient, "amount" must be an
  empty string. An empty amount is correct and expected. A guessed amount is a
  serious error: people cook from these recipes.
- Do NOT add an ingredient the author did not mention, even one the dish
  obviously needs.
- Do NOT add a step the author did not describe, even an obvious one like
  preheating an oven or seasoning to taste.
- Do NOT add a temperature or a time to a step that had none. "Cook until done"
  stays "Cook until done". It must not become "Cook for 20 minutes".
- Do NOT change any quantity the author did state, except to convert units
  faithfully.

Numbers in your output are checked against the author's input automatically.
Any number that cannot be traced to what they wrote will be stripped or the
whole edit rejected, so inventing one helps nobody.

METADATA
Separately, you may suggest: cuisine, difficulty (easy/medium/hard), up to 5
lowercase tags, prepMinutes, cookMinutes and servings. These are understood to
be your inference and are shown to the author as guesses for them to accept or
reject. Only include a field if you have a reasonable basis for it; omit it
otherwise. Timings here are your estimate for the dish as a whole and are kept
out of the step text.

Return only the JSON object described by the schema.`;

/** Renders the recipe for the model, labelled so nothing is ambiguous. */
function formatInput(input: TidyInput): string {
  const ingredients = input.ingredients
    .filter((ingredient) => `${ingredient.amount}${ingredient.name}`.trim() !== '')
    .map((ingredient) => `- ${ingredient.amount} ${ingredient.name}`.replace(/\s+/g, ' ').trim())
    .join('\n');

  return [
    `TITLE: ${input.title || '(none given)'}`,
    `DESCRIPTION: ${input.overview || '(none given)'}`,
    '',
    'INGREDIENTS AS TYPED:',
    ingredients || '(none given)',
    '',
    'METHOD AS TYPED:',
    htmlToText(input.instructions) || '(none given)',
  ].join('\n');
}

/** The editor stores HTML; the model should see the words, not the markup. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    // Removed outright rather than replaced with a space: `the <strong>onions</strong>.`
    // must read "the onions." and not "the onions ." — the model is being shown
    // prose, and stray spacing before punctuation is prose it may copy.
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    // Trim each line, so a tag that sat at the start of one does not leave it
    // indented by a stray space.
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Strips leading step numbering before the invention check.
 *
 * Turning prose into "1. … 2. … 3. …" is the single most common thing this
 * feature does, and those numerals are not quantities. Left in, every tidy-up
 * of a three-step recipe would report three invented numbers, and a guard that
 * cries wolf on correct output is a guard nobody reads.
 */
export function stripStepNumbering(step: string): string {
  return step.replace(/^\s*(?:step\s*)?\d+\s*[.):-]\s*/i, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asPositiveInt = (value: unknown, max: number): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) return null;
  return value;
};

/**
 * Everything that happens after the model replies: validate, sanitise, and
 * check every number against what the author actually wrote.
 *
 * Exported and pure so the whole policy can be tested without a network call —
 * which matters, because this is the part that has to be right.
 */
export function applyGuards(reply: unknown, input: TidyInput): TidyResult {
  const source = reply && typeof reply === 'object' ? (reply as Record<string, unknown>) : {};
  const warnings: string[] = [];

  /** Everything the author wrote, as one corpus for the guard to check against. */
  const authorText = [
    input.title,
    input.overview,
    ...input.ingredients.map((i) => `${i.amount} ${i.name}`),
    htmlToText(input.instructions),
  ].join('\n');

  // --- Ingredients -------------------------------------------------------
  const rawIngredients = Array.isArray(source.ingredients) ? source.ingredients : [];

  const ingredients: TidyIngredient[] = [];
  const removedAmounts: string[] = [];

  for (const entry of rawIngredients.slice(0, LIMITS.ingredients)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;

    const name = sanitizeText(asString(row.name)).trim().slice(0, LIMITS.ingredientName);
    if (name === '') continue;

    let amount = sanitizeText(asString(row.amount)).trim().slice(0, LIMITS.ingredientAmount);

    /**
     * An amount is checked on its own, against the whole of the author's text.
     *
     * Per-ingredient matching would be stricter but wrong: the model is free to
     * reorder ingredients and to move a quantity mentioned in the method up
     * into the list where it belongs, and both are improvements. What must not
     * happen is a number appearing that the author never wrote anywhere.
     */
    let amountRemoved = false;

    if (amount !== '') {
      const invented = findInventedQuantities(amount, authorText);
      if (invented.length > 0) {
        removedAmounts.push(`${name} (${amount})`);
        amount = '';
        amountRemoved = true;
      }
    }

    // The flag is per ingredient so the review screen can mark the offending
    // row, rather than showing one warning about a list of twenty.
    ingredients.push(amountRemoved ? { amount, name, amountRemoved } : { amount, name });
  }

  if (removedAmounts.length > 0) {
    warnings.push(
      `The assistant suggested an amount you had not written for ${listToProse(removedAmounts)}. ` +
        'Those amounts were removed — fill them in yourself if you know them.',
    );
  }

  // --- Steps -------------------------------------------------------------
  const rawSteps = Array.isArray(source.steps) ? source.steps : [];

  const steps = rawSteps
    .map((step) => sanitizeText(asString(step)).trim())
    .map(stripStepNumbering)
    .map((step) => step.trim())
    .filter((step) => step !== '');

  /**
   * A number invented into the *method* cannot be surgically removed the way an
   * ingredient amount can — it is embedded in a sentence, and deleting it would
   * leave "Bake at for". So the method is all-or-nothing: if the model put a
   * timing or a temperature there that the author did not write, the original
   * text is kept and the author is told why.
   */
  const inventedInSteps = findInventedQuantities(steps.join('\n'), authorText);

  let instructions: string;
  if (inventedInSteps.length > 0) {
    instructions = input.instructions;
    warnings.push(
      `The assistant added ${listToProse(inventedInSteps.map((q) => `"${q.raw}"`))} to the method, ` +
        'which you had not written, so the method was left as you typed it.',
    );
  } else if (steps.length === 0) {
    instructions = input.instructions;
    warnings.push('The assistant did not return any steps, so the method was left as you typed it.');
  } else {
    instructions = sanitizeHtml(steps.map((step) => `<p>${escapeHtml(step)}</p>`).join(''));
  }

  if (instructions.length > LIMITS.instructions) {
    instructions = input.instructions;
    warnings.push('The tidied method came back too long to store, so it was left as you typed it.');
  }

  // --- Metadata, all of it a guess ---------------------------------------
  const suggestions: TidyResult['suggestions'] = {};

  const cuisine = sanitizeText(asString(source.cuisine)).trim().slice(0, LIMITS.cuisine);
  if (cuisine !== '') suggestions.cuisine = { value: cuisine, inferred: true };

  const difficulty = asString(source.difficulty).trim().toLowerCase();
  if ((DIFFICULTIES as readonly string[]).includes(difficulty)) {
    suggestions.difficulty = { value: difficulty, inferred: true };
  }

  const tags = (Array.isArray(source.tags) ? source.tags : [])
    .map((tag) => sanitizeText(asString(tag)).trim().toLowerCase())
    .filter((tag) => tag !== '' && tag.length <= LIMITS.tag);
  const uniqueTags = [...new Set(tags)].slice(0, 5);
  if (uniqueTags.length > 0) suggestions.tags = { value: uniqueTags, inferred: true };

  const prepMinutes = asPositiveInt(source.prepMinutes, LIMITS.minutes);
  if (prepMinutes !== null) suggestions.prepMinutes = { value: prepMinutes, inferred: true };

  const cookMinutes = asPositiveInt(source.cookMinutes, LIMITS.minutes);
  if (cookMinutes !== null) suggestions.cookMinutes = { value: cookMinutes, inferred: true };

  const servings = asPositiveInt(source.servings, LIMITS.servings);
  if (servings !== null) suggestions.servings = { value: servings, inferred: true };

  // --- Title and overview ------------------------------------------------
  const title = sanitizeText(asString(source.title)).trim().slice(0, LIMITS.title) || input.title;
  const overview = sanitizeText(asString(source.overview)).trim().slice(0, LIMITS.overview);

  if (ingredients.length === 0 && input.ingredients.some((i) => i.name.trim() !== '')) {
    warnings.push('The assistant returned no ingredients, so yours were kept.');
    return {
      title,
      overview,
      ingredients: input.ingredients.map((i) => ({ amount: i.amount, name: i.name })),
      instructions,
      suggestions,
      warnings,
    };
  }

  return { title, overview, ingredients, instructions, suggestions, warnings };
}

/** "a, b and c" — a list a person reads, not a JSON array. */
function listToProse(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Calls the model, then puts its answer through every guard above. */
export async function tidyRecipe(input: TidyInput, signal?: AbortSignal): Promise<TidyResult> {
  const reply = await generateJson({
    system: SYSTEM_PROMPT,
    user: formatInput(input),
    schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signal,
  });

  return applyGuards(reply, input);
}
