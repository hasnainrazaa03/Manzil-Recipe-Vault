/**
 * Reading quantities out of free text, so an assistant's output can be checked
 * against its input.
 *
 * This module exists for one reason: **a language model asked to "make this
 * proper" will happily invent numbers.** "some flour" becomes "250 g flour";
 * "cook till done" becomes "bake at 180°C for 25 minutes". Both read beautifully
 * and neither is something the author said. A recipe carries someone's name and
 * gets cooked from, so a fabricated quantity is not a formatting bug — it is a
 * wrong instruction presented with total confidence.
 *
 * Telling the model not to do it is necessary and not sufficient. This is the
 * part that does not depend on the model complying: every quantity in the output
 * must be *derivable* from one in the input, checked in code, with the model
 * given no say in the matter.
 *
 * "Derivable" is deliberately a little generous, because legitimate tidying does
 * change how a number is written:
 *
 *   - "half a kg"  →  "500 g"     unit conversion within one dimension
 *   - "1tbsp"      →  "1 tbsp"    spacing
 *   - "two onions" →  "2 onions"  a number written as a word
 *   - "1/2 cup"    →  "½ cup"     a different glyph for the same value
 *
 * All four preserve meaning. Inventing 250 does not. The distinction this module
 * draws is exactly that one.
 */

/** Dimensions a quantity can belong to. Values only compare within a dimension. */
type Dimension = 'mass' | 'volume' | 'time' | 'temperature' | 'count';

export interface Quantity {
  /** The value converted to the dimension's base unit. */
  value: number;
  dimension: Dimension;
  /** The substring this came from, for reporting back to a human. */
  raw: string;
}

/**
 * Unit aliases, mapped to a multiplier against the dimension's base unit:
 * grams, millilitres, minutes, and °C.
 *
 * US volumetric units use the US customary values, since that is what recipes
 * written in cups mean. The imperial pint differs by 20%, which matters for
 * liquids and is exactly the kind of silent drift this file is here to prevent
 * — so no unit appears twice under different systems.
 */
const UNITS: Record<string, { dimension: Dimension; perBase: number }> = {
  // Mass, base gram.
  mg: { dimension: 'mass', perBase: 0.001 },
  milligram: { dimension: 'mass', perBase: 0.001 },
  milligrams: { dimension: 'mass', perBase: 0.001 },
  g: { dimension: 'mass', perBase: 1 },
  gram: { dimension: 'mass', perBase: 1 },
  grams: { dimension: 'mass', perBase: 1 },
  gm: { dimension: 'mass', perBase: 1 },
  gms: { dimension: 'mass', perBase: 1 },
  kg: { dimension: 'mass', perBase: 1000 },
  kilo: { dimension: 'mass', perBase: 1000 },
  kilos: { dimension: 'mass', perBase: 1000 },
  kilogram: { dimension: 'mass', perBase: 1000 },
  kilograms: { dimension: 'mass', perBase: 1000 },
  oz: { dimension: 'mass', perBase: 28.349523125 },
  ounce: { dimension: 'mass', perBase: 28.349523125 },
  ounces: { dimension: 'mass', perBase: 28.349523125 },
  lb: { dimension: 'mass', perBase: 453.59237 },
  lbs: { dimension: 'mass', perBase: 453.59237 },
  pound: { dimension: 'mass', perBase: 453.59237 },
  pounds: { dimension: 'mass', perBase: 453.59237 },

  // Volume, base millilitre.
  ml: { dimension: 'volume', perBase: 1 },
  millilitre: { dimension: 'volume', perBase: 1 },
  millilitres: { dimension: 'volume', perBase: 1 },
  milliliter: { dimension: 'volume', perBase: 1 },
  milliliters: { dimension: 'volume', perBase: 1 },
  cl: { dimension: 'volume', perBase: 10 },
  dl: { dimension: 'volume', perBase: 100 },
  l: { dimension: 'volume', perBase: 1000 },
  litre: { dimension: 'volume', perBase: 1000 },
  litres: { dimension: 'volume', perBase: 1000 },
  liter: { dimension: 'volume', perBase: 1000 },
  liters: { dimension: 'volume', perBase: 1000 },
  tsp: { dimension: 'volume', perBase: 4.92892159375 },
  teaspoon: { dimension: 'volume', perBase: 4.92892159375 },
  teaspoons: { dimension: 'volume', perBase: 4.92892159375 },
  tbsp: { dimension: 'volume', perBase: 14.78676478125 },
  tbs: { dimension: 'volume', perBase: 14.78676478125 },
  tablespoon: { dimension: 'volume', perBase: 14.78676478125 },
  tablespoons: { dimension: 'volume', perBase: 14.78676478125 },
  cup: { dimension: 'volume', perBase: 236.5882365 },
  cups: { dimension: 'volume', perBase: 236.5882365 },
  pint: { dimension: 'volume', perBase: 473.176473 },
  pints: { dimension: 'volume', perBase: 473.176473 },
  quart: { dimension: 'volume', perBase: 946.352946 },
  quarts: { dimension: 'volume', perBase: 946.352946 },
  gallon: { dimension: 'volume', perBase: 3785.411784 },
  gallons: { dimension: 'volume', perBase: 3785.411784 },

  // Time, base minute.
  sec: { dimension: 'time', perBase: 1 / 60 },
  secs: { dimension: 'time', perBase: 1 / 60 },
  second: { dimension: 'time', perBase: 1 / 60 },
  seconds: { dimension: 'time', perBase: 1 / 60 },
  min: { dimension: 'time', perBase: 1 },
  mins: { dimension: 'time', perBase: 1 },
  minute: { dimension: 'time', perBase: 1 },
  minutes: { dimension: 'time', perBase: 1 },
  hr: { dimension: 'time', perBase: 60 },
  hrs: { dimension: 'time', perBase: 60 },
  hour: { dimension: 'time', perBase: 60 },
  hours: { dimension: 'time', perBase: 60 },
  day: { dimension: 'time', perBase: 1440 },
  days: { dimension: 'time', perBase: 1440 },
};

