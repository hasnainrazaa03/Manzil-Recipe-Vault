import { useEffect, useState } from 'react';
import { Icon } from './Icon';

/** Appears once the page has scrolled far enough for the top to be a trek. */
export function ScrollToTop({ threshold = 800 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="scroll-to-top"
      aria-label="Scroll back to top"
      onClick={() => {
        // `matchMedia` rather than a CSS transition, because this is a
        // scripted scroll and CSS cannot veto it.
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      }}
    >
      <Icon name="arrow-up" size={20} />
    </button>
  );
}
