// The add-on catalogue, and the only place an add-on price is written down.
//
// The prices used to live in the Payments screen's JSX as display strings
// ("₹1499/month"), which is precisely why the amount shown could not be
// reconciled with what a gateway charged: nothing server-side knew what an
// add-on cost, because nothing server-side knew add-ons existed. Every price
// the user sees is now read from here, and so is every order amount.

export const ADDONS = Object.freeze([
  {
    key: 'crm',
    title: 'Sales CRM Add-on',
    description: 'Native lead owners, auto-assignments and pipeline management.',
    priceMonthly: 1499,
  },
  {
    key: 'events',
    title: 'Pack of 3 Custom Events',
    description: 'Track external triggers and coordinate custom actions via webhook.',
    priceMonthly: 499,
  },
  {
    key: 'tags',
    title: 'Pack of 10 Custom Tags',
    description: 'Expand categorisations to organise contacts effectively.',
    priceMonthly: 499,
  },
  {
    key: 'fields',
    title: 'Pack of 5 Custom Fields',
    description: 'Add user traits and extra attributes to contact profiles.',
    priceMonthly: 499,
  },
]);

export const CURRENCY = 'INR';

const BY_KEY = new Map(ADDONS.map((a) => [a.key, a]));

export function getAddon(key) {
  const addon = BY_KEY.get(String(key || '').trim());
  if (!addon) {
    const e = new Error(`Unknown add-on "${key}"`);
    e.status = 400;
    throw e;
  }
  return addon;
}

// Paise. Razorpay bills in the smallest currency unit, and doing this
// conversion in one place is what keeps the displayed price and the charged
// amount from drifting by a factor of a hundred.
export const priceInPaise = (addon) => Math.round(addon.priceMonthly * 100);
