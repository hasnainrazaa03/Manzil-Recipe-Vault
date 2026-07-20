import { useState } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import type { Difficulty, TidyResult } from '../types';

interface TidyReviewProps {
  isOpen: boolean;
  proposal: TidyResult | null;
  /** What is currently in the form, shown beside the proposal for comparison. */
  current: { ingredients: { amount: string; name: string }[]; instructions: string };
  onClose: () => void;
  onApply: (accepted: AcceptedTidy) => void;
}

/** Exactly what the author agreed to, field by field. */
export interface AcceptedTidy {
  title: string;
  overview: string;
  ingredients: { amount: string; name: string }[];
  instructions: string;
  suggestions: {
    cuisine?: string;
    difficulty?: Difficulty;
    tags?: string[];
    prepMinutes?: number;
    cookMinutes?: number;
    servings?: number;
  };
}

type SuggestionKey = keyof TidyResult['suggestions'];

const SUGGESTION_LABELS: Record<SuggestionKey, string> = {
  cuisine: 'Cuisine',
  difficulty: 'Difficulty',
  tags: 'Tags',
  prepMinutes: 'Prep time',
  cookMinutes: 'Cook time',
  servings: 'Serves',
};

const formatSuggestion = (key: SuggestionKey, value: unknown): string => {
  if (Array.isArray(value)) return value.join(', ');
  if (key === 'prepMinutes' || key === 'cookMinutes') return `${String(value)} min`;
  return String(value);
};

/** Turns the editor's HTML back into readable lines for the preview. */
function toLines(html: string): string[] {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Shows what the assistant proposes, next to what the author wrote, and applies
 * only what they tick.
 *
 * The whole feature rests on this screen. A model rewriting someone's recipe is
 * only acceptable if the author sees the result before it is theirs — so the
 * proposal is never applied on arrival, the original stays on screen beside it,
 * and every inferred field is a separate, individually rejectable checkbox
 * rather than part of one "accept" button.
 *
 * Warnings from the server are shown first and cannot be dismissed. They are the
 * places the assistant tried to invent something and was stopped, which is
 * exactly the information an author needs before trusting the rest of it.
 */
export function TidyReview({ isOpen, proposal, current, onClose, onApply }: TidyReviewProps) {
  /**
   * Suggestions start *unticked*.
   *
   * Defaulting them on would mean a distracted author accepts a guessed cuisine
   * and cook time by pressing the obvious button — which is the same outcome as
   * not asking, reached more slowly. Opting in is one extra click and makes the
   * guess a decision.
   */
  const [accepted, setAccepted] = useState<Set<SuggestionKey>>(new Set());

  if (!proposal) return null;

  const suggestionKeys = (Object.keys(proposal.suggestions) as SuggestionKey[]).filter(
    (key) => proposal.suggestions[key] !== undefined,
  );

  const toggle = (key: SuggestionKey) => {
    setAccepted((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleApply = () => {
    const suggestions: AcceptedTidy['suggestions'] = {};

    for (const key of accepted) {
      const suggestion = proposal.suggestions[key];
      if (!suggestion) continue;
      // Each branch is written out so the value keeps its type; a loop with a
      // dynamic key here erases straight back to `unknown`.
      if (key === 'cuisine') suggestions.cuisine = proposal.suggestions.cuisine?.value;
      if (key === 'difficulty') suggestions.difficulty = proposal.suggestions.difficulty?.value;
      if (key === 'tags') suggestions.tags = proposal.suggestions.tags?.value;
      if (key === 'prepMinutes') suggestions.prepMinutes = proposal.suggestions.prepMinutes?.value;
      if (key === 'cookMinutes') suggestions.cookMinutes = proposal.suggestions.cookMinutes?.value;
      if (key === 'servings') suggestions.servings = proposal.suggestions.servings?.value;
    }

    onApply({
      title: proposal.title,
      overview: proposal.overview,
      ingredients: proposal.ingredients.map(({ amount, name }) => ({ amount, name })),
      instructions: proposal.instructions,
      suggestions,
    });
  };

  const beforeSteps = toLines(current.instructions);
  const afterSteps = toLines(proposal.instructions);
  const methodUnchanged = proposal.instructions === current.instructions;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Review the tidied recipe" size="wide">
      <div className="tidy-review">
        {proposal.warnings.length > 0 && (
          <div className="tidy-warnings" role="alert">
            <Icon name="warning" size={18} aria-hidden="true" />
            <div>
              <p className="tidy-warnings-title">Some things were left to you</p>
              <ul>
                {proposal.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <p className="tidy-intro">
          Nothing is saved yet. Check the tidied version below, then apply it or discard it.
        </p>

        <section className="tidy-section" aria-labelledby="tidy-ingredients-heading">
          <h3 id="tidy-ingredients-heading">Ingredients</h3>
          <div className="tidy-columns">
            <div className="tidy-column">
              <h4 className="tidy-column-title">You wrote</h4>
              <ul className="tidy-list">
                {current.ingredients
                  .filter((ingredient) => `${ingredient.amount}${ingredient.name}`.trim() !== '')
                  .map((ingredient, index) => (
                    <li key={`${ingredient.name}-${index}`}>
                      {`${ingredient.amount} ${ingredient.name}`.trim()}
                    </li>
                  ))}
              </ul>
            </div>

            <div className="tidy-column tidy-column--after">
              <h4 className="tidy-column-title">Tidied</h4>
              <ul className="tidy-list">
                {proposal.ingredients.map((ingredient, index) => (
                  <li key={`${ingredient.name}-${index}`}>
                    <span className="tidy-amount">{ingredient.amount || '—'}</span>
                    <span>{ingredient.name}</span>
                    {ingredient.amountRemoved && (
                      <span className="tidy-flag" title="The assistant guessed an amount here, so it was removed">
                        amount removed
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="tidy-section" aria-labelledby="tidy-method-heading">
          <h3 id="tidy-method-heading">Method</h3>
          {methodUnchanged ? (
            <p className="tidy-unchanged">Your method was kept exactly as you typed it.</p>
          ) : (
            <div className="tidy-columns">
              <div className="tidy-column">
                <h4 className="tidy-column-title">You wrote</h4>
                <ol className="tidy-list tidy-list--steps">
                  {beforeSteps.map((step, index) => (
                    <li key={`${index}-${step.slice(0, 12)}`}>{step}</li>
                  ))}
                </ol>
              </div>
              <div className="tidy-column tidy-column--after">
                <h4 className="tidy-column-title">Tidied</h4>
                <ol className="tidy-list tidy-list--steps">
                  {afterSteps.map((step, index) => (
                    <li key={`${index}-${step.slice(0, 12)}`}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>

        {suggestionKeys.length > 0 && (
          <section className="tidy-section" aria-labelledby="tidy-guesses-heading">
            <h3 id="tidy-guesses-heading">Guesses</h3>
            <p className="tidy-guess-note">
              These were not in what you wrote — the assistant worked them out from the dish. Tick
              any you agree with.
            </p>
            <ul className="tidy-guesses">
              {suggestionKeys.map((key) => (
                <li key={key}>
                  <label className="tidy-guess">
                    <input
                      type="checkbox"
                      checked={accepted.has(key)}
                      onChange={() => toggle(key)}
                    />
                    <span className="tidy-guess-label">{SUGGESTION_LABELS[key]}</span>
                    <span className="tidy-guess-value">
                      {formatSuggestion(key, proposal.suggestions[key]?.value)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="tidy-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Discard
          </button>
          <button type="button" className="btn-primary" onClick={handleApply}>
            Apply to the form
          </button>
        </div>
      </div>
    </Modal>
  );
}
