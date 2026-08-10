// The marketing site's copy, as data.
//
// This lives in the backend rather than beside Landing.jsx because two
// consumers need it and only one of them is a browser:
//
//   1. frontend/src/pages/Landing.jsx renders it (imported at build time —
//      Vite inlines it, so the SPA gains no runtime dependency on this path).
//   2. services/siteKnowledge.service.js indexes it, so the website assistant
//      answers "what features do you have?" out of the same words the page
//      shows a visitor.
//
// That second consumer is the reason this is a module and not JSX. When the
// copy lived inside the components, the only way to give the assistant the
// same knowledge was to retype it somewhere else — and a second copy of the
// pricing blurb is exactly how a chatbot ends up quoting a plan the site no
// longer sells. Edit the copy here and both the page and the assistant's
// index move together (the index re-syncs on boot; see siteKnowledge).
//
// Presentation hints (icon, colour, grid span) ride along with each entry.
// They are meaningless to the indexer, which reads only the prose, and they
// keep Landing.jsx a straight map over this data instead of a second place
// where content decisions get made.
//
// Nothing here may state a price. Plan prices come from the Plan table and
// per-message rates from lib/messagePricing.js, both fetched at render time —
// see PLAN_CARDS below.

export const SITE_NAME = 'ChatFlow Pro';

// `headlineLines` carries the h1's deliberate two-line break — the heading is
// set in a 76px display face and the break is a typographic decision, not
// something to leave to the browser. `highlight` is the tail the page tints
// green. `HERO.headline` re-joins the lines into the plain sentence, which is
// what the indexer wants: a reader searching "answer for itself" should match
// even though the page splits it.
export const HERO = {
  badge: 'Campaign AI Agent',
  headlineLines: ['Your campaign can', 'answer for itself.'],
  highlight: 'for itself.',
  sub: "Send WhatsApp campaigns, then let an AI agent handle the questions they start — priced, dated and worded from the exact message each customer received. No markup on Meta's rates.",
  note: 'Free plan · no card · connect a number in minutes',
  get headline() { return this.headlineLines.join(' '); },
};

// Capability claims, not invented traffic numbers: each line is something the
// product actually does, and each is demonstrated further down the page.
export const PROOF = [
  ['At cost', 'Meta’s per-message rate, passed through'],
  ['Refunded', 'Every message that never went out'],
  ['Never guessed', 'A price or date the campaign didn’t state'],
  ['Meta partner', 'Official WhatsApp Business API access'],
];

export const AI_PROMPT_EXAMPLES = [
  'Create a template for an abandoned cart',
  'Build a Diwali sale campaign for my VIP list',
  'Set up an agent that answers offer questions',
  'Draft a welcome flow for new contacts',
];

