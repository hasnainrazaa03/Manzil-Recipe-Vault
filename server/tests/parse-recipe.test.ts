import { describe, expect, it } from 'vitest';
import {
  parseDuration,
  parseRecipeFromHtml,
  parseServings,
  splitIngredient,
} from '../src/lib/parseRecipe.js';

/**
 * schema.org JSON-LD extraction (`src/lib/parseRecipe.ts`).
 *
 * Two properties run through everything here. The first is that a page's markup
 * is user input: it is sanitised exactly as if it had been typed into the form,
 * because from the database's point of view it was. The second is that a
 * half-filled form is worse than an honest failure — when the parser is not
 * confident, it returns `null` or leaves a field empty rather than guessing.
 */

const SOURCE = 'https://cooking.example.com/recipes/dal';

/**
 * Wraps JSON-LD in a page the way a real site ships it.
 *
 * `<` is escaped as `<`, which is what every serialiser that emits JSON
 * into a `<script>` does — without it a payload containing `</script>` closes
 * the block early, and an XSS test would "pass" only because the parser never
 * saw the payload at all.
 */
function page(jsonLd: unknown, extraHead = ''): string {
  const body = (typeof jsonLd === 'string' ? jsonLd : JSON.stringify(jsonLd)).replace(
    /</g,
    '\\u003c',
  );
  return `<!doctype html><html><head>${extraHead}<script type="application/ld+json">${body}</script></head><body><h1>ignored</h1></body></html>`;
}

/** A realistic page: everything nested, every field in a different shape. */
const REALISTIC = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Example Cooking' },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', name: 'Dinner' }] },
    {
      '@type': ['Recipe', 'Article'],
      name: 'Tarka Dal',
      description: 'A weeknight dal finished with a sizzling tarka.',
      image: ['https://cdn.example.com/dal.jpg', 'https://cdn.example.com/dal-2.jpg'],
      recipeYield: ['4', '4 servings'],
      prepTime: 'PT15M',
      cookTime: 'PT1H30M',
      totalTime: 'PT1H45M',
      recipeCuisine: 'Pakistani',
      recipeCategory: 'Main course',
      keywords: 'dal, lentils, vegetarian, weeknight',
      recipeIngredient: [
        '250 g red lentils',
        '2 tbsp ghee',
        '3 cloves garlic, sliced',
        '1 1/2 tsp cumin seeds',
        'salt to taste',
      ],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Rinse the lentils until the water runs clear.' },
        {
          '@type': 'HowToSection',
          name: 'For the tarka',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Heat the ghee until it shimmers.' },
            { '@type': 'HowToStep', text: 'Fry the cumin and garlic for thirty seconds.' },
          ],
        },
        { '@type': 'HowToStep', text: 'Pour the tarka over the dal and serve.' },
      ],
    },
  ],
};

describe('parseRecipeFromHtml — a realistic page', () => {
  const html = page(REALISTIC, '<meta property="og:site_name" content="Example Cooking" />');
  const recipe = parseRecipeFromHtml(html, SOURCE);

  it('finds the Recipe nested inside @graph', () => {
    expect(recipe).not.toBeNull();
    expect(recipe?.title).toBe('Tarka Dal');
  });

  it('maps the plain text fields', () => {
    expect(recipe?.overview).toBe('A weeknight dal finished with a sizzling tarka.');
    expect(recipe?.cuisine).toBe('Pakistani');
  });

  it('takes the first image', () => {
    expect(recipe?.image).toBe('https://cdn.example.com/dal.jpg');
  });

  it('reads recipeYield given as an array', () => {
    expect(recipe?.servings).toBe(4);
  });

  it('converts ISO durations to minutes', () => {
    expect(recipe?.prepMinutes).toBe(15);
    expect(recipe?.cookMinutes).toBe(90);
  });

  it('splits the ingredients into amount and name', () => {
    expect(recipe?.ingredients).toEqual([
      { amount: '250 g', name: 'red lentils' },
      { amount: '2 tbsp', name: 'ghee' },
      { amount: '3 cloves', name: 'garlic, sliced' },
      { amount: '1 1/2 tsp', name: 'cumin seeds' },
      { amount: '', name: 'salt to taste' },
    ]);
  });

  it('flattens HowToStep and nested HowToSection into ordered paragraphs', () => {
    expect(recipe?.instructions).toBe(
      '<p>Rinse the lentils until the water runs clear.</p>' +
        '<p>Heat the ghee until it shimmers.</p>' +
        '<p>Fry the cumin and garlic for thirty seconds.</p>' +
        '<p>Pour the tarka over the dal and serve.</p>',
    );
  });

  it('splits comma-separated keywords and folds in the category', () => {
    expect(recipe?.tags).toEqual([
      'main course',
      'dal',
      'lentils',
      'vegetarian',
      'weeknight',
    ]);
  });

  it('attributes the source', () => {
    expect(recipe?.sourceUrl).toBe(SOURCE);
    expect(recipe?.sourceName).toBe('Example Cooking');
  });

  it('falls back to the hostname when there is no og:site_name', () => {
    const bare = parseRecipeFromHtml(page(REALISTIC), 'https://www.cooking.example.com/x');
    expect(bare?.sourceName).toBe('cooking.example.com');
  });
});

