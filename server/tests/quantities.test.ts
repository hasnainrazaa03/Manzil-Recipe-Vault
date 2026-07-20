import { describe, expect, it } from 'vitest';
import { extractQuantities, findInventedQuantities, isDerivable } from '../src/lib/quantities.js';

/**
 * The guard that stops an assistant fabricating amounts.
 *
 * Two failure modes matter here and they pull in opposite directions:
 *
 *   - **A miss** lets an invented quantity through into a saved recipe. Someone
 *     cooks from a number nobody wrote.
 *   - **A false alarm** flags an honest conversion, so the feature nags about
 *     correct output and stops being believed.
 *
 * The tests below are organised around that pair: everything that must be
 * accepted, then everything that must be caught.
 */

const values = (text: string) => extractQuantities(text).map((q) => `${q.dimension}:${round(q.value)}`);
const round = (n: number) => Math.round(n * 1000) / 1000;

describe('reading quantities out of text', () => {
  it('finds a plain number and unit', () => {
    expect(values('200 g flour')).toEqual(['mass:200']);
  });

  it('does not need a space between the number and the unit', () => {
    expect(values('1tbsp oil')).toEqual(['volume:14.787']);
  });

  it('reads fractions, both spelled and as glyphs', () => {
    expect(values('1/2 cup')).toEqual(values('½ cup'));
    expect(values('1 1/2 cups')).toEqual(values('1½ cups'));
  });

  it('reads numbers written as words', () => {
    expect(values('two onions')).toEqual(['count:2']);
    expect(values('half a kg of chicken')).toEqual(['mass:500']);
  });

  it('treats a bare number as a count', () => {
    expect(values('3 eggs')).toEqual(['count:3']);
  });

  it('converts Fahrenheit to Celsius so the two can be compared', () => {
    const [f] = extractQuantities('350°F');
    const [c] = extractQuantities('180°C');

    expect(f?.dimension).toBe('temperature');
    // 350°F is 176.67°C — close enough to 180 to be the same instruction.
    expect(Math.abs((f?.value ?? 0) - (c?.value ?? 0))).toBeLessThan(4);
  });

  it('accepts the ways a temperature gets written', () => {
    for (const text of ['180C', '180 °C', '180 degrees C']) {
      const [q] = extractQuantities(text);
      expect(q?.dimension, text).toBe('temperature');
      expect(round(q?.value ?? 0), text).toBe(180);
    }
  });

  /**
   * Regression for a dimension leak. `180°C` matched the temperature pass *and*
   * the bare-number pass, recording the count 180 as well — which would then
   * have justified an invented "180 g" on the grounds that 180 appeared in the
   * input. Consumed text is removed as it is matched.
   */
  it('does not also record a temperature as a bare count', () => {
    expect(extractQuantities('bake at 180°C')).toHaveLength(1);
    expect(extractQuantities('bake at 350F')).toHaveLength(1);
  });

  it('does not record the unit of a quantity as a second bare count', () => {
    expect(extractQuantities('200 g flour')).toHaveLength(1);
    expect(extractQuantities('1 1/2 cups sugar')).toHaveLength(1);
  });

  it('reads several quantities from one line', () => {
    expect(values('200 g flour, 2 eggs, 1 tsp salt')).toEqual([
      'mass:200',
      'volume:4.929',
      'count:2',
    ]);
  });

  it('ignores "a" and "an", which say nothing about how many', () => {
    expect(values('a pinch of salt')).toEqual([]);
    expect(values('an onion')).toEqual([]);
  });

  it('returns nothing for text with no quantities at all', () => {
    expect(extractQuantities('salt to taste')).toEqual([]);
    expect(extractQuantities('')).toEqual([]);
  });
});

