/**
 * Scaling free-text ingredient amounts.
 *
 * NOTE: this is a copy of `web/src/lib/amount.ts`. The two packages deploy
 * separately and there is no shared module between them, so the choice was
 * duplicating ~200 lines of pure, well-tested logic or standing up a shared
 * package for a single file. The duplication is the smaller cost — but the two
 * copies must stay in step, and the meal-plan shopping list depends on this one
 * producing the same quantities the recipe page displays. Change both.
 *
 * Amounts are whatever the author typed: "1 1/2 cups", "200 g", "2-3", "½ tsp",
 * "a pinch". The governing rule is that anything this module cannot confidently
 * parse is returned **completely untouched**. A scaler that mangles "a pinch"
 * into "a pinch" × 2 is worse than no scaler at all, because the reader stops
 * trusting every other number on the page.
 */

/** Unicode vulgar fractions, which appear in pasted recipes constantly. */
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

/** Denominators a cook can actually measure. */
const USEFUL_DENOMINATORS = [2, 3, 4, 6, 8] as const;

const FRACTION_GLYPHS: Record<string, string> = {
  '1/2': '½',
  '1/3': '⅓',
  '2/3': '⅔',
  '1/4': '¼',
  '3/4': '¾',
  '1/6': '⅙',
  '5/6': '⅚',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
};

export interface ParsedAmount {
  /** The numeric value, or the low end of a range. */
  value: number;
  /** The high end, when the amount was written as a range. */
  high?: number;
  /** Everything after the number — the unit and any qualifier. */
  suffix: string;
  /** Anything before the number, which is rare but must be preserved. */
  prefix: string;
}

/**
 * Reads a leading quantity. Returns null when there is no number to scale,
 * which is the signal to leave the string alone.
 */
export function parseAmount(input: string): ParsedAmount | null {
  const text = input.trim();
  if (text === '') return null;

  // A mixed number ("1 1/2"), a plain fraction ("3/4"), a decimal, or an
  // integer — optionally followed by a range separator and a second quantity.
  const NUMBER = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;
  const VULGAR = `[${Object.keys(VULGAR_FRACTIONS).join('')}]`;
  // The whitespace belongs *inside* the optional fraction group. Outside it,
  // `\s*` greedily eats the space before the unit, so "200 g" parses with a
  // suffix of "g" and reassembles as "400g".
  const QUANTITY = `(?:${NUMBER}(?:\\s*${VULGAR})?|${VULGAR})`;

  const pattern = new RegExp(
    `^(?<prefix>[^\\d${Object.keys(VULGAR_FRACTIONS).join('')}]*?)` +
      `(?<low>${QUANTITY})` +
      `(?:\\s*(?:-|–|—|to)\\s*(?<high>${QUANTITY}))?` +
      `(?<suffix>.*)$`,
    'u',
  );

  const match = pattern.exec(text);
  if (!match?.groups) return null;

  const { prefix = '', low, high, suffix = '' } = match.groups;
  if (!low) return null;

  const value = quantityToNumber(low);
  if (value === null) return null;

  const highValue = high ? quantityToNumber(high) : null;

  return {
    value,
    ...(highValue !== null && highValue !== undefined ? { high: highValue } : {}),
    prefix,
    suffix,
  };
}

/** Converts one quantity token ("1 1/2", "¾", "0.5", "2") to a number. */
function quantityToNumber(token: string): number | null {
  const text = token.trim();
  if (text === '') return null;

  let total = 0;
  let sawNumber = false;

  // Peel off a trailing vulgar fraction, which may follow a whole number.
  const lastChar = text[text.length - 1];
  let rest = text;
  if (lastChar && lastChar in VULGAR_FRACTIONS) {
    total += VULGAR_FRACTIONS[lastChar]!;
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
 * Renders a number the way a recipe would: whole numbers plain, and everything
 * else snapped to a fraction a measuring cup actually has, rather than printed
 * as 0.6666666666666666.
 */
export function formatQuantity(value: number, { unicode = true } = {}): string {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value === 0) return '0';

  // Past a certain size, fractions stop helping.
  if (value >= 10) return String(Math.round(value));

  const whole = Math.floor(value);
  const remainder = value - whole;

  if (remainder < 0.02) return String(whole);
  if (remainder > 0.98) return String(whole + 1);

  let best: { numerator: number; denominator: number; error: number } | null = null;
  for (const denominator of USEFUL_DENOMINATORS) {
    const numerator = Math.round(remainder * denominator);
    if (numerator === 0 || numerator >= denominator) continue;
    const error = Math.abs(remainder - numerator / denominator);
    if (!best || error < best.error - 1e-9) best = { numerator, denominator, error };
  }

  // Nothing measurable came close — a decimal is more honest than a bad fraction.
  if (!best || best.error > 0.04) {
    const rounded = Math.round(value * 100) / 100;
    return String(rounded);
  }

  const fraction = `${best.numerator}/${best.denominator}`;
  const rendered = unicode ? (FRACTION_GLYPHS[fraction] ?? fraction) : fraction;

  return whole > 0 ? `${whole} ${rendered}` : rendered;
}

/**
 * Scales an amount string by a factor, preserving the unit, any range, and
 * anything it could not parse.
 *
 * @example scaleAmount('1 1/2 cups', 2)  // '3 cups'
 * @example scaleAmount('2-3 cloves', 2)  // '4-6 cloves'
 * @example scaleAmount('a pinch', 2)     // 'a pinch'
 */
export function scaleAmount(amount: string, factor: number): string {
  if (!Number.isFinite(factor) || factor <= 0) return amount;
  if (factor === 1) return amount;

  const parsed = parseAmount(amount);
  if (!parsed) return amount;

  const low = formatQuantity(parsed.value * factor);
  if (low === '') return amount;

  const high = parsed.high !== undefined ? formatQuantity(parsed.high * factor) : null;
  const quantity = high ? `${low}–${high}` : low;

  return `${parsed.prefix}${quantity}${parsed.suffix}`;
}

/** True when scaling would actually change this string — drives UI affordances. */
export function isScalable(amount: string): boolean {
  return parseAmount(amount) !== null;
}