describe('parseRecipeFromHtml — the three JSON-LD shapes', () => {
  const recipeNode = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Chana Chaat',
    recipeInstructions: 'Toss everything together.',
  };

  it('finds a Recipe at the top level', () => {
    expect(parseRecipeFromHtml(page(recipeNode), SOURCE)?.title).toBe('Chana Chaat');
  });

  // W6-1: a top-level JSON-LD array is never searched. See tests/FINDINGS-WAVE5.md.
  it.skip('finds a Recipe inside a bare array', () => {
    const html = page([{ '@type': 'Organization', name: 'Someone' }, recipeNode]);
    expect(parseRecipeFromHtml(html, SOURCE)?.title).toBe('Chana Chaat');
  });

  it('currently misses a Recipe in a top-level array (W6-1, documenting the bug)', () => {
    // Pinned so the day `findRecipeNode` learns to descend into a nested array
    // this fails and the skipped test above can be turned back on.
    const html = page([{ '@type': 'Organization', name: 'Someone' }, recipeNode]);
    expect(parseRecipeFromHtml(html, SOURCE)).toBeNull();
  });

  it('finds a Recipe in a single-element array when the site ships it as its own block', () => {
    // The same recipe split across two blocks *is* found, because each block is
    // an element of the list `findRecipeNode` iterates.
    const html =
      '<html><head>' +
      `<script type="application/ld+json">${JSON.stringify({ '@type': 'Organization' })}</script>` +
      `<script type="application/ld+json">${JSON.stringify(recipeNode)}</script>` +
      '</head></html>';
    expect(parseRecipeFromHtml(html, SOURCE)?.title).toBe('Chana Chaat');
  });

  it('finds a Recipe inside @graph', () => {
    const html = page({ '@context': 'https://schema.org', '@graph': [recipeNode] });
    expect(parseRecipeFromHtml(html, SOURCE)?.title).toBe('Chana Chaat');
  });

  it('matches @type case-insensitively and through an array of types', () => {
    const html = page({ ...recipeNode, '@type': ['CreativeWork', 'recipe'] });
    expect(parseRecipeFromHtml(html, SOURCE)?.title).toBe('Chana Chaat');
  });
});

describe('parseRecipeFromHtml — honest failure', () => {
  it('returns null when the page has no JSON-LD at all', () => {
    expect(parseRecipeFromHtml('<html><body><h1>A recipe, in prose</h1></body></html>', SOURCE))
      .toBeNull();
  });

  it('returns null when the JSON-LD contains no Recipe', () => {
    const html = page({ '@type': 'Article', name: 'How I felt about dinner' });
    expect(parseRecipeFromHtml(html, SOURCE)).toBeNull();
  });

  it('returns null when the title is missing', () => {
    const html = page({ '@type': 'Recipe', recipeInstructions: 'Stir.' });
    expect(parseRecipeFromHtml(html, SOURCE)).toBeNull();
  });

  it('returns null when the title is only markup that sanitises away', () => {
    const html = page({ '@type': 'Recipe', name: '<script>x</script>', recipeInstructions: 'Stir.' });
    expect(parseRecipeFromHtml(html, SOURCE)).toBeNull();
  });

  it('returns null when the instructions are missing', () => {
    const html = page({ '@type': 'Recipe', name: 'Nameless Method' });
    expect(parseRecipeFromHtml(html, SOURCE)).toBeNull();
  });

  it('returns null when the instructions are an empty list', () => {
    const html = page({ '@type': 'Recipe', name: 'Nothing', recipeInstructions: [] });
    expect(parseRecipeFromHtml(html, SOURCE)).toBeNull();
  });

  it('returns null for an entirely empty page', () => {
    expect(parseRecipeFromHtml('', SOURCE)).toBeNull();
  });

  it('survives malformed JSON in one block and still finds the Recipe in another', () => {
    const html =
      '<html><head>' +
      '<script type="application/ld+json">{ "broken": , }</script>' +
      '<script type="application/ld+json">' +
      JSON.stringify({ '@type': 'Recipe', name: 'Kheer', recipeInstructions: 'Simmer.' }) +
      '</script>' +
      '</head></html>';

    expect(parseRecipeFromHtml(html, SOURCE)?.title).toBe('Kheer');
  });

  it('accepts a recipe with only the two required fields', () => {
    const html = page({ '@type': 'Recipe', name: 'Toast', recipeInstructions: 'Toast it.' });
    const recipe = parseRecipeFromHtml(html, SOURCE);

    expect(recipe).toMatchObject({
      title: 'Toast',
      overview: '',
      image: '',
      ingredients: [],
      tags: [],
      servings: null,
      prepMinutes: null,
      cookMinutes: null,
      cuisine: '',
    });
  });
});

