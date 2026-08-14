import { useState, useEffect } from 'react';

// Viewport queries as state.
//
// The dashboard's mobile layout is not the desktop one at a smaller size — the
// sidebar becomes a drawer, the inbox becomes one pane at a time, and a tab bar
// appears. Those are different component trees, not different CSS, so the
// breakpoint has to be readable from JS rather than living only in a media
// query.
//
// Written with addEventListener('change') rather than the deprecated
// addListener, and with the initial value read synchronously so the first paint
// is already the right layout — a dashboard that renders desktop chrome and
// then snaps to mobile on hydration reads as a bug.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    // Re-read on subscribe: `query` may have changed since the initial state
    // was computed, and between render and effect the viewport may have moved.
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// The one breakpoint the dashboard shell switches on. Named so the drawer, the
// tab bar and the pages that reflow all agree on where "mobile" starts —
// three components disagreeing by 40px is how you get a tab bar over a
// sidebar.
export const MOBILE_QUERY = '(max-width: 860px)';

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
