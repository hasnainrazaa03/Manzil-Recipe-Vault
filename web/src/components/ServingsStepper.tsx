import { Icon } from './Icon';

interface ServingsStepperProps {
  /** What the recipe was written for. */
  baseServings: number;
  /** What the reader wants to cook. */
  servings: number;
  onChange: (servings: number) => void;
  min?: number;
  max?: number;
}

/**
 * Adjusts the yield, which rescales every ingredient amount live.
 *
 * The scale factor is shown explicitly ("×1.5") because the amounts change
 * under the reader's eyes; without it, a glance back at the list is ambiguous
 * about whether it is showing original or adjusted quantities.
 */
export function ServingsStepper({
  baseServings,
  servings,
  onChange,
  min = 1,
  max = 100,
}: ServingsStepperProps) {
  const factor = servings / baseServings;
  const isAdjusted = servings !== baseServings;

  return (
    <div className="servings-stepper">
      <span className="servings-label" id="servings-label">
        Servings
      </span>

      <div className="servings-controls" role="group" aria-labelledby="servings-label">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, servings - 1))}
          disabled={servings <= min}
          aria-label="Fewer servings"
        >
          <Icon name="minus" size={18} />
        </button>

        {/* aria-live so the new yield is announced when the buttons change it. */}
        <output className="servings-value" aria-live="polite">
          {servings}
        </output>

        <button
          type="button"
          onClick={() => onChange(Math.min(max, servings + 1))}
          disabled={servings >= max}
          aria-label="More servings"
        >
          <Icon name="plus" size={18} />
        </button>
      </div>

      {isAdjusted && (
        <div className="servings-adjusted">
          <span className="servings-factor">
            ×{Number.isInteger(factor) ? factor : factor.toFixed(2).replace(/\.?0+$/, '')}
          </span>
          <button type="button" className="btn-link btn-sm" onClick={() => onChange(baseServings)}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
