import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { deriveSteps, ingredientsForStep } from '../lib/recipeSteps';
import { scaleAmount } from '../lib/amount';
import { useWakeLock } from '../hooks/useWakeLock';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useOverlay } from '../context/OverlayContext';
import type { Ingredient } from '../types';

interface CookModeProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  instructions: string;
  ingredients: Ingredient[];
  scaleFactor?: number;
}

/**
 * A full-screen, one-step-at-a-time view built for actually cooking.
 *
 * The constraints of the moment it serves — standing up, phone at arm's length,
 * hands occupied or wet — drive every decision here: large type, one instruction
 * at a time, enormous tap targets, a screen that will not sleep, and swipe as
 * well as tap navigation.
 */
export function CookMode({
  isOpen,
  onClose,
  title,
  instructions,
  ingredients,
  scaleFactor = 1,
}: CookModeProps) {
  const [index, setIndex] = useState(0);
  const touchStart = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const steps = useMemo(() => deriveSteps(instructions), [instructions]);
  const wakeLockHeld = useWakeLock(isOpen);

  useFocusTrap(containerRef, isOpen);
  useOverlay(isOpen);

  /**
   * Clamped for rendering rather than trusted. `index` is only reset when the
   * dialog opens, so if `instructions` change underneath — the author edits the
   * recipe, or a background refetch writes a fresh detail object — a stale index
   * produced "Step 3 of 1", a progress bar at 300% width, an `aria-valuenow`
   * above its own `aria-valuemax`, and a blank step body.
   */
  const safeIndex = Math.min(index, Math.max(0, steps.length - 1));
  const step = steps[safeIndex];
  const stepIngredients = useMemo(
    () => (step ? ingredientsForStep(step, ingredients) : []),
    [step, ingredients],
  );

  useEffect(() => {
    if (isOpen) setIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        setIndex((current) => Math.min(steps.length - 1, current + 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose, steps.length]);

  if (!isOpen) return null;

  if (steps.length === 0) {
    return createPortal(
      <div className="cook-mode" role="dialog" aria-modal="true" aria-label="Cook mode">
        <div className="cook-mode-empty">
          <p>This recipe has no instruction steps to walk through.</p>
          <button type="button" className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  const isFirst = safeIndex === 0;
  const isLast = safeIndex === steps.length - 1;

  return createPortal(
    <div
      className="cook-mode"
      role="dialog"
      aria-modal="true"
      aria-label={`Cook mode: ${title}`}
      ref={containerRef}
      tabIndex={-1}
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        const end = event.changedTouches[0]?.clientX;
        touchStart.current = null;
        if (start === null || end === undefined) return;

        // Deliberately generous: a deliberate swipe with a wet thumb is not a
        // precise gesture, and an accidental step change is cheap to undo.
        const delta = end - start;
        if (Math.abs(delta) < 60) return;
        setIndex((current) =>
          delta < 0 ? Math.min(steps.length - 1, current + 1) : Math.max(0, current - 1),
        );
      }}
    >
      <header className="cook-mode-header">
        <div className="cook-mode-title">
          <h2>{title}</h2>
          {wakeLockHeld && (
            <span className="cook-mode-wakelock" title="Your screen will stay on">
              <Icon name="sun" size={14} />
              <span>Screen stays on</span>
            </span>
          )}
        </div>
        <button type="button" onClick={onClose} className="cook-mode-close" aria-label="Exit cook mode">
          <Icon name="close" size={26} />
        </button>
      </header>

      <div
        className="cook-mode-progress"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={safeIndex + 1}
        aria-label={`Step ${safeIndex + 1} of ${steps.length}`}
      >
        <div
          className="cook-mode-progress-bar"
          style={{ width: `${((safeIndex + 1) / steps.length) * 100}%` }}
        />
      </div>

      <main className="cook-mode-body">
        <p className="cook-mode-counter">
          Step {safeIndex + 1} of {steps.length}
        </p>

        {/* aria-live so each step is read out as it becomes current. */}
        <div className="cook-mode-step" aria-live="polite">
          {step && <div dangerouslySetInnerHTML={{ __html: step.html }} />}
        </div>

        {stepIngredients.length > 0 && (
          <aside className="cook-mode-ingredients">
            <h3>For this step</h3>
            <ul>
              {stepIngredients.map((ingredient, i) => (
                <li key={i}>
                  <strong>{scaleAmount(ingredient.amount, scaleFactor)}</strong> {ingredient.name}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </main>

      <nav className="cook-mode-nav" aria-label="Step navigation">
        <button
          type="button"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          disabled={isFirst}
          className="cook-mode-prev"
        >
          <Icon name="chevron-left" size={24} />
          <span>Back</span>
        </button>

        <ol className="cook-mode-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <li key={i} className={i === safeIndex ? 'is-current' : i < safeIndex ? 'is-done' : ''} />
          ))}
        </ol>

        {isLast ? (
          <button type="button" onClick={onClose} className="cook-mode-next cook-mode-finish">
            <span>Done</span>
            <Icon name="check" size={24} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIndex((current) => Math.min(steps.length - 1, current + 1))}
            className="cook-mode-next"
          >
            <span>Next</span>
            <Icon name="chevron-right" size={24} />
          </button>
        )}
      </nav>
    </div>,
    document.body,
  );
}