describe('parseRecipeFromHtml — untrusted markup', () => {
  const hostile = {
    '@type': 'Recipe',
    name: 'Cake <script>alert(1)</script>',
    description: '<img src=x onerror="fetch(\'//evil.example\')"> lovely cake',
    recipeInstructions: [
      { '@type': 'HowToStep', text: 'Mix <script>steal()</script> well' },
      { '@type': 'HowToStep', text: '<a href="javascript:alert(1)" onclick="go()">Bake</a>' },
    ],
    recipeIngredient: ['200 g flour<script>steal()</script>'],
    recipeCuisine: '<svg onload=alert(1)>British',
    keywords: '<b onmouseover=x>cake</b>',
  };

  const recipe = parseRecipeFromHtml(page(hostile), SOURCE);
  const serialised = JSON.stringify(recipe);

  it('parses the page rather than rejecting it outright', () => {
    expect(recipe).not.toBeNull();
  });

  it('leaves no <script> anywhere in the output', () => {
    expect(serialised).not.toMatch(/<script/i);
    expect(serialised).not.toContain('alert(1)');
  });

  it('leaves no event handler attribute anywhere in the output', () => {
    expect(serialised).not.toMatch(/onerror\s*=/i);
    expect(serialised).not.toMatch(/onload\s*=/i);
    expect(serialised).not.toMatch(/onclick\s*=/i);
    expect(serialised).not.toMatch(/onmouseover\s*=/i);
    expect(serialised).not.toMatch(/javascript:/i);
  });

  it('strips the script from the title but keeps the readable part', () => {
    expect(recipe?.title).toBe('Cake');
  });

  it('strips the img tag from the description', () => {
    expect(recipe?.overview).toBe('lovely cake');
    expect(recipe?.overview).not.toContain('<');
  });

  it('escapes what survives into the instructions rather than re-emitting it', () => {
    expect(recipe?.instructions).not.toContain('<script');
    expect(recipe?.instructions).toContain('Mix');
    expect(recipe?.instructions).toContain('Bake');
    // Only paragraphs — the shape the editor itself produces.
    expect(recipe?.instructions.replace(/<\/?p>/g, '')).not.toMatch(/<[a-z]/i);
  });

  it('cleans the remaining fields too', () => {
    // The `<svg onload=...>` wrapper takes its own text content with it, which
    // is a fine outcome: an empty cuisine is not a vector.
    expect(recipe?.cuisine).not.toMatch(/[<>]|alert/);
    expect(recipe?.tags).toEqual(['cake']);
    expect(recipe?.ingredients).toEqual([{ amount: '200 g', name: 'flour' }]);
  });
});

