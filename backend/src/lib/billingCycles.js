// Billing cycles a plan can be sold on, and how to tell which one a running
// subscription is on. Pure — no database — so the arithmetic that decides what
// a renewal costs can be tested directly.

// `days` is the period a checkout buys. `minDays` is how the renewal sweep
// recognises the cycle again from the period's own length; it is compared
// loosely because month lengths vary (Jan 31 → Apr 30 is 89 days) and a leap
// year is 366.
export const CYCLES = Object.freeze({
  monthly:   Object.freeze({ priceField: 'priceMonthly',   days: 30,  minDays: 0 }),
  quarterly: Object.freeze({ priceField: 'priceQuarterly', days: 90,  minDays: 80 }),
  yearly:    Object.freeze({ priceField: 'priceYearly',    days: 365, minDays: 330 }),
});

// Anything unrecognised is monthly, which is what an order with no cycle in
// its notes (one created before cycles existed) always meant.
export const normalizeCycle = (cycle) => (Object.hasOwn(CYCLES, cycle) ? cycle : 'monthly');

// What this subscription owes for its next period, and which cycle it is on.
//
// The cycle is the longest one the current period is long enough for *and* the
// plan still sells. A yearly subscriber whose plan loses its yearly price falls
// back to the next cycle down rather than being charged nothing.
export function renewalCharge(subscription, plan) {
  const cycleMs = subscription.currentPeriodEnd.getTime() - subscription.currentPeriodStart.getTime();
  const cycleDays = Math.round(cycleMs / 86_400_000);
  const cycle = ['yearly', 'quarterly'].find(
    (c) => cycleDays >= CYCLES[c].minDays && plan[CYCLES[c].priceField] != null,
  ) ?? 'monthly';
  const amount = Number(plan[CYCLES[cycle].priceField]) || 0;
  return {
    amount,
    cycleDays,
    cycle,
    // Guards a malformed row with a zero-length cycle, which would otherwise
    // roll the period to exactly where it already is and be swept forever.
    cycleMs: cycleMs > 0 ? cycleMs : 30 * 86_400_000,
  };
}
