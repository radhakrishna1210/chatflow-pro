import { useEffect, useRef } from 'react';

// Runs `fn` now and then every `intervalMs`, the way every poll in the app
// should:
//   - skipped while the tab is hidden, and run once as soon as it is visible
//     again, so a background tab costs nothing and is fresh when looked at;
//   - never overlapping: a tick that arrives while the previous call is still
//     in flight is dropped rather than racing it (an older response landing
//     after a newer one is how a just-sent message flickers away);
//   - `enabled: false` stops it entirely (a finished campaign, a super admin
//     with no workspace).
// `fn` may return a promise; the latest `fn` is always the one called, so
// callers do not need to memoise it.
export function usePolling(fn, intervalMs, { enabled = true, immediate = true } = {}) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return undefined;
    let inFlight = false;
    let stopped = false;

    const tick = async () => {
      if (stopped || inFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      inFlight = true;
      try { await fnRef.current(); } catch { /* the caller owns its own error state */ }
      finally { inFlight = false; }
    };

    if (immediate) tick();
    const iv = setInterval(tick, intervalMs);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled, immediate]);
}
