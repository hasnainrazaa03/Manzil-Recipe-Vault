import { useEffect, useRef, useState } from 'react';

/**
 * A sticky title bar that appears once the recipe's own heading has scrolled
 * away, with a progress bar showing how far through the page you are.
 *
 * Recipe pages are long, and the two things you lose on the way down are what
 * you are reading and how much is left. Both come back for the cost of one
 * scroll listener.
 */
export function ReadingProgress({ title }: { title: string }) {
  const [progress, setProgress] = useState(0);
  const [showTitle, setShowTitle] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const measure = () => {
      frame.current = null;

      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0);

      // Revealed only once the real <h1> is off-screen, so the title is never
      // shown twice at once.
      const heading = document.querySelector('.recipe-detail-header h1');
      setShowTitle(heading ? heading.getBoundingClientRect().bottom < 0 : false);
    };

    // Coalesced to one measurement per frame; scroll fires far faster than that.
    const onScroll = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  return (
    <div className={`reading-progress ${showTitle ? 'is-visible' : ''}`} aria-hidden="true">
      <div className="reading-progress-title">{title}</div>
      <div className="reading-progress-bar" style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