/** Numbers written as words, which rough notes are full of. */
const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  hundred: 100,
  half: 0.5,
  quarter: 0.25,
  third: 1 / 3,
  couple: 2,
  few: 3,
};

const VULGAR_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅐': 1 / 7,
  '⅑': 1 / 9,
  '⅒': 0.1,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅕': 0.2,
  '⅖': 0.4,
  '⅗': 0.6,
  '⅘': 0.8,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

const VULGAR_CLASS = `[${Object.keys(VULGAR_FRACTIONS).join('')}]`;

/**
 * One numeric token: `1`, `1.5`, `1/2`, `1 1/2`, `½`, `1½`.
 * Written without capture groups so it can be embedded in larger patterns.
 */
const NUMBER = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;
const QUANTITY_TOKEN = `(?:${NUMBER}\\s*${VULGAR_CLASS}|${NUMBER}|${VULGAR_CLASS})`;

/** Longest-first, so `tablespoons` is not matched as `tbs` + junk. */
const UNIT_ALTERNATION = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .join('|');

const WORD_ALTERNATION = Object.keys(WORD_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Converts one numeric token to a number, or null if it is not one. */
function tokenToNumber(token: string): number | null {
  const text = token.trim();
  if (text === '') return null;

  let total = 0;
  let sawNumber = false;
  let rest = text;

  const last = text[text.length - 1];
  if (last && last in VULGAR_FRACTIONS) {
    total += VULGAR_FRACTIONS[last]!;
    sawNumber = true;
    rest = text.slice(0, -1).trim();
  }

  if (rest !== '') {
    for (const part of rest.split(/\s+/)) {
      if (part.includes('/')) {
        const [numerator, denominator] = part.split('/');
        const n = Number(numerator);
        const d = Number(denominator);
        if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
        total += n / d;
      } else {
        const n = Number(part);
        if (!Number.isFinite(n)) return null;
        total += n;
      }
      sawNumber = true;
    }
  }

  return sawNumber ? total : null;
}

/**
 * Every quantity in a piece of text, converted to its dimension's base unit.
 *
 * A number with no recognised unit is a `count` — "2 onions", "3 eggs". That is
 * still a quantity worth guarding: turning "2 onions" into "4 onions" doubles a
 * recipe without being asked.
 */
export function extractQuantities(text: string): Quantity[] {
  if (typeof text !== 'string' || text === '') return [];

  const found: Quantity[] = [];

  /**
   * Temperatures first, and removed from the text as they are consumed.
   *
   * "180°C" would otherwise also match the plain-number pass below and be
   * recorded as the count 180, which would then let an invented "180 g" through
   * on the grounds that 180 appeared in the input. Dimensions are the whole
   * mechanism; leaking a value across one defeats it.
   */
  let remaining = text.replace(
    new RegExp(`(${QUANTITY_TOKEN})\\s*(?:°\\s*|degrees?\\s+)?([cf])\\b`, 'giu'),
    (match, token: string, scale: string) => {
      const value = tokenToNumber(token);
      if (value !== null) {
        const celsius = scale.toLowerCase() === 'f' ? ((value - 32) * 5) / 9 : value;
        found.push({ value: celsius, dimension: 'temperature', raw: match.trim() });
      }
      return ' ';
    },
  );

  // Gas marks are their own scale and convert to nothing else; treated as a
  // temperature so an invented one is still caught, with the mark as the value.
  remaining = remaining.replace(new RegExp(`gas\\s*mark\\s*(${QUANTITY_TOKEN})`, 'giu'), (match, token: string) => {
    const value = tokenToNumber(token);
    if (value !== null) found.push({ value: 1000 + value, dimension: 'temperature', raw: match.trim() });
    return ' ';
  });

  // A number followed by a unit.
  remaining = remaining.replace(
    new RegExp(`(${QUANTITY_TOKEN})\\s*(${UNIT_ALTERNATION})\\b\\.?`, 'giu'),
    (match, token: string, unit: string) => {
      const value = tokenToNumber(token);
      const definition = UNITS[unit.toLowerCase()];
      if (value !== null && definition) {
        found.push({
          value: value * definition.perBase,
          dimension: definition.dimension,
          raw: match.trim(),
        });
      }
      return ' ';
    },
  );

  // A word-number followed by a unit: "half a kg", "two tbsp".
  remaining = remaining.replace(
    new RegExp(`\\b(${WORD_ALTERNATION})\\s+(?:a\\s+|an\\s+|of\\s+a\\s+)?(${UNIT_ALTERNATION})\\b\\.?`, 'giu'),
    (match, word: string, unit: string) => {
      const value = WORD_NUMBERS[word.toLowerCase()];
      const definition = UNITS[unit.toLowerCase()];
      if (value !== undefined && definition) {
        found.push({
          value: value * definition.perBase,
          dimension: definition.dimension,
          raw: match.trim(),
        });
      }
      return ' ';
    },
  );

  // Bare numbers left over: counts.
  remaining.replace(new RegExp(QUANTITY_TOKEN, 'gu'), (match) => {
    const value = tokenToNumber(match);
    if (value !== null) found.push({ value, dimension: 'count', raw: match.trim() });
    return '';
  });

  // Bare word-numbers: "two onions". Deliberately last, and deliberately not
  // including bare "a"/"an" — "a pinch of salt" is not a claim about how many.
  const bareWords = Object.keys(WORD_NUMBERS)
    .filter((word) => word !== 'a' && word !== 'an')
    .sort((a, b) => b.length - a.length)
    .join('|');

  remaining.replace(new RegExp(`\\b(${bareWords})\\b`, 'giu'), (match, word: string) => {
    const value = WORD_NUMBERS[word.toLowerCase()];
    if (value !== undefined) found.push({ value, dimension: 'count', raw: match.trim() });
    return '';
  });

  return found;
}

/**
 * Whether a quantity could have come from one of the source quantities.
 *
 * Same dimension, same value within a whisker. The tolerance is relative
 * because unit conversion is lossy in the direction cooks round: half a kilo is
 * written "500 g" and 8 oz is written "225 g" when it is 226.8. Too tight and
 * every honest conversion is flagged; too loose and "200 g" passes as "250 g".
 * 2% sits between those — it accepts culinary rounding and rejects any
 * difference a cook would notice.
 */
const TOLERANCE = 0.02;

export function isDerivable(candidate: Quantity, sources: Quantity[]): boolean {
  return sources.some((source) => {
    if (source.dimension !== candidate.dimension) return false;
    if (source.value === candidate.value) return true;

    const scale = Math.max(Math.abs(source.value), Math.abs(candidate.value));
    if (scale === 0) return true;

    return Math.abs(source.value - candidate.value) / scale <= TOLERANCE;
  });
}

/**
 * Every quantity in `output` that no quantity in `input` accounts for.
 *
 * Deduplicated by what a reader would see, so one invented number repeated
 * across five steps is reported once rather than five times.
 */
export function findInventedQuantities(output: string, input: string): Quantity[] {
  const sources = extractQuantities(input);
  const invented: Quantity[] = [];
  const seen = new Set<string>();

  for (const candidate of extractQuantities(output)) {
    if (isDerivable(candidate, sources)) continue;

    /**
     * Keyed on the *value*, not the text it was written as.
     *
     * Keying on the raw substring reported "250 g" and "250 g." as two separate
     * inventions, because the unit pattern consumes an optional trailing full
     * stop — so the same number in the middle of a sentence and at the end of
     * one looked like different findings. Two spellings of one quantity are one
     * invention, and that is what a reader needs told.
     */
    const key = `${candidate.dimension}:${candidate.value.toFixed(4)}`;
    if (seen.has(key)) continue;

    seen.add(key);
    invented.push(candidate);
  }

  return invented;
}
