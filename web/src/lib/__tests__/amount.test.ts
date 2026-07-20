import { describe, expect, it } from 'vitest';
import { formatQuantity, isScalable, parseAmount, scaleAmount } from '../amount';

describe('parseAmount', () => {
  it.each([
    ['2', 2],
    ['0.5', 0.5],
    ['.5', 0.5],
    ['1/2', 0.5],
    ['3/4', 0.75],
    ['1 1/2', 1.5],
    ['2 3/4', 2.75],
    ['½', 0.5],
    ['¼', 0.25],
    ['1½', 1.5],
    ['1 ½', 1.5],
  ])('reads %s as %s', (input, expected) => {
    expect(parseAmount(input)?.value).toBeCloseTo(expected, 5);
  });

  it('separates the unit from the number', () => {
    expect(parseAmount('200 g')).toMatchObject({ value: 200, suffix: ' g' });
    expect(parseAmount('1 1/2 cups flour')).toMatchObject({ value: 1.5, suffix: ' cups flour' });
  });

  it('reads both ends of a range', () => {
    expect(parseAmount('2-3 cloves')).toMatchObject({ value: 2, high: 3, suffix: ' cloves' });
    expect(parseAmount('1 to 2 tbsp')).toMatchObject({ value: 1, high: 2 });
    expect(parseAmount('2 – 3')).toMatchObject({ value: 2, high: 3 });
  });

  it('preserves text appearing before the number', () => {
    expect(parseAmount('about 2 cups')).toMatchObject({ prefix: 'about ', value: 2 });
  });

  it.each(['a pinch', 'to taste', 'salt', '', '   ', 'handful'])(
    'refuses to parse %o, which has no quantity',
    (input) => {
      expect(parseAmount(input)).toBeNull();
    },
  );
});

describe('formatQuantity', () => {
  it.each([
    [2, '2'],
    [0.5, '½'],
    [0.25, '¼'],
    [0.75, '¾'],
    [1.5, '1 ½'],
    [2.75, '2 ¾'],
    [1 / 3, '⅓'],
    [2 / 3, '⅔'],
  ])('renders %s as %s', (input, expected) => {
    expect(formatQuantity(input)).toBe(expected);
  });

  it('never emits a repeating decimal', () => {
    // The behaviour this whole module exists to prevent.
    expect(formatQuantity(2 / 3)).not.toContain('0.666');
    expect(formatQuantity(1 / 3)).not.toContain('333');
  });

  it('can render ASCII fractions for contexts without good glyph support', () => {
    expect(formatQuantity(0.5, { unicode: false })).toBe('1/2');
    expect(formatQuantity(1.75, { unicode: false })).toBe('1 3/4');
  });

  it('drops to plain numbers once fractions stop helping', () => {
    expect(formatQuantity(12.4)).toBe('12');
    expect(formatQuantity(10)).toBe('10');
  });

  it('snaps a near-whole value rather than printing 2 and a sliver', () => {
    expect(formatQuantity(1.999)).toBe('2');
    expect(formatQuantity(2.001)).toBe('2');
  });

  it('falls back to a decimal when no measurable fraction is close', () => {
    // 0.07 is not near any half, third, quarter, sixth or eighth.
    expect(formatQuantity(0.07)).toBe('0.07');
  });

  it('handles nonsense input without throwing', () => {
    expect(formatQuantity(Number.NaN)).toBe('');
    expect(formatQuantity(-1)).toBe('');
    expect(formatQuantity(0)).toBe('0');
  });
});

describe('scaleAmount', () => {
  it.each([
    ['1 1/2 cups', 2, '3 cups'],
    ['2 cups', 0.5, '1 cups'],
    ['1 cup', 3, '3 cup'],
    ['200 g', 2, '400 g'],
    ['½ tsp', 2, '1 tsp'],
    ['1/4 cup', 2, '½ cup'],
    ['3 eggs', 1 / 3, '1 eggs'],
  ])('scales %s by %s to %s', (amount, factor, expected) => {
    expect(scaleAmount(amount, factor)).toBe(expected);
  });

  it('scales both ends of a range', () => {
    expect(scaleAmount('2-3 cloves', 2)).toBe('4–6 cloves');
  });

  it('preserves a leading qualifier', () => {
    expect(scaleAmount('about 2 cups', 2)).toBe('about 4 cups');
  });

  it.each(['a pinch', 'to taste', 'salt', ''])('leaves %o untouched', (amount) => {
    expect(scaleAmount(amount, 2)).toBe(amount);
  });

  it('is a no-op at a factor of 1', () => {
    expect(scaleAmount('1 1/2 cups', 1)).toBe('1 1/2 cups');
  });

  it('refuses a nonsensical factor rather than producing nonsense', () => {
    expect(scaleAmount('2 cups', 0)).toBe('2 cups');
    expect(scaleAmount('2 cups', -1)).toBe('2 cups');
    expect(scaleAmount('2 cups', Number.NaN)).toBe('2 cups');
    expect(scaleAmount('2 cups', Number.POSITIVE_INFINITY)).toBe('2 cups');
  });

  it('round-trips: doubling then halving returns the original value', () => {
    const doubled = scaleAmount('1 1/2 cups', 2);
    expect(scaleAmount(doubled, 0.5)).toBe('1 ½ cups');
  });
});

describe('isScalable', () => {
  it('distinguishes amounts with a quantity from those without', () => {
    expect(isScalable('2 cups')).toBe(true);
    expect(isScalable('½ tsp')).toBe(true);
    expect(isScalable('a pinch')).toBe(false);
    expect(isScalable('')).toBe(false);
  });
});
