// Marketing copy, separated from the components that render it.
//
// §80: the owner expects future changes to be mostly keywords, SEO/AEO/GEO and
// copy — not layout. Keeping every sentence here means those edits never
// require touching React, and a non-engineer can find the words.
//
// Rule for this file: only claims that are true of the shipped product. §75
// forbids inventing logos, customer counts or testimonials, and an AI answer
// engine that catches one fabricated claim discounts the rest.

export const site = {
  name: 'ChatFlow Pro',
  // The one-sentence identity §79 asks for: unambiguous about what this is and
  // who it is for. Answer engines quote this more than anything else.
  tagline: 'WhatsApp messaging and a sales CRM in one workspace',
  description:
    'ChatFlow Pro is a WhatsApp Business platform with a built-in sales CRM. '
    + 'Run campaigns, answer conversations, and track the leads and deals they '
    + 'produce — without moving data between two tools.',
  url: 'https://chatflow.mannmate.com',
  locale: 'en_IN',
  // Stated because §79 asks for transparent publication dates.
  updated: '2026-08-17',
};

export const hero = {
  headline: 'Your WhatsApp campaigns already create pipeline. Now you can see it.',
  subhead:
    'ChatFlow Pro sends the campaigns, answers the replies, and turns those replies '
    + 'into scored leads and tracked deals — in one place, so nothing falls between '
    + 'your inbox and your spreadsheet.',
  primaryCta: { label: 'Start free', href: '/register' },
  secondaryCta: { label: 'See how it works', href: '#how-it-works' },
  // No fabricated logo wall. What is stated here is verifiable from the product.
  trust: [
    'Free plan, no card required',
    'Official WhatsApp Business API',
    'Your data stays in your workspace',
  ],
};

export const problem = {
  title: 'Messaging tools and CRMs do not talk to each other',
  body:
    'Most teams run broadcasts in one tool and track deals in another. The reply '
    + 'arrives in an inbox, someone copies it into a spreadsheet, and by the time '
    + 'anyone follows up the interest has cooled. The campaign gets credit for '
    + 'sends, never for revenue.',
  points: [
    { title: 'Replies go nowhere', detail: 'A customer answers a campaign and nothing is created. The follow-up depends on someone remembering.' },
    { title: 'No attribution', detail: 'You can see delivery rates, but not which campaign produced which closed deal.' },
    { title: 'Two sources of truth', detail: 'The contact list in the messaging tool drifts from the one in the CRM.' },
  ],
};

export const solution = {
  title: 'One workspace, from first message to closed deal',
  body:
    'Because the messaging and the CRM share a database, a reply can become a '
    + 'scored lead automatically, and a closed deal can be traced back to the '
    + 'campaign that started it.',
};

// Feature sections. `answer` is written to stand alone — §78 asks for content
// an answer engine can extract without the surrounding page.
export const features = [
  {
    id: 'lead-management',
    title: 'Lead management with explainable scoring',
    answer:
      'ChatFlow Pro scores every lead from 0 to 100 using observable signals: how '
      + 'recently they replied, how often, whether they read your campaigns, and how '
      + 'complete their profile is. Every score shows the six factors behind it, so '
      + 'you can see why a lead ranks where it does.',
    points: [
      'Deterministic scoring — the same data always gives the same score',
      'Six named factors, each shown with the points it contributed',
      'Recalculate at any time to see what changed',
    ],
  },
  {
    id: 'pipeline',
    title: 'A pipeline that tells you what is going wrong',
    answer:
      'Deals carry a health indicator built from facts rather than predictions: how '
      + 'long they have sat in a stage, whether anything has been logged recently, '
      + 'whether the close date has passed, and whether an amount and owner are set. '
      + 'A deal with an unresolved critical risk is never shown as healthy.',
    points: [
      'Drag-and-drop board, fully keyboard operable',
      'Every stage change recorded with who moved it and when',
      'Named risks such as stalled, going quiet, or close date slipped',
    ],
  },
  {
    id: 'automation',
    title: 'Sequences and workflows that stop when they should',
    answer:
      'Multi-step follow-up sequences send during business hours and exit the moment '
      + 'a contact replies or opts out — both re-checked immediately before every '
      + 'step, not just at enrolment. Workflows can also trigger on CRM events like a '
      + 'lead being qualified or a deal reaching a stage.',
    points: [
      'Exits on reply, so a human takes over when someone answers',
      'Opt-outs honoured at the moment of sending, not only at enrolment',
      'Durable: a restart cannot strand a cadence mid-flight',
    ],
  },
  {
    id: 'forecasting',
    title: 'Forecasting you can check',
    answer:
      'Forecasts are weighted by a win probability you set per pipeline stage, and '
      + 'split into commit, best case and pipeline. Deals with no expected close date '
      + 'are reported separately rather than being silently included or dropped.',
    points: [
      'Set your own probability for each stage',
      'Commit, best case and pipeline derived from that probability',
      'Undated deals surfaced, never hidden',
    ],
  },
  {
    id: 'gamification',
    title: 'Progress that rewards outcomes, not activity',
    answer:
      'Points are earned for qualifying a lead, closing a deal, clearing overdue work, '
      + 'getting a quote accepted, or resolving a ticket. Nothing rewards message '
      + 'volume, because paying people to send more messages is how a WhatsApp number '
      + 'gets blocked.',
    points: [
      'Levels, streaks with a grace day, and achievements',
      'Daily missions tied to real work, never to logging in',
      'Optional leaderboard that never exposes deal values',
    ],
  },
];