export const FEATURES = [
  {
    span: 4, icon: 'bot', color: 'var(--green)', visual: 'agentChain',
    title: 'Campaign AI Agent',
    desc: 'Attach your agent to a campaign and it answers questions about that campaign — the price, the discount, the deadline, the fine print — from the exact message that customer received. Edit the campaign later and their answers stay true to what was sent.',
  },
  {
    span: 2, icon: 'spark', color: '#0EA5E9',
    title: 'Replies that route themselves',
    desc: 'A deployed agent answers free-form questions when no rule matches, and intent matching sends “my parcel hasn’t come” to your shipping trigger without an exact keyword.',
  },
  {
    span: 2, icon: 'wflow', color: '#F59E0B', visual: 'flow',
    title: 'Workflows that actually run',
    desc: 'Triggers, conditions, delays and multi-step sends — with a run history, so “did it fire?” is answerable.',
  },
  {
    span: 4, icon: 'credit', color: 'var(--green)', visual: 'ledger',
    title: 'Billing you can audit',
    desc: 'Campaigns reserve at launch and settle on completion. Opted-out and unsendable numbers are skipped, retries are never charged twice, and everything that never went out comes back to your wallet.',
  },
  {
    span: 2, icon: 'note', color: '#A78BFA',
    title: 'Forms over chat',
    desc: 'Collect answers one question per message, with validation, and a completed submission at the end.',
  },
  {
    span: 2, icon: 'phone', color: '#0EA5E9',
    title: 'Voice AI reception',
    desc: 'Inbound calls answered, transcribed and turned into a lead, with a handoff when the caller needs a person.',
  },
  {
    span: 2, icon: 'insta', color: '#F59E0B',
    title: 'Instagram quickflows',
    desc: 'DMs, comments and story replies automated on the same keyword model as WhatsApp.',
  },
  {
    span: 2, icon: 'file', color: 'var(--green)',
    title: 'Template studio',
    desc: 'Write copy with AI, generate the header image, add buttons, submit to Meta, and watch approval status land by webhook.',
  },
  {
    span: 2, icon: 'chart', color: '#A78BFA',
    title: 'Delivery and revenue',
    desc: 'Sent, delivered, read and failed per campaign, tied back to spend — plus retries and SMS or email fallback.',
  },
  {
    span: 2, icon: 'key', color: '#0EA5E9',
    title: 'API, webhooks, integrations',
    desc: 'Scoped API keys, outbound webhooks and OAuth connections for the tools your team already runs.',
  },
];

export const USE_CASES = [
  { icon: 'send', color: '#1EBF5E', title: 'E-commerce', metric: 'Cart recovery', desc: 'Abandoned-cart nudges, order updates and catalogue sends — with the agent fielding “is it in stock?”.' },
  { icon: 'users', color: '#0EA5E9', title: 'Education', metric: 'Admissions', desc: 'Enrolment reminders, fee notices and a form that collects student details over chat.' },
  { icon: 'phone', color: '#A78BFA', title: 'Clinics', metric: 'Appointments', desc: 'Booking confirmations, reminders and reports, with inbound calls answered when the desk is busy.' },
  { icon: 'building', color: '#F59E0B', title: 'Real estate', metric: 'Site visits', desc: 'Property drops to a smart list, then an agent that answers price and location questions per listing.' },
  { icon: 'globe', color: '#1EBF5E', title: 'Agencies', metric: 'Multi-client', desc: 'A workspace per client, separate numbers and wallets, and one place to report from.' },
  { icon: 'zap', color: '#0EA5E9', title: 'Travel', metric: 'Itineraries', desc: 'Booking confirmations and itinerary sends, with after-hours questions handled automatically.' },
];

// Plan cards, exactly as the pricing section renders them.
//
// The `price`/`per`/`note` strings are display copy and must keep matching the
// Plan catalog seeded in server.js — advertising a price the checkout cannot
// sell is worse than no price. They are NOT the assistant's source for what a
// plan costs: the indexer skips them and reads the Plan table instead, so a
// price that drifts here can never reach an answer. `planKey` is the join back
// to that row; `enquiry: true` marks a tier not sold self-serve, which
// therefore has no Plan row at all.
export const PLAN_CARDS = [
  {
    name: 'Basic', planKey: 'BASIC', popular: false,
    price: '₹1,500', per: '/mo', note: 'or ₹3,500 per quarter',
    desc: 'For a small team running its first campaigns.',
    features: ['1 WhatsApp number', 'Up to 10 team members', '10,000 messages per cycle', 'Campaigns, templates, team inbox', 'Workflows and auto-replies', 'Email support'],
  },
  {
    name: 'Growth', planKey: 'GROWTH', popular: true,
    price: '₹2,500', per: '/mo', note: 'or ₹7,500 per quarter',
    desc: 'For teams whose WhatsApp runs itself.',
    features: ['Unlimited numbers and members', 'Unlimited messages', 'Campaign AI Agent', 'AI intent matching and smart replies', 'Retries with SMS and email fallback', 'Voice AI and Instagram flows', 'Revenue and delivery analytics', 'Priority support'],
  },
  {
    name: 'Enterprise', planKey: null, popular: false, enquiry: true,
    price: 'Custom', per: '',
    desc: 'For volume, review requirements and bespoke work.',
    features: ['Everything in Growth', 'Custom message volume', 'Dedicated account manager', 'SSO and audit logs', 'Custom integrations', 'SLA'],
  },
];

