// The add-on catalogue, and the only place an add-on price is written down.
//
// The prices used to live in the Payments screen's JSX as display strings
// ("₹1499/month"), which is precisely why the amount shown could not be
// reconciled with what a gateway charged: nothing server-side knew what an
// add-on cost, because nothing server-side knew add-ons existed. Every price
// the user sees is now read from here, and so is every order amount.

export const ADDONS = Object.freeze([
  {
    key: 'fields',
    title: 'Pack of 5 Custom Fields',
    description: 'Add your own attributes to contact profiles — order number, plan, renewal date, anything you track.',
    priceMonthly: 499,
    // What one purchase grants, and of what. Read by
    // services/addons.service.js#addonAllowance, which is what actually gates
    // the feature — a catalogue entry with no grant sells nothing.
    grants: { customFields: 5 },
    available: true,
  },
  {
    key: 'events',
    title: 'Pack of 3 Custom Events',
    description: 'Define your own events and post them from your systems; each one fans out to your webhook.',
    priceMonthly: 499,
    grants: { customEvents: 3 },
    available: true,
  },
  {
    key: 'tags',
    title: 'Pack of 10 Custom Tags',
    description: 'Expand categorisations to organise contacts effectively.',
    priceMonthly: 499,
    grants: {},
    // Not sellable, and deliberately so: contact tags are already unlimited and
    // free. Introducing a cap on an existing capability so it can be sold back
    // is a pricing decision, not an engineering one — and it would immediately
    // break every workspace already over whatever cap was chosen. Left visible
    // so the intent is not lost, but it cannot be charged for.
    available: false,
    unavailableReason: 'Tags are already unlimited on every plan, so there is nothing to add.',
  },
  {
    key: 'crm',
    title: 'Sales CRM Add-on',
    description: 'Native lead owners, auto-assignments and pipeline management.',
    priceMonthly: 1499,
    grants: {},
    // A pipeline, lead ownership and assignment rules are a product, not a
    // feature flag. Nothing in the codebase implements any of it, so this
    // cannot be switched on by a purchase.
    available: false,
    unavailableReason: 'Not available for self-service yet — talk to us about early access.',
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

// Only an add-on that actually grants something may be bought. This is the
// guard that stops the platform charging for capability it cannot deliver —
// which is what it was doing for all four before any of them were implemented.
export function assertPurchasable(addon) {
  if (addon.available) return;
  const e = new Error(`${addon.title} cannot be purchased. ${addon.unavailableReason}`);
  e.status = 400;
  e.code = 'ADDON_NOT_AVAILABLE';
  e.expose = true;
  throw e;
}

// Paise. Razorpay bills in the smallest currency unit, and doing this
// conversion in one place is what keeps the displayed price and the charged
// amount from drifting by a factor of a hundred.
export const priceInPaise = (addon) => Math.round(addon.priceMonthly * 100);