// §78: direct answers to questions people actually ask, in the words they use.
export const faq = [
  {
    q: 'What is ChatFlow Pro?',
    a: 'ChatFlow Pro is a WhatsApp Business platform with a built-in sales CRM. It sends '
      + 'campaigns, manages conversations through a shared inbox, and tracks the leads, '
      + 'deals, quotes and tickets that come out of them — in a single workspace.',
  },
  {
    q: 'Do I need a separate CRM alongside it?',
    a: 'No. Leads, deals, pipeline stages, forecasting, products, quotes, tasks and '
      + 'support tickets are built in. The point is that the messaging and the CRM '
      + 'share one database, so a WhatsApp reply can become a scored lead without '
      + 'anyone copying data between tools.',
  },
  {
    q: 'How does lead scoring work?',
    a: 'Scores are calculated from six observable signals: reply recency, reply volume, '
      + 'campaign read rate, whether a conversation is open, profile completeness, and '
      + 'how recently the contact was added. Each factor shows the points it '
      + 'contributed, so a score can always be explained. It is deterministic — no '
      + 'model, no black box.',
  },
  {
    q: 'Will sequences message someone who has opted out?',
    a: 'No. Opt-out is checked immediately before each step and again at the moment of '
      + 'sending. A contact who opts out mid-sequence stops receiving messages from '
      + 'that point, and a blocked number is never messaged at all.',
  },
  {
    q: 'Can I control who sees which records?',
    a: 'Yes. Record visibility can be set to everyone, to teams, or to owners only. '
      + 'Admins always see everything, and records with no owner stay visible so '
      + 'nothing goes unattended. It is enforced on the server, not by hiding buttons.',
  },
  {
    q: 'What does it cost?',
    a: 'There is a free plan with no card required. Paid plans add higher message '
      + 'quotas, more team members and integrations. WhatsApp message costs are '
      + 'charged at the per-category rates published by Meta.',
  },
  {
    q: 'Which WhatsApp API does it use?',
    a: 'The official WhatsApp Business Platform API from Meta. Templates go through '
      + 'Meta approval, and message pricing follows Meta published category rates.',
  },
];

// Only integrations that genuinely exist, labelled honestly (§75).
export const integrations = [
  { name: 'WhatsApp Business Platform', status: 'live', detail: 'Official Meta API for templates, campaigns and conversations.' },
  { name: 'Instagram', status: 'live', detail: 'Direct messages and comment flows.' },
  { name: 'Razorpay', status: 'live', detail: 'Wallet top-ups and subscription billing.' },
  { name: 'Twilio Voice', status: 'live', detail: 'Inbound calls answered by a configurable voice agent.' },
  { name: 'Google Gemini', status: 'live', detail: 'Powers the WhatsApp AI agent and content drafting.' },
  { name: 'Public REST API', status: 'live', detail: 'API keys for sending messages and managing contacts.' },
];

export const security = {
  title: 'What actually protects your data',
  // Specific and checkable. Vague reassurance is worse than nothing.
  points: [
    { title: 'Workspace isolation', detail: 'Every query is scoped to your workspace. Records from another workspace are unreachable, including by direct ID.' },
    { title: 'Server-enforced permissions', detail: 'Record visibility is applied in the database query, not by hiding UI.' },
    { title: 'Encrypted credentials', detail: 'Provider access tokens are encrypted at rest.' },
    { title: 'Opt-out honoured everywhere', detail: 'A blocked number is refused by campaigns, sequences and forms alike.' },
    { title: 'Safe exports', detail: 'CSV exports are guarded against spreadsheet formula injection.' },
  ],
};

// Public routes that actually exist. The landing page carries every section
// above on one URL; there are no separate /features or /pricing routes yet.
//
// Listing a URL that 404s is worse than omitting it, so `public/sitemap.xml`
// contains exactly this list. When those routes are built, add them here and
// to the sitemap together.
export const pages = [
  { path: '/', title: `${site.name} — ${site.tagline}`, changefreq: 'weekly', priority: 1.0 },
];