describe('parseRecipeFromHtml — images', () => {
  const withImage = (image: unknown) =>
    parseRecipeFromHtml(
      page({ '@type': 'Recipe', name: 'X', recipeInstructions: 'Do it.', image }),
      SOURCE,
    )?.image;

  it('keeps an https image', () => {
    expect(withImage('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
  });

  it('drops a plain http image', () => {
    expect(withImage('http://cdn.example.com/a.jpg')).toBe('');
  });

  it('drops a data: image', () => {
    expect(withImage('data:image/png;base64,AAAA')).toBe('');
  });

  it('drops a javascript: image', () => {
    expect(withImage('javascript:alert(1)')).toBe('');
  });

  it('drops a relative path it cannot verify', () => {
    expect(withImage('/images/a.jpg')).toBe('');
  });

  it('reads an ImageObject wrapper', () => {
    expect(withImage({ '@type': 'ImageObject', url: 'https://cdn.example.com/b.jpg' })).toBe(
      'https://cdn.example.com/b.jpg',
    );
  });
});

describe('splitIngredient', () => {
  const cases: [string, string, string][] = [
    // input, amount, name
    ['500 g plain flour', '500 g', 'plain flour'],
    ['2 tbsp olive oil', '2 tbsp', 'olive oil'],
    ['3 cloves garlic', '3 cloves', 'garlic'],
    ['1 1/2 tsp salt', '1 1/2 tsp', 'salt'],
    ['1/2 cup milk', '1/2 cup', 'milk'],
    ['¾ cup sugar', '¾ cup', 'sugar'],
    ['½ onion, diced', '½', 'onion, diced'],
    ['2-3 cloves garlic', '2-3 cloves', 'garlic'],
    ['2 – 3 tbsp water', '2 – 3 tbsp', 'water'],
    ['1.5 kg lamb shoulder', '1.5 kg', 'lamb shoulder'],
    ['4 eggs', '4', 'eggs'],
    ['1 pinch saffron', '1 pinch', 'saffron'],
    ['2 tins chopped tomatoes', '2 tins', 'chopped tomatoes'],
  ];

  for (const [input, amount, name] of cases) {
    it(`splits "${input}"`, () => {
      expect(splitIngredient(input)).toEqual({ amount, name });
    });
  }

  /**
   * The important half. When the amount cannot be read confidently the whole
   * line has to survive in the name — mangling it loses information the cook
   * needs, and a wrong amount silently breaks scaling.
   */
  const unparseable = [
    'salt to taste',
    'freshly ground black pepper',
    'a handful of coriander',
    'juice of one lemon',
    'olive oil, for frying',
  ];

  for (const line of unparseable) {
    it(`keeps "${line}" whole with an empty amount`, () => {
      expect(splitIngredient(line)).toEqual({ amount: '', name: line });
    });
  }

  it('normalises runaway whitespace', () => {
    expect(splitIngredient('  200   g   plain    flour \n')).toEqual({
      amount: '200 g',
      name: 'plain flour',
    });
  });

  it('strips markup out of an ingredient line', () => {
    expect(splitIngredient('200 g <b>flour</b>')).toEqual({ amount: '200 g', name: 'flour' });
  });

  it('returns two empty strings for an empty line', () => {
    expect(splitIngredient('')).toEqual({ amount: '', name: '' });
    expect(splitIngredient('   ')).toEqual({ amount: '', name: '' });
  });

  it('bounds a very long line rather than storing it whole', () => {
    const result = splitIngredient(`2 tbsp ${'x'.repeat(500)}`);
    expect(result.name.length).toBeLessThanOrEqual(120);
    expect(result.amount).toBe('2 tbsp');
  });

  it('never loses the text of a line, whatever it does with the amount', () => {
    // The invariant that actually matters: amount + name reconstructs the input.
    for (const line of [...cases.map(([input]) => input), ...unparseable, '500 g']) {
      const { amount, name } = splitIngredient(line);
      expect(`${amount} ${name}`.replace(/\s+/g, ' ').trim()).toBe(
        line.replace(/\s+/g, ' ').trim(),
      );
    }
  });
});

describe('parseDuration', () => {
  it('reads hours and minutes', () => {
    expect(parseDuration('PT1H30M')).toBe(90);
  });

  it('reads minutes alone', () => {
    expect(parseDuration('PT45M')).toBe(45);
  });

  it('reads hours alone', () => {
    expect(parseDuration('PT2H')).toBe(120);
  });

  it('reads a day', () => {
    expect(parseDuration('P1D')).toBe(1440);
  });

  it('ignores a seconds component', () => {
    expect(parseDuration('PT10M30S')).toBe(10);
  });

  it('accepts a lowercase duration', () => {
    expect(parseDuration('pt45m')).toBe(45);
  });

  it('reads a duration wrapped in the usual schema.org shapes', () => {
    expect(parseDuration(['PT20M'])).toBe(20);
    expect(parseDuration({ '@value': 'PT20M' })).toBe(20);
  });

  const rejected: [string, unknown][] = [
    ['over the 1440-minute cap', 'PT25H'],
    ['a two-day marinade', 'P2D'],
    ['a week', 'P7D'],
    ['zero', 'PT0M'],
    ['prose', '30 minutes'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 45],
    ['a malformed duration', 'PTX'],
    ['a bare P', 'P'],
  ];

  for (const [label, value] of rejected) {
    it(`returns null for ${label}`, () => {
      expect(parseDuration(value)).toBeNull();
    });
  }

  it('accepts exactly the cap', () => {
    expect(parseDuration('PT1440M')).toBe(1440);
  });
});

describe('parseServings', () => {
  it('reads a bare number', () => {
    expect(parseServings('4')).toBe(4);
  });

  it('reads "Serves 6"', () => {
    expect(parseServings('Serves 6')).toBe(6);
  });

  it('reads "about 8 portions"', () => {
    expect(parseServings('about 8 portions')).toBe(8);
  });

  it('reads the first entry of an array', () => {
    expect(parseServings(['4', '4 servings'])).toBe(4);
  });

  it('reads an @value wrapper', () => {
    expect(parseServings({ '@type': 'QuantitativeValue', '@value': '12' })).toBe(12);
  });

  // W6-2: `QuantitativeValue.value` is not one of the keys `firstString` looks at.
  it.skip('reads a QuantitativeValue wrapper', () => {
    expect(parseServings({ '@type': 'QuantitativeValue', value: '12' })).toBe(12);
  });

  const rejected: [string, unknown][] = [
    ['prose with no number', 'lots'],
    ['an empty string', ''],
    ['null', null],
    ['zero', '0'],
    ['a number beyond the cap', '500'],
  ];

  for (const [label, value] of rejected) {
    it(`returns null for ${label}`, () => {
      expect(parseServings(value)).toBeNull();
    });
  }
});

describe('parseRecipeFromHtml — timings', () => {
  const timed = (fields: Record<string, unknown>) =>
    parseRecipeFromHtml(
      page({ '@type': 'Recipe', name: 'X', recipeInstructions: 'Do it.', ...fields }),
      SOURCE,
    );

  it('keeps prep and cook when both are given', () => {
    const recipe = timed({ prepTime: 'PT10M', cookTime: 'PT20M', totalTime: 'PT30M' });
    expect(recipe?.prepMinutes).toBe(10);
    expect(recipe?.cookMinutes).toBe(20);
  });

  it('uses the total as cook time when neither prep nor cook is given', () => {
    const recipe = timed({ totalTime: 'PT40M' });
    expect(recipe?.prepMinutes).toBeNull();
    expect(recipe?.cookMinutes).toBe(40);
  });

  it('does not double-count the total when a prep time is known', () => {
    const recipe = timed({ prepTime: 'PT10M', totalTime: 'PT40M' });
    expect(recipe?.prepMinutes).toBe(10);
    expect(recipe?.cookMinutes).toBeNull();
  });

  it('leaves both null when nothing usable is published', () => {
    const recipe = timed({ prepTime: 'quick', cookTime: '', totalTime: 'P9D' });
    expect(recipe?.prepMinutes).toBeNull();
    expect(recipe?.cookMinutes).toBeNull();
  });
});

describe('parseRecipeFromHtml — bounds', () => {
  it('caps the ingredient list', () => {
    const html = page({
      '@type': 'Recipe',
      name: 'Long',
      recipeInstructions: 'Do it.',
      recipeIngredient: Array.from({ length: 300 }, (_, i) => `${i + 1} g thing`),
    });

    expect(parseRecipeFromHtml(html, SOURCE)?.ingredients).toHaveLength(100);
  });

  it('caps and deduplicates tags', () => {
    const html = page({
      '@type': 'Recipe',
      name: 'Tagged',
      recipeInstructions: 'Do it.',
      keywords: [...Array.from({ length: 40 }, (_, i) => `tag${i}`), 'tag0', 'TAG1'].join(','),
    });

    const tags = parseRecipeFromHtml(html, SOURCE)?.tags ?? [];
    expect(tags).toHaveLength(12);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('truncates an over-long title rather than rejecting the recipe', () => {
    const html = page({
      '@type': 'Recipe',
      name: 'A'.repeat(400),
      recipeInstructions: 'Do it.',
    });

    expect(parseRecipeFromHtml(html, SOURCE)?.title).toHaveLength(140);
  });

  it('does not recurse forever on a self-referential graph', () => {
    // Depth is bounded at 6; a deeply buried Recipe is simply not found rather
    // than costing the process a stack.
    let nested: Record<string, unknown> = {
      '@type': 'Recipe',
      name: 'Buried',
      recipeInstructions: 'Dig.',
    };
    for (let i = 0; i < 20; i += 1) nested = { '@type': 'Thing', '@graph': [nested] };

    expect(parseRecipeFromHtml(page(nested), SOURCE)).toBeNull();
  });
});
