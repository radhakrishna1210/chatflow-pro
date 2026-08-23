// Per-integration pricing tier, mirroring the `pricing` field on the
// INTEGRATIONS catalogue in frontend/src/pages/IntegrationsView.jsx. Kept
// here (rather than trusting the client) so the plan gate below can't be
// bypassed by a crafted request — free integrations are usable on every
// plan, paid ones require the workspace's plan to carry the `integrations`
// feature flag (PRO/ENTERPRISE in the seed data).
const INTEGRATION_PRICING = {
  'whatsapp-pay': 'free',
  razorpay: 'free',
  payu: 'free',
  aspire: 'paid',
  xendit: 'paid',
  cashfree: 'free',
  stripe: 'paid',
  pabbly: 'free',
  integromat: 'free',
  zapier: 'free',
  'google-sheets': 'free',
  'shopify-sales': 'free',
  'shopify-marketing': 'free',
  woocommerce: 'free',
  yampi: 'free',
  'facebook-lead': 'paid',
  'zoho-crm': 'paid',
  hubspot: 'paid',
  salesforce: 'paid',
  'zoho-bigin': 'paid',
  'freshworks-crm': 'paid',
  freshdesk: 'paid',
  'zoho-billing': 'paid',
  'zoho-books': 'paid',
  'judge-me': 'paid',
  calendly: 'paid',
  wafeq: 'paid',
};

// The generic OAuth flow (oauthStart/oauthCallback) is keyed by the backend
// provider id from oauthProviders.js, not the catalogue id above — e.g. the
// catalogue's free `google-sheets` entry drives the `google` provider.
const OAUTH_PROVIDER_PRICING = {
  google: 'free',
  hubspot: 'paid',
  shopify: 'free',
};

// Unknown ids default to 'paid' — safer than silently letting an
// unrecognised integration bypass the plan gate.
export function pricingForCatalogId(id) {
  return INTEGRATION_PRICING[id] || 'paid';
}

export function pricingForOAuthProvider(id) {
  return OAUTH_PROVIDER_PRICING[id] || 'paid';
}
