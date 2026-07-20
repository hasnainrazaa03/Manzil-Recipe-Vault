import { describe, expect, it } from 'vitest';
import { applyGuards, htmlToText, stripStepNumbering, type TidyInput } from '../src/lib/tidyRecipe.js';

/**
 * The policy that runs after the model replies.
 *
 * Tested without a network call, because this is the part that has to be right
 * and the model's behaviour is the one thing here nobody can pin down. Every
 * test below hands `applyGuards` a reply and asserts what survives it — which
 * is exactly the question "what could a model do to a recipe if it wanted to".
 */

const input: TidyInput = {
  title: 'chicken curry',
  overview: '',
  ingredients: [
    { amount: '2', name: 'onion chopped' },
    { amount: '1tbsp', name: 'gg paste' },
    { amount: 'half kg', name: 'chicken' },
    { amount: '', name: 'tomatoes' },
  ],
  instructions: '<p>fry onions till golden add gg paste then chicken cook 20 min add tomatoes</p>',
};

/** A well-behaved reply: reformats, converts, invents nothing. */
const goodReply = {
  title: 'Chicken Curry',
  overview: 'A simple home-style chicken curry.',
  ingredients: [
    { amount: '2', name: 'onions, chopped' },
    { amount: '1 tbsp', name: 'ginger-garlic paste' },
    { amount: '500 g', name: 'chicken' },
    { amount: '', name: 'tomatoes' },
  ],
  steps: [
    'Fry the onions until golden.',
    'Add the ginger-garlic paste, then the chicken.',
    'Cook for 20 minutes, then add the tomatoes.',
  ],
  cuisine: 'Pakistani',
  difficulty: 'easy',
  tags: ['chicken', 'curry'],
  cookMinutes: 25,
};

describe('a well-behaved reply', () => {
  const result = applyGuards(goodReply, input);

  it('keeps every amount the author supported, including converted ones', () => {
    expect(result.ingredients).toEqual([
      { amount: '2', name: 'onions, chopped' },
      { amount: '1 tbsp', name: 'ginger-garlic paste' },
      { amount: '500 g', name: 'chicken' },
      { amount: '', name: 'tomatoes' },
    ]);
  });

  it('rebuilds the method as paragraphs, which is what the editor produces', () => {
    expect(result.instructions).toBe(
      '<p>Fry the onions until golden.</p>' +
        '<p>Add the ginger-garlic paste, then the chicken.</p>' +
        '<p>Cook for 20 minutes, then add the tomatoes.</p>',
    );
  });

  it('passes without a single warning', () => {
    expect(result.warnings).toEqual([]);
  });

  it('marks every piece of metadata as inferred', () => {
    expect(result.suggestions.cuisine).toEqual({ value: 'Pakistani', inferred: true });
    expect(result.suggestions.difficulty).toEqual({ value: 'easy', inferred: true });
    expect(result.suggestions.tags).toEqual({ value: ['chicken', 'curry'], inferred: true });
    expect(result.suggestions.cookMinutes).toEqual({ value: 25, inferred: true });
  });

  /**
   * The estimate belongs in the metadata field, where it is labelled a guess.
   * The same number written into a step would read as something the author
   * said, so the guard must not have accepted it there — and it did not, since
   * the only timing in the steps is the 20 minutes the author wrote.
   */
  it('does not let an inferred timing leak into the method text', () => {
    expect(result.instructions).not.toContain('25');
  });
});

describe('a reply that invents an ingredient amount', () => {
  const result = applyGuards(
    {
      ...goodReply,
      ingredients: [
        ...goodReply.ingredients.slice(0, 3),
        { amount: '400 g', name: 'tomatoes' }, // the author wrote no amount
      ],
    },
    input,
  );

  it('strips the amount rather than the ingredient', () => {
    const tomatoes = result.ingredients.find((i) => i.name === 'tomatoes');

    expect(tomatoes?.amount).toBe('');
    expect(tomatoes?.name).toBe('tomatoes');
  });

  it('marks the row so the review screen can point at it', () => {
    expect(result.ingredients.find((i) => i.name === 'tomatoes')?.amountRemoved).toBe(true);
  });

  it('tells the author what was removed and what it said', () => {
    expect(result.warnings.join(' ')).toContain('tomatoes (400 g)');
  });

  it('leaves the honest amounts alone', () => {
    expect(result.ingredients.find((i) => i.name === 'chicken')?.amount).toBe('500 g');
  });
});

describe('a reply that invents a timing or temperature in the method', () => {
  /**
   * The dangerous case, and the reason the method is all-or-nothing: a number
   * inside a sentence cannot be removed without wrecking the sentence, so the
   * author's own text is kept instead.
   */
  const result = applyGuards(
    {
      ...goodReply,
      steps: [
        'Preheat the oven to 180°C.',
        'Fry the onions until golden.',
        'Bake for 45 minutes.',
      ],
    },
    input,
  );

  it('keeps the method exactly as the author typed it', () => {
    expect(result.instructions).toBe(input.instructions);
  });

  it('names the numbers it refused, so the warning is checkable', () => {
    const warning = result.warnings.join(' ');

    expect(warning).toContain('180°C');
    expect(warning).toContain('45 minutes');
  });

  it('still returns the ingredients, which were fine', () => {
    expect(result.ingredients.find((i) => i.name === 'chicken')?.amount).toBe('500 g');
  });
});

