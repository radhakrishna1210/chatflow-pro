// Motion helpers for JS-driven animation.
//
// The CSS tokens in index.css are the source of truth; these read them rather
// than restating the numbers, so a change to the system reaches JS too. Under
// prefers-reduced-motion the tokens collapse to 0ms, which means every helper
// here degrades automatically without a branch.

const readToken = (name, fallback) => {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ms = /^([\d.]+)ms$/.exec(v);
  if (ms) return Number(ms[1]);
  const s = /^([\d.]+)s$/.exec(v);
  if (s) return Number(s[1]) * 1000;
  return fallback;
};

export const duration = {
  get instant() { return readToken('--dur-instant', 90); },
  get fast() { return readToken('--dur-fast', 150); },
  get normal() { return readToken('--dur-normal', 240); },
  get slow() { return readToken('--dur-slow', 420); },
};

export const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Applies a one-shot animation class and removes it when finished, so the
 * element can be animated again later. Returns a cleanup function.
 *
 * Under reduced motion this is a no-op: the class is never added, so nothing
 * flickers and nothing has to be cleaned up.
 */
export function playOnce(el, className, ms = duration.normal) {
  if (!el || prefersReducedMotion()) return () => {};
  el.classList.add(className);
  const timer = setTimeout(() => el.classList.remove(className), ms + 60);
  return () => { clearTimeout(timer); el.classList.remove(className); };
}

/**
 * Staggered delays for a list, capped so a long list does not leave the last
 * row waiting seconds to appear. Returns a style object.
 */
export function stagger(index, { step = 40, max = 6 } = {}) {
  if (prefersReducedMotion()) return {};
  return { animationDelay: `${Math.min(index, max) * step}ms` };
}