export const FAQ_ITEMS = [
  ['Do I need my own WhatsApp Business API access?',
   'No. Connect a number you already own through Meta’s embedded signup, or have one assigned to you from the pool. Either way the number, its templates and its access token stay bound to your workspace.'],
  ['What happens when a message fails?',
   'Retryable failures are retried on a backoff schedule you control, with SMS or email as a fallback channel. A recipient is billed once no matter how many attempts it took, and anything that never reached Meta is refunded when the campaign settles.'],
  ['Can the AI agent invent a price or a date?',
   'It is given the campaign message that specific customer received, plus your knowledge base, and is instructed to answer from those only. Asked something neither covers, it says it does not have that and offers a human — it does not fill the gap.'],
  ['What if someone wants to stop hearing from us?',
   'A reply of STOP blocks that number for good. It is skipped on every future campaign, excluded from the cost before you are charged, and no automation replies to it again.'],
  ['Who can see my data?',
   'Everything — contacts, campaigns, conversations, wallet — is scoped to your workspace, and members only reach it through their membership. WhatsApp access tokens are encrypted at rest.'],
];

export const CTA = {
  headlineLines: ['Send the campaign.', 'Let it handle the questions.'],
  sub: 'Connect a number, import your contacts, and put an agent behind your next offer.',
  get headline() { return this.headlineLines.join(' '); },
};

export const FOOTER_COLS = [
  { title: 'Product', links: ['Features', 'Pricing', 'Campaign AI Agent', 'Workflows', 'API'] },
  { title: 'Solutions', links: ['E-commerce', 'Education', 'Clinics', 'Real estate', 'Agencies'] },
  { title: 'Company', links: ['About', 'Blog', 'Careers', 'Contact', 'Privacy'] },
];

export const FOOTER_BLURB = 'WhatsApp Business API for teams that would rather their campaigns answered for themselves.';

export const FOOTER_LEGAL = '© 2026 ChatFlow Pro · Meta WhatsApp Business API partner';

// Prose the page does not render as its own section but that a visitor asks
// about constantly. Kept here rather than in the help corpus because it is
// positioning, not instructions.
//
// CONTACT deliberately lists no email address or phone number: the codebase
// has neither, and an assistant that invents "support@chatflow.pro" sends
// customers into a void. The routes named here are the ones that exist.
export const ABOUT = `ChatFlow Pro is a WhatsApp Business API platform for teams that send campaigns and then have to answer for them. It is an official Meta WhatsApp Business API partner, so numbers, templates and message delivery run on Meta's own infrastructure rather than an unofficial bridge.

The product covers the whole loop: connect a WhatsApp number, build and submit message templates, import contacts, send a campaign, and let AI agents, workflows and a shared team inbox handle the conversations the campaign starts. Per-message cost is Meta's rate passed through without markup, and money for messages that were never sent is refunded to the workspace wallet.

Work is organised into workspaces. A workspace owns its own numbers, contacts, campaigns, conversations, wallet and team, and members reach data only through their membership in it — which is what lets an agency run a separate workspace per client.`;

export const CONTACT = `To reach the ChatFlow Pro team, open the dashboard and go to Support, where you can raise a ticket with a subject, a category and a message. Tickets are tied to your workspace and the team replies to the account's email address.

For Enterprise enquiries — custom message volume, SSO and audit logs, custom integrations or an SLA — use the "Talk to sales" button on the Enterprise card in the pricing section of the website.

Account-level questions such as billing, plan changes and wallet top-ups are handled from the dashboard itself: Payments for the wallet and invoices, and Settings for plan and workspace configuration.`;
