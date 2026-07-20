import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the one thing about this stylesheet that cannot be seen in review and
 * is not visible in jsdom either: **which rule wins.**
 *
 * The base layer styles bare elements. It was written with selectors like
 * `input[type='search']`, which scores (0,1,1) and therefore silently outranks
 * any single class. Two components had been quietly overruled for as long as
 * they had existed:
 *
 *   - `.search-input` asked for a pill shape and room for the magnifying glass.
 *     It got a rectangle, and the icon sat on top of the placeholder text.
 *   - `.palette-input` asked for no chrome at all — its comment even says
 *     "the row is the field" — and rendered as a bordered, sunken box inside
 *     the row.
 *
 * Nothing errored. The declarations were parsed, applied, and beaten. That is
 * the failure mode this file exists to catch, because a browser is the only
 * other place it shows up and there is no browser in CI.
 *
 * The invariant: a base layer is what you get when nothing else has an opinion,
 * so it must contribute **zero specificity**. `:where()` is how CSS says that.
 */

/**
 * Resolved from the project root, not from `import.meta.url`: under jsdom that
 * is an `http://localhost` URL, not a `file:` one, so the obvious spelling
 * throws. Vitest runs with the package directory as its cwd.
 */
const read = (name: string): string =>
  readFileSync(resolve(process.cwd(), 'src/styles', name), 'utf8');

/** Strips comments so a selector quoted in prose is not read as a rule. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector that opens a rule, one per comma-separated part. */
function selectors(css: string): string[] {
  const found: string[] = [];
  // Skip @media/@supports preludes and declaration blocks; only rule heads.
  for (const match of stripComments(css).matchAll(/([^{}@;]+)\{/g)) {
    const head = match[1]?.trim();
    if (!head) continue;
    // A `:where(a, b)` list contains commas that are not selector boundaries.
    if (head.startsWith(':where(')) {
      found.push(head);
      continue;
    }
    for (const part of head.split(',')) {
      const clean = part.trim();
      if (clean) found.push(clean);
    }
  }
  return found;
}

describe('the base layer does not outrank the components layer', () => {
  const base = read('base.css');

  /**
   * The properties the form-control block sets. Any of them landing on a bare
   * `element[attribute]` selector puts it out of a component class's reach.
   */
  const CHROME = [
    'padding',
    'padding-left',
    'padding-inline',
    'border',
    'border-radius',
    'background',
    'background-color',
    'font-size',
    'width',
  ];

  it('styles form controls through :where(), so a class can still win', () => {
    const block = /:where\(\s*input\[type='text'\][\s\S]*?\)\s*\{/.exec(stripComments(base));

    expect(
      block,
      'the shared form-control rule must stay inside :where() — unwrapping it ' +
        'silently overrules .search-input and .palette-input',
    ).not.toBeNull();
  });

  it('sets chrome only from selectors a single class can still beat', () => {
    const css = stripComments(base);

    const offenders: string[] = [];

    for (const match of css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
      const head = (match[1] ?? '').trim();
      const body = match[2] ?? '';

      const declared = body
        .split(';')
        .map((line) => line.split(':')[0]?.trim() ?? '')
        .filter((property) => CHROME.includes(property));

      if (declared.length === 0) continue;

      /**
       * Checked per comma-separated part, not on the head as a whole.
       *
       * The rule that caused the bug was a *list* — `input[type='text'],
       * input[type='email'], …` — so a check that matched the whole head
       * against a single-selector shape skipped it entirely and passed while
       * the bug was live. Splitting first is what makes this assertion mean
       * what its name says.
       */
      for (const part of head.startsWith(':where(') ? [head] : head.split(',')) {
        const selector = part.trim();
        if (!selector || selector.startsWith(':where(')) continue;

        // State pseudo-classes are meant to outrank the resting style — they
        // describe a moment, not a default.
        if (/:(hover|focus|active|disabled|checked|first|last|nth)/.test(selector)) continue;

        // A named thing — `.skip-link`, `#main-content` — is not a default for
        // an element, and the components layer can match it and win on order.
        // Pseudo-elements address a box nothing else can reach.
        if (/[.#]/.test(selector) || selector.includes('::')) continue;

        // A bare element name is the whole point: (0,0,1), beaten by anything.
        if (/^[a-z][a-z0-9]*$/.test(selector)) continue;

        // What is left is an element carrying an attribute or a structural
        // pseudo-class: at least (0,1,1), out of a single class's reach.
        offenders.push(`${selector} { ${declared.join(', ')} }`);
      }
    }

    expect(offenders, 'these outrank any single class and cannot be overridden').toEqual([]);
  });

  /**
   * Regression for the wobble that prompted the segmented control rewrite.
   *
   * The selected segment was set in a heavier weight than the unselected one,
   * so it measured wider, so every click resized both segments and shifted the
   * row — on a control whose entire job is to stay put. jsdom does not lay text
   * out, so the width itself cannot be measured here. What can be pinned is the
   * cause: the two states must not differ in font weight.
   */
  it('keeps both toggle segments at one type weight', () => {
    const components = stripComments(read('components.css'));

    const selected = /\.view-toggle button\.active\s*\{([^}]*)\}/.exec(components);
    expect(selected, 'the selected-segment rule has moved or been renamed').not.toBeNull();
    expect(selected?.[1]).not.toMatch(/font-weight/);
  });

  it('parses the stylesheets it is asserting about', () => {
    // A positive control. Both assertions above pass vacuously if the regexes
    // stop matching anything at all — which is precisely what happens if the
    // file moves or the reader silently returns ''.
    expect(selectors(base).length).toBeGreaterThan(50);
    expect(selectors(read('components.css')).length).toBeGreaterThan(200);
  });
});