describe('a reply that adds an ingredient the author never mentioned', () => {
  /**
   * An ingredient with no amount cannot be caught by the quantity guard — there
   * is no number to check. This is the residual risk the feature carries, and
   * the mitigation is that nothing is saved without the author reading it.
   * Pinned as a test so the limitation is stated somewhere that fails if it
   * ever silently changes.
   */
  it('lets an amount-less invented ingredient through, by design', () => {
    const result = applyGuards(
      { ...goodReply, ingredients: [...goodReply.ingredients, { amount: '', name: 'salt' }] },
      input,
    );

    expect(result.ingredients.map((i) => i.name)).toContain('salt');
    expect(result.warnings).toEqual([]);
  });

  it('does catch it the moment the invention carries a number', () => {
    const result = applyGuards(
      { ...goodReply, ingredients: [...goodReply.ingredients, { amount: '2 tsp', name: 'salt' }] },
      input,
    );

    expect(result.ingredients.find((i) => i.name === 'salt')?.amount).toBe('');
    expect(result.warnings.join(' ')).toContain('salt (2 tsp)');
  });
});

describe('a reply that is hostile rather than merely wrong', () => {
  it('strips HTML out of an ingredient name', () => {
    const result = applyGuards(
      { ...goodReply, ingredients: [{ amount: '', name: '<img src=x onerror=alert(1)>onions' }] },
      input,
    );

    expect(result.ingredients[0]?.name).not.toContain('<img');
    expect(result.ingredients[0]?.name).not.toContain('onerror');
  });

  it('strips HTML out of a step', () => {
    const result = applyGuards(
      { ...goodReply, steps: ['Fry the <script>alert(1)</script> onions.'] },
      input,
    );

    expect(result.instructions).not.toContain('<script');
    expect(result.instructions).not.toContain('alert(1)');
  });

  it('refuses a difficulty that is not one of the three', () => {
    const result = applyGuards({ ...goodReply, difficulty: 'trivial' }, input);

    expect(result.suggestions.difficulty).toBeUndefined();
  });

  it('refuses a nonsensical timing rather than storing it', () => {
    for (const cookMinutes of [0, -5, 99_999, 1.5]) {
      const result = applyGuards({ ...goodReply, cookMinutes }, input);
      expect(result.suggestions.cookMinutes, String(cookMinutes)).toBeUndefined();
    }
  });

  it('caps the tags rather than accepting a hundred', () => {
    const tags = Array.from({ length: 100 }, (_, i) => `tag${i}`);
    const result = applyGuards({ ...goodReply, tags }, input);

    expect(result.suggestions.tags?.value.length).toBeLessThanOrEqual(5);
  });

  it('truncates an over-long title instead of rejecting the whole reply', () => {
    const result = applyGuards({ ...goodReply, title: 'x'.repeat(500) }, input);

    expect(result.title.length).toBeLessThanOrEqual(140);
  });
});

describe('a reply that is empty or malformed', () => {
  it('keeps the author\'s ingredients when none come back', () => {
    const result = applyGuards({ ...goodReply, ingredients: [] }, input);

    expect(result.ingredients).toHaveLength(4);
    expect(result.warnings.join(' ')).toContain('no ingredients');
  });

  it("keeps the author's method when no steps come back", () => {
    const result = applyGuards({ ...goodReply, steps: [] }, input);

    expect(result.instructions).toBe(input.instructions);
    expect(result.warnings.join(' ')).toContain('did not return any steps');
  });

  it('survives a reply that is not an object at all', () => {
    for (const reply of [null, undefined, 'nonsense', 42, []]) {
      const result = applyGuards(reply, input);

      expect(result.instructions, String(reply)).toBe(input.instructions);
      expect(result.ingredients, String(reply)).toHaveLength(4);
    }
  });

  it('falls back to the original title rather than emptying it', () => {
    const result = applyGuards({ ...goodReply, title: '   ' }, input);

    expect(result.title).toBe('chicken curry');
  });
});

describe('step numbering', () => {
  /**
   * The model is asked for a list and often numbers it anyway. Those numerals
   * are not quantities, and left in they would be flagged as inventions on
   * every single tidy-up — a guard that cries wolf on correct output stops
   * being read.
   */
  it('is stripped in all the forms a model writes it', () => {
    expect(stripStepNumbering('1. Fry the onions.')).toBe('Fry the onions.');
    expect(stripStepNumbering('2) Add the paste.')).toBe('Add the paste.');
    expect(stripStepNumbering('Step 3: Cook.')).toBe('Cook.');
    expect(stripStepNumbering('12 - Serve.')).toBe('Serve.');
  });

  it('leaves a step that genuinely opens with a quantity alone', () => {
    expect(stripStepNumbering('200 g of flour goes in next.')).toBe('200 g of flour goes in next.');
    expect(stripStepNumbering('2 minutes later, stir.')).toBe('2 minutes later, stir.');
  });

  it('means a numbered reply produces no warnings', () => {
    const result = applyGuards(
      { ...goodReply, steps: ['1. Fry the onions until golden.', '2. Cook for 20 minutes.'] },
      input,
    );

    expect(result.warnings).toEqual([]);
    expect(result.instructions).toContain('<p>Fry the onions until golden.</p>');
  });
});

describe('reading the editor\'s HTML as text for the model', () => {
  it('turns block markup into line breaks rather than running words together', () => {
    expect(htmlToText('<p>Fry the onions.</p><p>Add the paste.</p>')).toBe(
      'Fry the onions.\nAdd the paste.',
    );
  });

  it('decodes the entities the editor writes', () => {
    expect(htmlToText('<p>Salt &amp; pepper</p>')).toBe('Salt & pepper');
  });

  it('drops tags without dropping their contents', () => {
    expect(htmlToText('<p>Fry the <strong>onions</strong>.</p>')).toBe('Fry the onions.');
  });
});
