import DOMPurify from 'dompurify';

export interface Step {
  index: number;
  /** Sanitized HTML for the step body. */
  html: string;
  /** Plain text, for the accessible label and for matching ingredients. */
  text: string;
}

/**
 * Derives discrete cooking steps from the stored instruction HTML.
 *
 * Instructions are a single rich-text blob, so there is no `steps` field to
 * read. Splitting on block boundaries gets the same result for every recipe
 * already in the database without a schema change or a migration — the editor
 * only emits paragraphs, list items and headings, so those boundaries are
 * exactly where an author pressed Enter.
 */
export function deriveSteps(instructionsHtml: string): Step[] {
  if (!instructionsHtml.trim()) return [];

  const clean = DOMPurify.sanitize(instructionsHtml);

  // Parsed in an inert document so nothing can execute or load during parsing.
  const parsed = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  if (!root) return [];

  const blocks = Array.from(root.children).filter((element) =>
    ['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE'].includes(element.tagName),
  );

  // A list arrives as a single <ul>/<ol>; its items are the real steps.
  const expanded: Element[] = [];
  for (const child of Array.from(root.children)) {
    if (child.tagName === 'UL' || child.tagName === 'OL') {
      expanded.push(...Array.from(child.children).filter((li) => li.tagName === 'LI'));
    } else if (blocks.includes(child)) {
      expanded.push(child);
    }
  }

  const steps = expanded
    .map((element) => ({
      html: element.innerHTML.trim(),
      text: (element.textContent ?? '').trim(),
    }))
    .filter((step) => step.text.length > 0)
    .map((step, index) => ({ ...step, index }));

  // One unbroken paragraph is still one step — better than showing nothing.
  if (steps.length === 0) {
    const text = (root.textContent ?? '').trim();
    return text ? [{ index: 0, html: clean, text }] : [];
  }

  return steps;
}

/**
 * Ingredients whose name appears in a step, so cook mode can show what is
 * needed right now. Deliberately a simple substring match on the longest word
 * of the ingredient name: a fuzzy matcher that guesses wrong is more annoying
 * than one that occasionally shows nothing.
 */
export function ingredientsForStep(
  step: Step,
  ingredients: { amount: string; name: string }[],
): { amount: string; name: string }[] {
  const haystack = step.text.toLowerCase();

  return ingredients.filter((ingredient) => {
    const name = ingredient.name.toLowerCase().trim();
    if (name.length < 3) return false;
    if (haystack.includes(name)) return true;

    // "plain flour" should match a step that says "flour".
    const words = name.split(/\s+/).filter((word) => word.length >= 4);
    return words.some((word) => haystack.includes(word));
  });
}
