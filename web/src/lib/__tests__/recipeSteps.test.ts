import { describe, expect, it } from 'vitest';
import { deriveSteps, ingredientsForStep } from '../recipeSteps';

describe('deriveSteps', () => {
  it('treats each paragraph as a step', () => {
    const steps = deriveSteps('<p>Heat the oil.</p><p>Add the onions.</p><p>Simmer.</p>');

    expect(steps).toHaveLength(3);
    expect(steps[0]?.text).toBe('Heat the oil.');
    expect(steps[2]?.text).toBe('Simmer.');
    expect(steps.map((step) => step.index)).toEqual([0, 1, 2]);
  });

  it('unwraps list items into individual steps', () => {
    const steps = deriveSteps('<ol><li>Chop.</li><li>Fry.</li><li>Serve.</li></ol>');

    expect(steps).toHaveLength(3);
    expect(steps[1]?.text).toBe('Fry.');
  });

  it('handles paragraphs and lists mixed together', () => {
    const steps = deriveSteps('<p>Prepare.</p><ul><li>Chop.</li><li>Fry.</li></ul><p>Serve.</p>');

    expect(steps.map((step) => step.text)).toEqual(['Prepare.', 'Chop.', 'Fry.', 'Serve.']);
  });

  it('keeps inline formatting inside a step', () => {
    const steps = deriveSteps('<p>Add <strong>two</strong> eggs.</p>');

    expect(steps[0]?.html).toContain('<strong>two</strong>');
    expect(steps[0]?.text).toBe('Add two eggs.');
  });

  it('falls back to a single step for one unbroken block of text', () => {
    // The degenerate case: an author who pasted plain text with no markup.
    const steps = deriveSteps('Just cook it until it is done.');

    expect(steps).toHaveLength(1);
    expect(steps[0]?.text).toBe('Just cook it until it is done.');
  });

  it('drops empty blocks rather than yielding blank steps', () => {
    const steps = deriveSteps('<p>Heat.</p><p></p><p>   </p><p>Serve.</p>');

    expect(steps).toHaveLength(2);
  });

  it.each(['', '   ', '<p></p>'])('returns nothing for %o', (input) => {
    expect(deriveSteps(input)).toEqual([]);
  });

  it('strips dangerous markup before deriving steps', () => {
    const steps = deriveSteps('<p>Safe.</p><script>alert(1)</script><p onclick="x()">Also safe.</p>');

    const serialised = JSON.stringify(steps);
    expect(serialised).not.toContain('script');
    expect(serialised).not.toContain('onclick');
    expect(steps.some((step) => step.text === 'Safe.')).toBe(true);
  });
});

describe('ingredientsForStep', () => {
  const ingredients = [
    { amount: '200 g', name: 'plain flour' },
    { amount: '2', name: 'eggs' },
    { amount: '1 tsp', name: 'vanilla extract' },
  ];

  const step = (text: string) => ({ index: 0, html: text, text });

  it('finds an ingredient named outright in the step', () => {
    const found = ingredientsForStep(step('Beat the eggs until pale.'), ingredients);

    expect(found.map((item) => item.name)).toEqual(['eggs']);
  });

  it('matches on a significant word of a multi-word name', () => {
    // "plain flour" should be found by a step that just says "flour".
    const found = ingredientsForStep(step('Sift the flour into the bowl.'), ingredients);

    expect(found.map((item) => item.name)).toEqual(['plain flour']);
  });

  it('returns nothing when the step names no ingredient', () => {
    expect(ingredientsForStep(step('Preheat the oven to 180C.'), ingredients)).toEqual([]);
  });

  it('can return several ingredients for one step', () => {
    const found = ingredientsForStep(step('Combine the flour and eggs.'), ingredients);

    expect(found).toHaveLength(2);
  });

  it('ignores very short names, which would match almost anything', () => {
    const found = ingredientsForStep(step('Stir it in.'), [{ amount: '1', name: 'it' }]);

    expect(found).toEqual([]);
  });
});
