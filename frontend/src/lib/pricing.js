// Single frontend source for WhatsApp per-message pricing.
//
// The rates themselves live in backend/src/lib/messagePricing.js and arrive
// over the API. Nothing here hardcodes a number: a price change is a one-line
// backend edit and every screen follows it. That matters because these figures
// appear in copy ("bills at X instead of Y"), and a stale literal in the UI
// quotes a customer a price the billing code will not honour.

import { useEffect, useState } from 'react';
import { wFetch } from './api';

// Meta's three conversation categories, in the order it lists them.
export const PRICING_CATEGORIES = [
  ['MARKETING', 'Marketing'],
  ['UTILITY', 'Utility'],
  ['AUTHENTICATION', 'Authentication'],
];

// Module-level cache: the rates change about never, and several screens ask
// for them independently. `inflight` collapses concurrent first calls into one
// request instead of one per mounting component.
let cache = null;
let inflight = null;

export function fetchMessageRates() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = wFetch('/subscription/pricing')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('pricing unavailable'))))
      .then((data) => { cache = data?.rates ?? null; return cache; })
      .catch(() => null)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// Rates as an object keyed by category, or null until they load. Callers must
// handle null by omitting the figure — showing a guessed price is the failure
// mode this module exists to prevent.
export function useMessageRates() {
  const [rates, setRates] = useState(cache);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    fetchMessageRates().then((r) => { if (alive) setRates(r); });
    return () => { alive = false; };
  }, []);
  return rates;
}

// "₹1.09", or null when the rate is unknown.
export function inr(rate) {
  const n = Number(rate);
  return Number.isFinite(n) ? `₹${n.toFixed(2)}` : null;
}
