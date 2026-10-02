import { useEffect } from 'react';

// Keeps Tab/Shift+Tab cycling within a modal instead of escaping to the page
// behind it, and moves focus into it when it opens — unless something inside
// already took focus (an autoFocus input), which is the better target.
export const useFocusTrap = (containerRef, isActive) => {
  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    const container = containerRef.current;
    const focusable = () => container.querySelectorAll(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'
    );
    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const els = focusable();
      if (els.length === 0) { e.preventDefault(); return; }
      if (e.shiftKey) {
        if (document.activeElement === els[0]) { e.preventDefault(); els[els.length - 1].focus(); }
      } else {
        if (document.activeElement === els[els.length - 1]) { e.preventDefault(); els[0].focus(); }
      }
    };
    container.addEventListener('keydown', onKeyDown);
    const raf = requestAnimationFrame(() => {
      if (container.contains(document.activeElement)) return;
      const f = focusable()[0];
      if (f) f.focus();
    });
    return () => { cancelAnimationFrame(raf); container.removeEventListener('keydown', onKeyDown); };
  }, [isActive, containerRef]);
};