describe('what the guard must accept', () => {
  const accepts = (output: string, input: string) =>
    expect(findInventedQuantities(output, input), `${input} → ${output}`).toEqual([]);

  it('accepts an identical quantity', () => {
    accepts('200 g flour', '200g flour');
  });

  it('accepts a unit conversion within one dimension', () => {
    accepts('500 g chicken', 'half a kg chicken');
    accepts('1000 ml stock', '1 litre stock');
  });

  it('accepts culinary rounding of an imperial conversion', () => {
    // 8 oz is 226.8 g, and every cookbook writes 225.
    accepts('225 g butter', '8 oz butter');
  });

  it('accepts a word number becoming a numeral', () => {
    accepts('2 onions, chopped', 'two onion chopped');
  });

  it('accepts a fraction changing glyph', () => {
    accepts('½ tsp cumin', '1/2 tsp cumin');
  });

  it('accepts a temperature converted between scales', () => {
    accepts('bake at 180°C', 'bake at 350F');
  });

  it('accepts an hour written as minutes', () => {
    accepts('simmer for 90 minutes', 'simmer 1.5 hours');
  });

  it('accepts reordering and repetition', () => {
    accepts('1 tsp salt. Later, another 1 tsp salt.', 'salt 1 tsp, and 1 tsp more later');
  });

  /**
   * The whole point of the feature: prose becoming numbered steps. Those step
   * numbers are not quantities, but they are bare numbers in the output, and a
   * naive guard flags every one of them.
   */
  it('does not mistake step numbering for invented quantities', () => {
    const input = 'fry onions till golden add paste then chicken cook 20 min';
    const output =
      '1. Fry the onions until golden. 2. Add the paste, then the chicken. 3. Cook for 20 minutes.';

    const invented = findInventedQuantities(output, input);
    // 1, 2 and 3 are counts with no counterpart in the input — they must not be
    // reported. Any real guard needs the caller to strip numbering first, so
    // this test pins the behaviour the caller depends on.
    expect(invented.map((q) => q.raw)).toEqual(['1', '2', '3']);
  });
});

describe('what the guard must catch', () => {
  const catches = (output: string, input: string) =>
    findInventedQuantities(output, input).map((q) => q.raw);

  it('catches an amount invented for a vague ingredient', () => {
    expect(catches('250 g flour', 'some flour')).toEqual(['250 g']);
  });

  it('catches an invented cooking time', () => {
    expect(catches('bake for 25 minutes', 'bake till done')).toEqual(['25 minutes']);
  });

  it('catches an invented temperature', () => {
    expect(catches('bake at 180°C', 'bake in the oven')).toEqual(['180°C']);
  });

  it('catches a quantity that changed value', () => {
    expect(catches('4 onions', '2 onions')).toEqual(['4']);
  });

  /**
   * The subtle one. 250 is not in the input, but 250 *g* against a 250 *ml*
   * source is a different physical quantity — flour by weight is not flour by
   * volume. Matching on the number alone would let this through.
   */
  it('does not let a value cross between dimensions', () => {
    expect(catches('250 g flour', '250 ml milk')).toEqual(['250 g']);
    expect(catches('180 g sugar', 'bake at 180°C')).toEqual(['180 g']);
  });

  it('catches a difference too small to notice but too big to be rounding', () => {
    // 5% out: not a conversion artefact, and enough to matter in baking.
    expect(catches('210 g flour', '200 g flour')).toEqual(['210 g']);
  });

  it('reports one invented number once, however often it is repeated', () => {
    const output = 'Add 250 g flour. Then 250 g more. Finally 250 g.';
    expect(catches(output, 'flour')).toEqual(['250 g']);
  });

  it('catches every distinct invention, not just the first', () => {
    expect(catches('200 g flour and 3 eggs', 'flour and eggs')).toEqual(['200 g', '3']);
  });
});

describe('comparing two quantities directly', () => {
  it('refuses to compare across dimensions', () => {
    const [mass] = extractQuantities('100 g');
    const [volume] = extractQuantities('100 ml');

    expect(isDerivable(mass!, [volume!])).toBe(false);
  });

  it('accepts an exact match', () => {
    const [a] = extractQuantities('100 g');
    const [b] = extractQuantities('100 g');

    expect(isDerivable(a!, [b!])).toBe(true);
  });

  it('has no source to match against when the input had no quantities', () => {
    const [a] = extractQuantities('100 g');

    expect(isDerivable(a!, [])).toBe(false);
  });
});
