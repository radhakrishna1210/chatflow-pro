/* ─────────────────────────────────────────────────────────────────────────────
   Spandan — Resource Center content & data layer
   ---------------------------------------------------------------------------
   Content is kept fully separate from presentation. Today this is a static
   module; the exported shape (CATEGORIES, RESOURCES, TUTORIALS, JOURNEYS,
   TROUBLESHOOTING) and the helper functions below are what the pages consume,
   so this file can later be swapped for an API/CMS response without touching
   the components.

   Every resource maps to a real Spandan module (see ADMIN_NAV in
   Dashboard.jsx). No invented features.
   ──────────────────────────────────────────────────────────────────────────── */

// Where "Open in Spandan" CTAs deep-link to, per category.
export const MODULE_ROUTE = {
  'getting-started': '/dashboard',
  'whatsapp-numbers': '/dashboard/setup',
  templates: '/dashboard/templates',
  contacts: '/dashboard/contacts',
  campaigns: '/dashboard/campaigns',
  inbox: '/dashboard/inbox',
  automation: '/dashboard/automation',
  'ai-agent': '/dashboard/automation',
  'website-widget': '/dashboard/integrations',
  instagram: '/dashboard/integrations',
  'voice-ai': '/dashboard/integrations',
  integrations: '/dashboard/integrations',
  developers: '/dashboard/api',
  billing: '/dashboard/payments',
  analytics: '/dashboard/analytics',
  team: '/dashboard/settings',
  troubleshooting: '/dashboard/support',
};

// Each category has its own dedicated page (/resources/category/:id) describing
// what the area is, what you use it for, and its key features.
export const CATEGORIES = [
  {
    id: 'getting-started', name: 'Getting Started', icon: 'home',
    blurb: 'Create a workspace, connect a number and send your first message.',
    overview: 'Getting Started is the orientation layer for Spandan. It covers the path from an empty account to a delivered campaign, and the order to tackle each module in.',
    useFor: [
      'Onboarding a brand-new workspace from scratch',
      'Understanding how number, template, contacts, wallet and campaign depend on each other',
      'Getting a first WhatsApp message sent as fast as possible',
      'Deciding which module to configure next',
    ],
    features: [
      { title: 'End-to-end journey map', body: 'A single walkthrough of all nine stages so every later guide has context.' },
      { title: 'One-time vs. recurring work', body: 'A clear split between setup you do once (number, template approval) and work you repeat (campaigns).' },
      { title: 'Guided AI onboarding', body: 'Describe your flow in plain language and Spandan drafts the templates and campaign scaffolding.' },
      { title: 'Prerequisite checks', body: 'Every step lists what must already be true before it will work.' },
    ],
  },
  {
    id: 'whatsapp-numbers', name: 'WhatsApp Numbers', icon: 'phone',
    blurb: 'Connect a number via Meta embedded signup, a pool number, or your own WABA.',
    overview: 'WhatsApp Numbers is where you connect and manage the WhatsApp Business numbers your workspace sends from. A verified, Active number is the prerequisite for templates, campaigns and the inbox.',
    useFor: [
      'Connecting a number through Meta embedded signup',
      'Claiming an instant pool number for testing or low volume',
      'Bringing your own WABA credentials',
      'Monitoring quality rating and messaging limits',
    ],
    features: [
      { title: 'Three connection methods', body: 'Meta embedded signup, instant pool numbers, or bring-your-own WABA — chosen per number.' },
      { title: 'Live status tracking', body: 'See Pending / Active state, with display-name approval tracked separately.' },
      { title: 'Quality & tier visibility', body: 'Green / yellow / red quality rating and the 1K–unlimited messaging tier for each number.' },
      { title: 'Multi-number workspaces', body: 'Run several numbers in one workspace; templates and campaigns are scoped per number.' },
    ],
  },
  {
    id: 'templates', name: 'Templates', icon: 'file',
    blurb: 'Build templates with variables and buttons, and get them approved by Meta.',
    overview: 'Templates are the pre-approved message formats required for any business-initiated WhatsApp message. This section covers building them, adding variables and buttons, and getting them through Meta review.',
    useFor: [
      'Creating Marketing, Utility and Authentication templates',
      'Personalising messages with numbered variables',
      'Adding quick-reply and call-to-action buttons',
      'Diagnosing and fixing rejections',
    ],
    features: [
      { title: 'Category-aware editor', body: 'Marketing, Utility or Authentication — each with its own policy hints and pricing.' },
      { title: 'Variables with samples', body: 'Numbered {{1}} placeholders with the example values Meta needs for review.' },
      { title: 'Buttons', body: 'Quick-reply and URL / phone call-to-action buttons.' },
      { title: 'Review status', body: 'Pending → Approved / Rejected, with the reason surfaced for a fast fix.' },
      { title: 'Per-number ownership', body: 'Templates belong to a specific number so approvals stay isolated.' },
    ],
  },
  {
    id: 'contacts', name: 'Contacts & Segments', icon: 'users',
    blurb: 'Import contacts, build segments, and keep opt-outs clean.',
    overview: 'Contacts & Segments is your audience database. Import contacts, enrich them with tags and attributes, group them into segments, and keep opt-outs clean so every campaign targets the right people.',
    useFor: [
      'Importing contacts from a CSV',
      'Grouping contacts with tags and manual clusters',
      'Building rule-based segments for campaigns',
      'Honouring opt-outs and consent',
    ],
    features: [
      { title: 'CSV import with mapping', body: 'Column mapping, phone-number normalisation and de-duplication on re-import.' },
      { title: 'Tags & custom attributes', body: 'Label contacts and store arbitrary fields for personalisation.' },
      { title: 'Rule-based segments', body: 'Saved filters that re-evaluate at campaign launch.' },
      { title: 'Automatic opt-out handling', body: 'Opted-out contacts are excluded from every send, permanently.' },
    ],
  },
  {
    id: 'campaigns', name: 'Campaigns', icon: 'send',
    blurb: 'Plan, schedule and monitor broadcast campaigns end to end.',
    overview: 'Campaigns sends one approved template to an audience on a schedule you control. This section covers the builder, wallet reservation at launch, pacing and retries, and reading live delivery.',
    useFor: [
      'Sending one-time broadcasts to a segment',
      'Scheduling sends in your workspace timezone',
      'Throttling large sends to protect number quality',
      'Monitoring delivery, read and failure rates',
    ],
    features: [
      { title: 'Step-by-step builder', body: 'Number, template, audience, schedule, pacing and a cost estimate before launch.' },
      { title: 'Wallet reservation', body: 'Budget is reserved at launch and unused amounts are refunded automatically.' },
      { title: 'Throttling & retries', body: 'Control the send rate and automatic retry for transient failures.' },
      { title: 'Live delivery view', body: 'Sent / Delivered / Read / Failed update from Meta webhooks, with per-recipient reasons.' },
      { title: 'Cancel any time', body: 'Draft, Scheduled or Running campaigns can be cancelled; pending budget is released.' },
    ],
  },
  {
    id: 'inbox', name: 'Shared Inbox', icon: 'msg',
    blurb: 'Assign conversations, use quick replies and work the 24-hour window.',
    overview: 'The Shared Inbox is the unified view of every inbound WhatsApp conversation. Assign chats, reply within the 24-hour service window, collaborate with internal notes, and let automation or the AI Agent handle the rest.',
    useFor: [
      'Handling customer replies as a team',
      'Assigning conversations to specific agents',
      'Leaving internal notes without messaging the customer',
      'Knowing when a template is required to reply',
    ],
    features: [
      { title: 'Unified conversation list', body: 'Filters, unread indicators and assignment at a glance.' },
      { title: 'Assignment & routing', body: 'Claim a chat or route it automatically to the right agent.' },
      { title: 'Internal notes', body: 'Team-only notes attached to a conversation.' },
      { title: 'Service-window awareness', body: 'The composer tells you when the 24-hour free-text window has closed.' },
      { title: 'Bot / human handoff', body: 'The AI Agent or a workflow handles a chat until a human takes over.' },
    ],
  },
  {
    id: 'automation', name: 'Automation & Workflows', icon: 'zap',
    blurb: 'Keyword triggers, multi-step workflows and intent matching.',
    overview: 'Automation & Workflows turns repetitive conversations into rules. Start with keyword triggers for instant replies, then build multi-step workflows with conditions and delays, and route by meaning with intent matching.',
    useFor: [
      'Auto-replying to common questions',
      'Building welcome and follow-up sequences',
      'Branching on contact attributes or replies',
      'Routing messages by intent rather than exact words',
    ],
    features: [
      { title: 'Keyword triggers', body: 'One-word-in, one-message-out replies with no flow required.' },
      { title: 'Visual workflow builder', body: 'Trigger, condition, action and delay nodes chained into sequences.' },
      { title: 'Branching', body: 'Split on attributes or the customer’s reply; each branch runs independently.' },
      { title: 'Intent matching', body: 'Classify messages into defined intents with a tunable confidence threshold.' },
      { title: 'Safe testing', body: 'Run a workflow against a test contact before activating it.' },
    ],
  },
  {
    id: 'ai-agent', name: 'WhatsApp AI Agent', icon: 'bot',
    blurb: 'Give the agent a persona and knowledge base, then deploy it to replies.',
    overview: 'The WhatsApp AI Agent answers conversations automatically using a persona you write and a knowledge base you provide. This section covers configuring, testing and rolling it out without surprising your customers.',
    useFor: [
      'Deflecting repetitive questions around the clock',
      'Covering after-hours conversations',
      'Drafting replies for agents to approve',
      'Escalating cleanly when a human is needed',
    ],
    features: [
      { title: 'Custom persona', body: 'Define tone, scope and explicit refusals.' },
      { title: 'Knowledge base', body: 'Answer from your FAQs, docs or crawled site content — not guesses.' },
      { title: 'Sandbox testing', body: 'Chat privately with the agent before it touches real customers.' },
      { title: 'Scoped deployment', body: 'Run it everywhere, on one workflow, or only after hours.' },
      { title: 'Hand-off rules', body: 'Stop and assign a human on anger, an explicit request, or an unknown topic.' },
    ],
  },
  {
    id: 'website-widget', name: 'Website Widget', icon: 'globe',
    blurb: 'Embed the chat widget and hand off to WhatsApp when a human is needed.',
    overview: 'The Website Widget puts a chat launcher on your site. Visitors talk to the AI Agent or knowledge base, then continue the same conversation on WhatsApp.',
    useFor: [
      'Adding live chat to your website',
      'Answering visitor questions from your knowledge base',
      'Converting web visitors into WhatsApp conversations',
      'Handing off to a human agent',
    ],
    features: [
      { title: 'Embed snippet', body: 'One script tag to add the launcher to any page.' },
      { title: 'Shared knowledge base', body: 'Uses the same content as the WhatsApp AI Agent.' },
      { title: 'WhatsApp handoff', body: 'Moves a web chat into a WhatsApp thread so the conversation continues off-site.' },
      { title: 'Customisable appearance', body: 'Launcher style and greeting.' },
    ],
  },
  {
    id: 'instagram', name: 'Instagram Automation', icon: 'insta',
    blurb: 'Automate Instagram DMs and story replies alongside WhatsApp.',
    overview: 'Instagram Automation applies the triggers, workflows and AI Agent you already built to Instagram DMs and story replies, with conversations landing in the same Shared Inbox.',
    useFor: [
      'Automating Instagram DM replies',
      'Responding to story mentions and replies',
      'Reusing WhatsApp automations on Instagram',
      'Managing Instagram and WhatsApp in one inbox',
    ],
    features: [
      { title: 'Account linking', body: 'Connect an Instagram professional account via Meta.' },
      { title: 'Shared automation', body: 'Keyword triggers and workflows carry over from WhatsApp.' },
      { title: 'Unified inbox', body: 'Instagram conversations appear alongside WhatsApp.' },
      { title: 'Story-reply handling', body: 'Automate responses to story mentions and replies.' },
    ],
  },
  {
    id: 'voice-ai', name: 'Voice AI', icon: 'phone',
    blurb: 'Answer calls with a voice agent that shares your knowledge base.',
    overview: 'Voice AI answers inbound phone calls with a spoken agent that draws on your knowledge base, and can escalate to a human or send a WhatsApp follow-up after the call.',
    useFor: [
      'Answering calls outside business hours',
      'Handling common phone enquiries automatically',
      'Escalating complex calls to a person',
      'Following up by WhatsApp after a call',
    ],
    features: [
      { title: 'Spoken agent', body: 'Natural-voice answers from the same knowledge base as the WhatsApp agent.' },
      { title: 'Call escalation', body: 'Transfer to a human when needed.' },
      { title: 'Post-call WhatsApp', body: 'Send a summary or next step by message after the call ends.' },
      { title: 'Speech-tuned prompts', body: 'Prompt-design guidance for voice rather than text.' },
    ],
  },
  {
    id: 'integrations', name: 'Integrations', icon: 'plug',
    blurb: 'Connect Shopify, HubSpot, Zapier and more to sync data and trigger sends.',
    overview: 'Integrations connect Spandan to the tools you already run — to sync contacts, trigger campaigns on external events, and push conversation data out.',
    useFor: [
      'Syncing contacts from your CRM or store',
      'Triggering messages on orders, signups or tickets',
      'Pushing conversation data into other systems',
      'Connecting automation tools like Zapier',
    ],
    features: [
      { title: 'Prebuilt connectors', body: 'Shopify, HubSpot, Zapier and more with guided setup.' },
      { title: 'OAuth or API-key connect', body: 'Standard connection flows with clear scopes.' },
      { title: 'One-way or two-way sync', body: 'Each connector states its direction so you know what to expect.' },
      { title: 'Clean disconnect', body: 'Remove a connector without losing already-synced data.' },
    ],
  },
  {
    id: 'developers', name: 'APIs & Webhooks', icon: 'db',
    blurb: 'Authenticate with an API key, send messages and receive webhooks.',
    overview: 'APIs & Webhooks is the developer surface. Authenticate with a workspace API key, send messages and manage data programmatically, and receive webhooks for message status and inbound messages.',
    useFor: [
      'Sending messages from your own backend',
      'Automating contact and campaign management',
      'Receiving delivery and inbound-message events',
      'Building custom integrations',
    ],
    features: [
      { title: 'Workspace API keys', body: 'Bearer-token auth, with multiple keys for zero-downtime rotation.' },
      { title: 'Message & data endpoints', body: 'Send templates, manage contacts, read campaign results.' },
      { title: 'Webhooks', body: 'Signed status and inbound-message events delivered to your endpoint.' },
      { title: 'In-app reference', body: 'Exact paths and payloads for your workspace live on the API Keys screen.' },
    ],
  },
  {
    id: 'billing', name: 'Billing & Wallet', icon: 'credit',
    blurb: 'How per-message pricing, the wallet ledger and refunds work.',
    overview: 'Billing & Wallet is the prepaid balance that funds messaging. Per-message costs follow Meta’s pricing with no markup; campaigns reserve budget at launch and refund what they don’t use.',
    useFor: [
      'Adding funds before a campaign',
      'Understanding what each message costs',
      'Tracking spend in the wallet ledger',
      'Getting alerted before a low balance blocks a send',
    ],
    features: [
      { title: 'Prepaid wallet', body: 'The balance gates sending; recharge in Payments.' },
      { title: 'Category-based pricing', body: 'Cost varies by template category and destination, passed through at Meta’s rate.' },
      { title: 'Launch-time reservation', body: 'A campaign reserves its estimate and refunds unsent budget.' },
      { title: 'Ledger', body: 'Every debit and credit recorded and exportable.' },
      { title: 'Low-balance alerts', body: 'A warning before a campaign is blocked for lack of funds.' },
    ],
  },
  {
    id: 'analytics', name: 'Analytics', icon: 'chart',
    blurb: 'Read campaign funnels, chat activity and customer retention.',
    overview: 'Analytics aggregates results across campaigns and conversations: delivery funnels, chat activity and customer retention, so you can see what’s working.',
    useFor: [
      'Measuring campaign delivery and read rates',
      'Tracking team response time and resolution',
      'Understanding repeat-conversation retention',
      'Spotting content or timing problems',
    ],
    features: [
      { title: 'Campaign funnels', body: 'Sent → delivered → read → replied, with drop-off highlighted.' },
      { title: 'Chat activity', body: 'Volume, response time and resolution over time.' },
      { title: 'Retention view', body: 'How repeat conversations cluster.' },
      { title: 'Date ranges & export', body: 'Filter by period and export the underlying data.' },
    ],
  },
  {
    id: 'team', name: 'Team & Roles', icon: 'shield',
    blurb: 'Invite teammates and understand what each role can do.',
    overview: 'Team & Roles controls who is in the workspace and what they can do. Invite teammates and assign least-privilege roles from Admin down to Viewer.',
    useFor: [
      'Adding agents to the Shared Inbox',
      'Giving admins access to billing and numbers',
      'Restricting new members to what they need',
      'Auditing who can do what',
    ],
    features: [
      { title: 'Email invitations', body: 'Invite by email with a role chosen up front.' },
      { title: 'Four roles', body: 'Admin, Member, Agent and Viewer — each with a defined capability set.' },
      { title: 'Role changes', body: 'Adjust a member’s role or remove access instantly.' },
      { title: 'Admin-only actions', body: 'Number setup, wallet, API keys and team management are gated to Admins.' },
    ],
  },
  {
    id: 'troubleshooting', name: 'Troubleshooting', icon: 'alertt',
    blurb: 'Fixes for the issues that come up most often across the platform.',
    overview: 'Troubleshooting collects the fixes for the issues that come up most often — connection, delivery, approval, automation and API problems — plus an interactive explorer that points you at the right guide.',
    useFor: [
      'Diagnosing why a campaign isn’t delivering',
      'Fixing a rejected template',
      'Working out why an automation didn’t fire',
      'Resolving API auth and webhook errors',
    ],
    features: [
      { title: 'Interactive explorer', body: 'Pick what you’re trying to do and get the checks and guides that resolve it.' },
      { title: 'Symptom-based guides', body: 'Each guide starts from what you’re seeing, not the feature name.' },
      { title: 'Quick checks', body: 'The two or three things to verify first, before anything else.' },
    ],
  },
];

export const CATEGORY_NAME = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name]));
export const CATEGORY_ICON = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon]));

export const TYPES = ['guide', 'workflow', 'api', 'troubleshooting'];
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

// Quick-access strip in the hero. `type` filters the grid; `anchor` scrolls.
export const QUICK_TYPES = [
  { label: 'Guides', icon: 'file', type: 'guide' },
  { label: 'API Docs', icon: 'db', type: 'api' },
  { label: 'Workflows', icon: 'wflow', type: 'workflow' },
  { label: 'Troubleshooting', icon: 'alertt', type: 'troubleshooting' },
  { label: 'Product Journeys', icon: 'spark', anchor: 'journeys' },
  { label: 'Browse by topic', icon: 'columns', anchor: 'topics' },
];

/* ── Resources ─────────────────────────────────────────────────────────────── */
// Shape: { slug, title, category, type, difficulty, duration, description,
//          tags[], featured?, popular?, intro, learn[], steps[], tips[] }
export const RESOURCES = [
  {
    slug: 'getting-started-with-chatflow-pro',
    title: 'Getting Started with Spandan',
    category: 'getting-started', type: 'guide', difficulty: 'beginner', duration: '6 min',
    description: 'The whole picture: from creating an account to a delivered campaign, and how the modules fit together.',
    tags: ['overview', 'onboarding', 'workspace', 'setup'],
    featured: true, popular: true,
    intro: 'Spandan is a WhatsApp Business API platform. This guide walks the end-to-end journey once — account, workspace, number, template, contacts, wallet, campaign, inbox, analytics — so every other guide has context.',
    learn: [
      'The nine stages of the Spandan journey and which module owns each one',
      'What has to be done once (number, template approval) vs. repeatedly (campaigns)',
      'Where message costs are incurred and how the wallet gates sending',
      'How inbound replies land in the Shared Inbox and can be automated',
    ],
    steps: [
      { title: 'Create an account and workspace', body: 'Sign up with email or Google. A workspace is the container for your number, contacts, templates, team and wallet. You can create one or join an existing one by invitation.' },
      { title: 'Connect a WhatsApp number', body: 'Open Number Setup and connect through Meta embedded signup, claim an instant pool number, or bring your own WABA credentials. The number must be verified before it can send.' },
      { title: 'Get a template approved', body: 'Business-initiated messages must use a template Meta has approved. Submit at least one from Templates and wait for the review to clear.' },
      { title: 'Add contacts', body: 'Import a CSV or add contacts manually, then group them with tags or segments so campaigns have an audience.' },
      { title: 'Fund the wallet', body: 'Each template message has a per-message cost set by Meta by category. Recharge the wallet in Payments so a campaign can reserve its budget at launch.' },
      { title: 'Launch a campaign', body: 'In Campaigns, pick the number, an approved template, an audience and a schedule, then launch. Delivery counters update from Meta webhooks.' },
      { title: 'Handle replies', body: 'Inbound messages open a 24-hour service window and appear in the Shared Inbox, where a teammate, a workflow or the AI Agent can respond.' },
      { title: 'Read the results', body: 'Analytics aggregates delivery, read rates, chat activity and retention across campaigns and conversations.' },
    ],
    tips: [
      'You cannot send a business-initiated message without both an approved template and a positive wallet balance.',
      'Template approval is the step most likely to block a launch — submit it first, before you build the campaign.',
    ],
  },
  {
    slug: 'create-your-workspace',
    title: 'Create & Configure Your Workspace',
    category: 'getting-started', type: 'guide', difficulty: 'beginner', duration: '4 min',
    description: 'Set up the workspace that holds your number, contacts, templates, team and wallet.',
    tags: ['workspace', 'settings', 'account'],
    popular: true,
    intro: 'Everything in Spandan is scoped to a workspace. This guide covers creating one, the settings worth setting early, and how joining an existing workspace differs from starting your own.',
    learn: [
      'What a workspace contains and why data is isolated per workspace',
      'The settings to configure before inviting anyone: display name, timezone, business details',
      'How an invitation to an existing workspace changes what you see',
    ],
    steps: [
      { title: 'Start a workspace or accept an invite', body: 'On first sign-in you either create a workspace (you become its Admin) or open an invitation link to join one with the role the inviter chose.' },
      { title: 'Set the basics in Settings', body: 'Workspace name, timezone and business profile fields feed campaign scheduling and template metadata, so set them before running anything.' },
      { title: 'Review your plan', body: 'The Payments/Subscription area shows the current plan and wallet balance. Nothing sends until the wallet has funds.' },
    ],
    tips: ['Timezone drives when scheduled campaigns actually fire — double-check it matches your team.'],
  },
  {
    slug: 'connect-whatsapp-number',
    title: 'Connect Your WhatsApp Number',
    category: 'whatsapp-numbers', type: 'guide', difficulty: 'beginner', duration: '8 min',
    description: 'Three ways to connect a WhatsApp Business number, and how to pick the right one.',
    tags: ['number', 'meta', 'embedded signup', 'waba', 'setup'],
    featured: true, popular: true,
    intro: 'A verified WhatsApp Business number is the prerequisite for everything else. Spandan supports Meta embedded signup, instant pool numbers, and bring-your-own WABA credentials.',
    learn: [
      'The trade-offs between embedded signup, a pool number and your own WABA',
      'What Meta verification checks and how long it usually takes',
      'How display name approval works and why it can lag number verification',
      'Where to see quality rating and messaging limits once connected',
    ],
    steps: [
      { title: 'Open Number Setup', body: 'The Number Setup screen lists any connected numbers and their status (Pending, Active, quality rating).' },
      { title: 'Choose a connection method', body: 'Embedded signup links your own Meta Business account and phone number. A pool number is issued instantly for testing or low volume. Bring-your-own asks for existing WABA credentials (phone number ID, WABA ID, system user token).' },
      { title: 'Complete Meta verification', body: 'For embedded signup you complete Meta’s flow in a popup: business verification, phone ownership via OTP, and display-name submission.' },
      { title: 'Wait for Active status', body: 'The number shows Pending until Meta confirms it. Display name approval is separate and can take longer; sending still works with an unapproved display name.' },
      { title: 'Send a test message', body: 'Once Active, use the test send in Number Setup or the Shared Inbox to confirm the connection before building a campaign.' },
    ],
    tips: [
      'A number already registered on the WhatsApp consumer app must be deleted from that app before it can join the Business API.',
      'Pool numbers are fine for trials but you cannot set a custom display name on them.',
    ],
  },
  {
    slug: 'whatsapp-number-quality-rating',
    title: 'Number Quality & Messaging Limits',
    category: 'whatsapp-numbers', type: 'guide', difficulty: 'intermediate', duration: '5 min',
    description: 'What the green/yellow/red quality rating means and how messaging tiers scale.',
    tags: ['quality', 'limits', 'tiers', 'deliverability'],
    intro: 'Meta assigns every number a quality rating and a messaging limit tier. Both react to how recipients treat your messages. This guide explains what moves them and how to recover a downgraded number.',
    learn: [
      'How quality rating (High/Medium/Low) is derived from blocks and reports',
      'The messaging limit tiers (1K, 10K, 100K, unlimited) and how you climb them',
      'What triggers a downgrade and the typical path back to High',
    ],
    tips: [
      'Sending to people who never opted in is the fastest way to a Low rating.',
      'A number in "Flagged" state can still send but is being reviewed — reduce volume until it clears.',
    ],
  },
  {
    slug: 'create-approved-template',
    title: 'Create an Approved Message Template',
    category: 'templates', type: 'guide', difficulty: 'beginner', duration: '7 min',
    description: 'Build a template, submit it to Meta, and understand the approval outcomes.',
    tags: ['template', 'meta approval', 'marketing', 'utility', 'variables'],
    featured: true, popular: true,
    intro: 'Business-initiated messages must use an approved template. This guide covers picking the right category, writing a body Meta will accept, and what each review outcome means.',
    learn: [
      'The difference between Marketing, Utility and Authentication categories and how each is priced',
      'How to write body text with numbered variables and provide sample values',
      'What "Approved", "Rejected" and "category changed" mean after review',
      'Why a template belongs to a specific WhatsApp number',
    ],
    steps: [
      { title: 'Open Templates and choose a number', body: 'Templates are private to a WhatsApp number. If the workspace has more than one, pick which number this template is for.' },
      { title: 'Pick a category', body: 'Marketing for promotions, Utility for transactional updates tied to an action the user took, Authentication for one-time codes. Meta can override your choice during review.' },
      { title: 'Write the body with variables', body: 'Use {{1}}, {{2}} placeholders for personalised fields. Keep promotional language out of Utility templates or Meta will re-categorise or reject them.' },
      { title: 'Add sample values and optional buttons', body: 'Every variable needs an example so Meta can review it. You can add quick-reply or call-to-action buttons.' },
      { title: 'Submit and watch the status', body: 'The template shows Pending, then Approved or Rejected — usually within minutes to a few hours. Approved templates become selectable in the campaign builder.' },
    ],
    tips: [
      'Rejections almost always cite policy: promotional content in a Utility template, missing sample values, or a variable at the very start/end of the body.',
      'If Meta changes your category from Utility to Marketing, your per-message cost changes too.',
    ],
  },
  {
    slug: 'why-templates-get-rejected',
    title: 'Why Templates Get Rejected (and How to Fix Them)',
    category: 'templates', type: 'troubleshooting', difficulty: 'intermediate', duration: '6 min',
    description: 'The common rejection reasons and the concrete edit that clears each one.',
    tags: ['rejected', 'meta approval', 'policy', 'fix'],
    intro: 'A rejected template blocks the campaign that needs it. This guide lists the reasons Meta gives most often and the specific change that resolves each.',
    learn: [
      'How to read the rejection reason Meta returns',
      'Fixes for: policy violation, invalid format, missing samples, variable placement, and category mismatch',
      'When to resubmit vs. clone into a new template',
    ],
    tips: [
      'You cannot edit an approved template’s body without re-review; clone it, change the copy, resubmit.',
      'Variables cannot sit at the start or end of the body, or immediately next to another variable.',
    ],
  },
  {
    slug: 'template-variables-and-samples',
    title: 'Using Variables, Buttons & Sample Values',
    category: 'templates', type: 'guide', difficulty: 'intermediate', duration: '5 min',
    description: 'Personalise templates with variables and add interactive buttons the right way.',
    tags: ['variables', 'buttons', 'personalisation', 'samples'],
    intro: 'Variables make one template serve thousands of recipients. This guide covers numbering, sample values, header/body/footer components and the two button types.',
    learn: [
      'How {{n}} placeholders map to campaign columns or API parameters',
      'Why every variable needs a representative sample value',
      'Quick-reply vs. call-to-action (URL / phone) buttons and their limits',
    ],
    tips: ['Map campaign audience columns to variables carefully — an off-by-one mapping personalises every message wrong.'],
  },
  {
    slug: 'import-contacts-csv',
    title: 'Import Contacts from a CSV',
    category: 'contacts', type: 'guide', difficulty: 'beginner', duration: '5 min',
    description: 'Prepare a CSV, map columns, and import contacts without duplicates.',
    tags: ['contacts', 'csv', 'import', 'phone format'],
    popular: true,
    intro: 'Campaigns need an audience. The fastest way to build one is a CSV import. This guide covers the file format, phone-number normalisation and how re-imports are de-duplicated.',
    learn: [
      'The required and optional columns, and accepted phone number formats',
      'How Spandan matches rows to existing contacts on re-import',
      'Applying tags during import so the data is segment-ready',
    ],
    steps: [
      { title: 'Prepare the file', body: 'One row per contact. Include a phone column in international format (with country code). Name and any custom fields are optional.' },
      { title: 'Upload and map columns', body: 'In Contacts, choose Import and match each CSV column to a contact field. Unmatched columns can be stored as custom attributes.' },
      { title: 'Choose a tag', body: 'Apply a tag to the whole import (for example "webinar-oct") so you can target exactly this group later.' },
      { title: 'Review the result', body: 'The import summary shows created, updated and skipped rows. Skipped rows are usually invalid phone numbers.' },
    ],
    tips: ['Numbers without a country code are rejected — normalise the column before uploading.'],
  },
  {
    slug: 'build-segments',
    title: 'Build Segments & Audiences',
    category: 'contacts', type: 'guide', difficulty: 'intermediate', duration: '6 min',
    description: 'Turn tags and attributes into reusable audiences for campaigns.',
    tags: ['segments', 'audience', 'tags', 'filters'],
    intro: 'A segment is a saved filter over your contacts. This guide shows how to combine tags, attributes and activity into audiences you can reuse across campaigns.',
    learn: [
      'The difference between a manual cluster and a rule-based segment',
      'Combining conditions (tag AND attribute, opted-in only, last-active window)',
      'How segment size is recalculated as contacts change',
    ],
    tips: ['Segments are evaluated at campaign launch, so a growing segment picks up new matching contacts automatically.'],
  },
  {
    slug: 'manage-opt-outs',
    title: 'Managing Opt-outs & Consent',
    category: 'contacts', type: 'guide', difficulty: 'intermediate', duration: '4 min',
    description: 'How opt-outs are captured, honoured and reported.',
    tags: ['opt-out', 'consent', 'compliance', 'stop'],
    intro: 'Messaging people who opted out damages your quality rating and breaks WhatsApp policy. This guide covers how Spandan records opt-outs and keeps them out of future sends.',
    learn: [
      'How inbound "STOP"-style messages and manual flags mark a contact opted-out',
      'That opted-out contacts are automatically excluded from every campaign',
      'Where to see and, with consent, reverse an opt-out',
    ],
    tips: ['Never re-import an opted-out contact from a CSV expecting to message them — the opt-out flag persists on the contact record.'],
  },
  {
    slug: 'launch-first-campaign',
    title: 'Launch Your First WhatsApp Campaign',
    category: 'campaigns', type: 'guide', difficulty: 'beginner', duration: '9 min',
    description: 'Select a number, choose an approved template, pick an audience, schedule and launch.',
    tags: ['campaign', 'broadcast', 'schedule', 'launch', 'delivery'],
    featured: true, popular: true,
    intro: 'A campaign sends one approved template to an audience on your schedule. This guide walks the builder step by step and explains what happens at launch.',
    learn: [
      'Every field in the campaign builder and what it controls',
      'How the wallet reservation works at launch and what happens to unsent budget',
      'How to read the live delivery, read and failure counters',
      'When to attach an AI Agent or workflow to handle replies',
    ],
    steps: [
      { title: 'Name the campaign and pick a number', body: 'The send-from number determines which approved templates are available.' },
      { title: 'Choose an approved template', body: 'Only Approved templates for that number appear. Map its variables to audience fields.' },
      { title: 'Select the audience', body: 'Pick a segment, a tag or an uploaded list. The builder shows the recipient count.' },
      { title: 'Set the schedule and pacing', body: 'Send now or schedule for later. Optionally throttle the send rate and set retry behaviour for soft failures.' },
      { title: 'Review the cost estimate', body: 'The builder estimates cost as recipients × per-message rate for the template’s category. Launch is blocked if the wallet can’t cover it.' },
      { title: 'Launch and monitor', body: 'On launch the budget is reserved and the queue worker starts sending. The campaign detail view shows Sent / Delivered / Read / Failed updating from webhooks.' },
    ],
    tips: [
      'Delivery receipts arrive asynchronously — "Awaiting receipts" is normal for the first minutes.',
      'Budget reserved for messages that never send (invalid numbers, opt-outs) is released back to the wallet.',
    ],
  },
  {
    slug: 'schedule-and-throttle-campaigns',
    title: 'Scheduling, Throttling & Retries',
    category: 'campaigns', type: 'guide', difficulty: 'intermediate', duration: '6 min',
    description: 'Control when a campaign sends, how fast, and what happens on failure.',
    tags: ['schedule', 'throttle', 'retry', 'pacing', 'queue'],
    intro: 'For large audiences, how you pace a send matters as much as the content. This guide covers scheduling, send-rate throttling and the retry policy for transient failures.',
    learn: [
      'Scheduling in the workspace timezone and editing a scheduled campaign before it fires',
      'Why throttling protects a newer number’s quality rating',
      'Which failures are retried automatically and which are permanent',
    ],
    tips: ['A campaign can be cancelled while it is Draft, Scheduled or Running — pending messages are then not sent and their budget is released.'],
  },
  {
    slug: 'campaign-delivery-troubleshooting',
    title: 'Campaign Sent but Not Delivered',
    category: 'campaigns', type: 'troubleshooting', difficulty: 'intermediate', duration: '7 min',
    description: 'Work through the reasons messages show Sent but never reach Delivered.',
    tags: ['delivery', 'failed', 'webhook', 'quality', 'fix'],
    intro: 'Sent means Spandan handed the message to Meta; Delivered means Meta reached the handset. This guide covers the gap between the two.',
    learn: [
      'How to tell a webhook delay apart from a real delivery failure',
      'Common per-recipient failure reasons (no WhatsApp account, blocked, invalid number)',
      'Number-level causes: quality rating, tier limit reached, template paused',
    ],
    tips: [
      'If the whole campaign is stuck at Sent, check the number’s status and quality rating first.',
      'If only some recipients fail, open the campaign detail and read the per-recipient failReason.',
    ],
  },
  {
    slug: 'shared-inbox-basics',
    title: 'Working the Shared Inbox',
    category: 'inbox', type: 'guide', difficulty: 'beginner', duration: '6 min',
    description: 'Assign conversations, reply, leave internal notes and use quick replies.',
    tags: ['inbox', 'conversations', 'assignment', 'quick replies', 'notes'],
    popular: true,
    intro: 'Every inbound WhatsApp message lands in the Shared Inbox. This guide covers the day-to-day: claiming a conversation, replying inside the service window, and collaborating with notes.',
    learn: [
      'The conversation list, filters and unread indicators',
      'Assigning a conversation to yourself or a teammate',
      'Internal notes (not sent to the customer) vs. replies',
      'When you need a template because the 24-hour window has closed',
    ],
    tips: ['If the reply box asks you to pick a template, the free-text service window has expired — the customer must message again, or you send a template.'],
  },
  {
    slug: 'assignment-and-sla',
    title: 'Assignment Rules & the 24-hour Window',
    category: 'inbox', type: 'guide', difficulty: 'intermediate', duration: '5 min',
    description: 'Route conversations to the right agent and understand the service window.',
    tags: ['assignment', 'routing', 'sla', '24 hour window', 'session'],
    intro: 'WhatsApp only allows free-text replies for 24 hours after the customer’s last message. This guide explains that window and how conversations get routed to agents.',
    learn: [
      'How the 24-hour service window opens, resets and closes',
      'Auto-assignment options and manual reassignment',
      'What the AI Agent or a workflow can do while no human is assigned',
    ],
    tips: ['Each new inbound message from the customer resets the 24-hour clock.'],
  },
  {
    slug: 'keyword-triggers',
    title: 'Set Up Keyword Triggers',
    category: 'automation', type: 'guide', difficulty: 'beginner', duration: '5 min',
    description: 'Auto-reply to specific words with a canned message — no flow required.',
    tags: ['keyword', 'trigger', 'auto-reply', 'automation'],
    intro: 'Keyword triggers are the simplest automation: when an inbound message matches a word or phrase, Spandan sends a reply. Use them for FAQs and menu prompts.',
    learn: [
      'Exact-match vs. contains matching, and case sensitivity',
      'Ordering and precedence when multiple keywords could match',
      'When to graduate from a keyword to a full workflow',
    ],
    tips: ['If a keyword and a workflow both match, the more specific keyword reply usually wins — test with a real message.'],
  },
  {
    slug: 'build-a-workflow',
    title: 'Build a Multi-step Workflow',
    category: 'automation', type: 'workflow', difficulty: 'intermediate', duration: '8 min',
    description: 'Chain triggers, conditions, delays and messages into an automated sequence.',
    tags: ['workflow', 'flow builder', 'conditions', 'delay', 'branch'],
    featured: true,
    intro: 'A workflow handles anything with a branch or a delay: welcome sequences, drip follow-ups, conditional routing. This guide covers the builder’s building blocks and how to test safely.',
    learn: [
      'The node types: trigger, condition, action (send message / add tag / assign), delay',
      'Branching on contact attributes or the customer’s reply',
      'Testing a workflow against a test contact before activating it',
      'How an active workflow interacts with the Shared Inbox and AI Agent',
    ],
    steps: [
      { title: 'Choose a trigger', body: 'Start from an inbound keyword, a new contact, a tag being added, or a campaign reply.' },
      { title: 'Add the first message', body: 'Inside the 24-hour window you can send free text; outside it you must use a template node.' },
      { title: 'Add a condition to branch', body: 'Split on a contact attribute or the content of the customer’s reply. Each branch continues independently.' },
      { title: 'Insert delays where needed', body: 'A delay node waits minutes, hours or days before the next step — this is what makes it a workflow rather than a keyword.' },
      { title: 'Test, then activate', body: 'Run the workflow against a test contact, confirm each branch, then switch it to Active.' },
    ],
    tips: ['A workflow paused mid-run for a contact resumes from the same node when reactivated — it does not restart.'],
  },
  {
    slug: 'intent-matching',
    title: 'Configure Intent Matching',
    category: 'automation', type: 'guide', difficulty: 'advanced', duration: '6 min',
    description: 'Route messages by meaning instead of exact keywords.',
    tags: ['intent', 'nlu', 'confidence', 'routing', 'ai'],
    intro: 'Intent matching classifies an inbound message into one of your defined intents ("track order", "cancel", "pricing") so a workflow can act on meaning rather than exact words.',
    learn: [
      'Defining intents with a handful of example phrases each',
      'Setting a confidence threshold that fits your traffic',
      'Falling back to a human or the AI Agent when confidence is low',
    ],
    tips: ['Start with a high threshold and loosen it — misrouted messages erode trust faster than an occasional "didn’t understand".'],
  },
  {
    slug: 'deploy-ai-agent',
    title: 'Deploy the WhatsApp AI Agent',
    category: 'ai-agent', type: 'guide', difficulty: 'intermediate', duration: '8 min',
    description: 'Write a persona, attach a knowledge base, test in the sandbox, then go live.',
    tags: ['ai agent', 'persona', 'knowledge base', 'sandbox', 'deploy'],
    featured: true, popular: true,
    intro: 'The AI Agent answers inbound conversations automatically using a persona you write and a knowledge base you provide. This guide covers configuring it and rolling it out safely.',
    learn: [
      'Writing a persona: tone, scope, and explicit "do not" boundaries',
      'Adding knowledge sources and keeping them current',
      'Sandbox testing before the agent touches real customers',
      'Choosing where it runs: all conversations, specific workflows, or after hours only',
      'Hand-off rules so a human takes over when needed',
    ],
    steps: [
      { title: 'Write the persona', body: 'Describe who the agent is, what it can help with, and what it must refuse or escalate. Be explicit about pricing claims, refunds and anything legal.' },
      { title: 'Attach a knowledge base', body: 'Add FAQ text, help articles or a website URL to index. The agent answers from this content rather than guessing.' },
      { title: 'Set guardrails and hand-off', body: 'Define when the agent should stop and assign a human — angry sentiment, explicit "talk to a person", or an unknown topic.' },
      { title: 'Test in the sandbox', body: 'Chat with the agent privately. Try the awkward cases: out-of-scope questions, multi-part questions, attempts to get it to promise things.' },
      { title: 'Deploy to a limited scope', body: 'Start with after-hours or a single workflow. Watch transcripts in the Shared Inbox, then widen scope.' },
    ],
    tips: [
      'An agent with no knowledge base will still reply — vaguely. Always attach content before going live.',
      'Review the first day of transcripts closely; most persona fixes are obvious within a few real conversations.',
    ],
  },
  {
    slug: 'ai-agent-knowledge-base',
    title: 'Give Your AI Agent a Knowledge Base',
    category: 'ai-agent', type: 'guide', difficulty: 'intermediate', duration: '5 min',
    description: 'Add and maintain the content the agent answers from.',
    tags: ['knowledge base', 'indexing', 'faq', 'website'],
    intro: 'The knowledge base is what separates a useful agent from a plausible-sounding one. This guide covers what to add, how indexing works, and keeping it fresh.',
    learn: [
      'Supported sources: pasted text, uploaded docs, and crawlable URLs',
      'How re-indexing picks up changes to your site or docs',
      'Structuring content so answers are specific, not generic',
    ],
    tips: ['Short, single-topic entries retrieve better than one giant document.'],
  },
  {
    slug: 'website-widget-setup',
    title: 'Install the Website Widget',
    category: 'website-widget', type: 'guide', difficulty: 'beginner', duration: '5 min',
    description: 'Embed the chat widget and route visitors into WhatsApp.',
    tags: ['widget', 'embed', 'website', 'handoff'],
    intro: 'The Website Widget puts a chat launcher on your site. Visitors can talk to the AI Agent or the knowledge base, then continue the conversation on WhatsApp.',
    learn: [
      'Adding the embed snippet to your site',
      'Customising the launcher and greeting',
      'The hand-off that moves a web chat into a WhatsApp conversation',
    ],
    tips: ['The widget shares the AI Agent’s knowledge base — configure the agent first.'],
  },
  {
    slug: 'instagram-automation-setup',
    title: 'Set Up Instagram Automation',
    category: 'instagram', type: 'guide', difficulty: 'intermediate', duration: '6 min',
    description: 'Connect an Instagram business account and automate DMs and story replies.',
    tags: ['instagram', 'dm', 'story reply', 'automation'],
    intro: 'Instagram automation reuses the same triggers, workflows and AI Agent you built for WhatsApp, applied to Instagram DMs and story replies.',
    learn: [
      'Linking an Instagram professional account via Meta',
      'Which automation building blocks carry over from WhatsApp',
      'Where Instagram conversations appear in the Shared Inbox',
    ],
    tips: ['Instagram has its own messaging window rules — automations that assume WhatsApp’s 24-hour window need checking.'],
  },
  {
    slug: 'voice-ai-overview',
    title: 'Voice AI: Overview & Setup',
    category: 'voice-ai', type: 'guide', difficulty: 'advanced', duration: '7 min',
    description: 'Answer phone calls with a voice agent that uses your knowledge base.',
    tags: ['voice ai', 'calls', 'ivr', 'knowledge base'],
    intro: 'Voice AI answers inbound calls with a spoken agent. It draws on the same knowledge base as the WhatsApp AI Agent and can hand off to a human or send a WhatsApp follow-up.',
    learn: [
      'What Voice AI can and cannot do today',
      'Connecting a phone number for voice',
      'Designing prompts for speech rather than text',
      'Escalation and post-call WhatsApp follow-up',
    ],
    tips: ['Keep spoken answers short — a paragraph that reads fine is a long time to listen to.'],
  },
  {
    slug: 'connect-an-integration',
    title: 'Connect a Third-party Integration',
    category: 'integrations', type: 'guide', difficulty: 'beginner', duration: '4 min',
    description: 'Link Shopify, HubSpot, Zapier and others to sync data and trigger sends.',
    tags: ['integrations', 'shopify', 'zapier', 'hubspot', 'sync'],
    intro: 'Integrations connect Spandan to the tools you already use — to sync contacts, trigger campaigns on external events, or push conversation data out.',
    learn: [
      'The connection flow (OAuth or API key) and what each integration can access',
      'Which integrations are included vs. paid add-ons',
      'Disconnecting cleanly without losing synced data',
    ],
    tips: ['Check the direction of sync before relying on it — some integrations are one-way.'],
  },
  {
    slug: 'api-quickstart',
    title: 'Public API Quickstart',
    category: 'developers', type: 'api', difficulty: 'intermediate', duration: '8 min',
    description: 'Authenticate with an API key and send your first message programmatically.',
    tags: ['api', 'rest', 'send message', 'api key', 'quickstart'],
    featured: true, popular: true,
    intro: 'The Public API lets you send messages, manage contacts and read campaign data from your own code. This guide gets you from an API key to a delivered message.',
    learn: [
      'Where to create an API key and how requests are scoped to your workspace',
      'The base URL pattern and how workspace-scoped routes are structured',
      'Sending a template message via the API and reading the response',
      'Handling errors and rate limits',
    ],
    steps: [
      { title: 'Create an API key', body: 'In API Keys, generate a key. It is shown once — store it in your secret manager. Keys act on behalf of your workspace.' },
      { title: 'Make an authenticated request', body: 'Send the key as a Bearer token in the Authorization header. Workspace-scoped endpoints live under the workspace path.' },
      { title: 'Send a template message', body: 'POST the recipient, the approved template name and its variable values. The response includes a message id you can correlate with webhooks.' },
      { title: 'Confirm delivery', body: 'Register a webhook (see the Webhooks guide) to receive sent / delivered / read / failed events for messages you send via the API.' },
    ],
    tips: [
      'This guide is intentionally endpoint-shape only. Use the API Keys screen in-app as the source of truth for exact paths and payloads for your workspace.',
      'Treat an API key like a password — rotate it if it leaks and delete unused keys.',
    ],
  },
  {
    slug: 'authentication-api-keys',
    title: 'Authentication & API Keys',
    category: 'developers', type: 'api', difficulty: 'intermediate', duration: '5 min',
    description: 'How API keys work, how requests are authorised, and how to rotate safely.',
    tags: ['authentication', 'api key', 'bearer token', 'security', 'rotation'],
    intro: 'Every Public API request is authenticated with a workspace API key sent as a Bearer token. This guide covers creating, scoping, rotating and revoking keys.',
    learn: [
      'The Bearer-token scheme and why keys are workspace-scoped',
      'Creating multiple keys so you can rotate without downtime',
      'Revoking a key immediately and what breaks when you do',
    ],
    tips: ['Create a second key, deploy it, then revoke the old one — zero-downtime rotation.'],
  },
  {
    slug: 'webhooks-guide',
    title: 'Receiving Webhooks',
    category: 'developers', type: 'api', difficulty: 'advanced', duration: '7 min',
    description: 'Register an endpoint and handle message-status and inbound-message events.',
    tags: ['webhooks', 'events', 'signature', 'inbound', 'status'],
    intro: 'Webhooks push events to your server: message status changes and inbound messages. This guide covers registering an endpoint, verifying payloads and handling retries.',
    learn: [
      'The event types: message status (sent/delivered/read/failed) and inbound messages',
      'Verifying the request signature before trusting a payload',
      'Responding quickly and processing asynchronously so deliveries are not retried',
      'How Spandan itself consumes Meta’s webhook — the same pattern applies to yours',
    ],
    tips: [
      'Return 2xx fast. Do the real work in a queue, or the sender will retry and you will double-process.',
      'Always verify the signature — an unauthenticated webhook endpoint is an open door.',
    ],
  },
  {
    slug: 'recharge-your-wallet',
    title: 'Recharge Your Wallet',
    category: 'billing', type: 'guide', difficulty: 'beginner', duration: '3 min',
    description: 'Add funds so campaigns can reserve their budget at launch.',
    tags: ['wallet', 'recharge', 'payments', 'balance'],
    featured: true, popular: true,
    intro: 'The wallet is a prepaid balance that covers per-message costs. A campaign cannot launch if the wallet can’t cover its estimate. This guide covers topping up and low-balance alerts.',
    learn: [
      'How to add funds in Payments and when the balance updates',
      'The low-balance alert and where to set its threshold',
      'How a campaign reservation shows against your balance and when it is released',
    ],
    steps: [
      { title: 'Open Payments', body: 'The Payments screen shows the current balance from the wallet ledger and recent transactions.' },
      { title: 'Choose an amount and pay', body: 'Pick a top-up amount and complete checkout. The balance updates as soon as payment confirms.' },
      { title: 'Set a low-balance alert', body: 'Set a threshold so you are warned before a campaign is blocked for lack of funds.' },
    ],
    tips: ['Budget reserved at launch for messages that never send is refunded to the wallet automatically.'],
  },
  {
    slug: 'how-billing-works',
    title: 'How Per-message Billing Works',
    category: 'billing', type: 'guide', difficulty: 'beginner', duration: '5 min',
    description: 'Per-message pricing by template category, launch-time reservation, and refunds.',
    tags: ['billing', 'pricing', 'category', 'reservation', 'refund'],
    popular: true,
    intro: 'Spandan passes through Meta’s per-message pricing with no markup. This guide explains what you pay, when you pay it, and what gets refunded.',
    learn: [
      'How price varies by template category (Marketing / Utility / Authentication) and destination',
      'That a campaign reserves its full estimated cost at launch',
      'Which messages are refunded: never-sent, hard-failed before send',
      'Where the wallet ledger records every debit and credit',
    ],
    tips: ['Service (free-text) replies inside the 24-hour window are not charged the same way as template sends — check the ledger to see exactly what each conversation cost.'],
  },
  {
    slug: 'reading-your-analytics',
    title: 'Reading Your Analytics',
    category: 'analytics', type: 'guide', difficulty: 'beginner', duration: '5 min',
    description: 'What each analytics screen shows and how to act on it.',
    tags: ['analytics', 'reports', 'funnel', 'retention', 'chat activity'],
    intro: 'Spandan’s analytics cover three angles: campaign delivery funnels, chat activity, and customer retention. This guide explains each and what a healthy chart looks like.',
    learn: [
      'The campaign funnel: sent → delivered → read → replied, and where drop-off matters',
      'Chat activity: volume, response time and resolution over time',
      'Retention: how repeat conversations are grouped and read',
    ],
    tips: ['A high delivered but low read rate usually points at template content or send timing, not deliverability.'],
  },
  {
    slug: 'invite-team-members',
    title: 'Invite Team Members & Assign Roles',
    category: 'team', type: 'guide', difficulty: 'beginner', duration: '4 min',
    description: 'Add teammates to the workspace and give them the right level of access.',
    tags: ['team', 'invite', 'roles', 'permissions'],
    popular: true,
    intro: 'A workspace can have many members, each with a role that controls what they can see and do. This guide covers sending invitations and picking roles.',
    learn: [
      'The invitation flow and what the invitee sees',
      'The available roles and the capability differences between them',
      'Changing a member’s role or removing them',
    ],
    steps: [
      { title: 'Open Team settings', body: 'The Team section of Settings lists current members and pending invitations.' },
      { title: 'Send an invitation', body: 'Enter the teammate’s email and choose their role. They get a link to join this workspace.' },
      { title: 'Adjust later if needed', body: 'Roles can be changed after the fact; removing a member revokes their access immediately.' },
    ],
    tips: ['Give new agents the Agent role, not Admin — they get the Shared Inbox without settings, billing or number access.'],
  },
  {
    slug: 'roles-and-permissions',
    title: 'Roles & Permissions Reference',
    category: 'team', type: 'guide', difficulty: 'intermediate', duration: '5 min',
    description: 'A capability-by-capability breakdown of each workspace role.',
    tags: ['roles', 'permissions', 'admin', 'member', 'agent', 'viewer'],
    intro: 'This is the reference for who can do what. Use it when deciding which role to give someone or debugging why a teammate can’t access a screen.',
    learn: [
      'Admin vs. Member vs. Agent vs. Viewer across settings, billing, campaigns, templates and the inbox',
      'Which actions are Admin-only (number setup, wallet, API keys, team management)',
      'How the super-admin/platform role differs from a workspace Admin',
    ],
    tips: ['If a teammate reports a missing menu item, it is almost always their role — check it before anything else.'],
  },
];

/* ── Interactive product journeys ───────────────────────────────────────────── */
export const JOURNEYS = [
  {
    id: 'launch-first-campaign',
    title: 'Launch Your First Campaign',
    summary: 'The full path from an empty workspace to a monitored, delivered broadcast.',
    steps: [
      { title: 'Connect WhatsApp Number', module: 'whatsapp-numbers',
        detail: 'Connect and verify a number in Number Setup. Everything downstream is blocked until it reads Active.',
        prerequisites: ['A Meta Business account (for embedded signup) or WABA credentials'],
        result: 'A number with Active status and a visible quality rating.',
        errors: ['Number already registered on the consumer WhatsApp app', 'Business verification incomplete'] },
      { title: 'Create an Approved Template', module: 'templates',
        detail: 'Submit at least one template in the right category and wait for Meta to approve it.',
        prerequisites: ['An Active number to attach the template to'],
        result: 'A template showing Approved, selectable in the campaign builder.',
        errors: ['Promotional wording in a Utility template', 'Missing sample values for variables'] },
      { title: 'Add Contacts', module: 'contacts',
        detail: 'Import a CSV or add contacts, then tag or segment them into an audience.',
        prerequisites: ['Phone numbers in international format'],
        result: 'A segment or tag with a non-zero recipient count.',
        errors: ['Rows skipped for missing country code', 'Opted-out contacts silently excluded'] },
      { title: 'Fund the Wallet', module: 'billing',
        detail: 'Recharge in Payments so the campaign can reserve its estimated cost at launch.',
        prerequisites: ['A payment method'],
        result: 'A wallet balance above the campaign’s cost estimate.',
        errors: ['Balance below estimate blocks launch', 'Payment still pending — balance not yet updated'] },
      { title: 'Build the Campaign', module: 'campaigns',
        detail: 'In the builder pick the number, the approved template, the audience, the schedule and pacing.',
        prerequisites: ['Active number', 'Approved template', 'Audience', 'Funded wallet'],
        result: 'A Draft campaign with a recipient count and cost estimate.',
        errors: ['Variable mapping off by one column', 'Template not Approved for the chosen number'] },
      { title: 'Launch', module: 'campaigns',
        detail: 'Launch now or on schedule. The budget is reserved and the queue worker starts sending.',
        prerequisites: ['A reviewed cost estimate'],
        result: 'Campaign status Running (or Scheduled), counters initialising.',
        errors: ['Wallet dropped below estimate between build and launch'] },
      { title: 'Monitor Delivery', module: 'campaigns',
        detail: 'Open the campaign detail view. Sent / Delivered / Read / Failed update from Meta webhooks.',
        prerequisites: ['A launched campaign'],
        result: 'A delivery funnel you can read, with per-recipient failure reasons.',
        errors: ['"Awaiting receipts" for minutes is normal', 'Whole campaign stuck at Sent → check number quality'] },
    ],
  },
  {
    id: 'connect-whatsapp',
    title: 'Connect Your WhatsApp Number',
    summary: 'Get from no number to an Active, sendable WhatsApp Business number.',
    steps: [
      { title: 'Choose a Connection Method', module: 'whatsapp-numbers',
        detail: 'Embedded signup (your own number + Meta account), an instant pool number, or bring-your-own WABA credentials.',
        prerequisites: ['Decide whether you need a custom display name (rules out pool numbers)'],
        result: 'A method selected in Number Setup.',
        errors: ['Picking a pool number when you need branded display name'] },
      { title: 'Run Meta Embedded Signup', module: 'whatsapp-numbers',
        detail: 'Complete Meta’s popup flow: business verification, phone ownership, display-name submission.',
        prerequisites: ['Admin access to a Meta Business account'],
        result: 'Meta returns the number to Spandan in Pending state.',
        errors: ['Popup blocked by the browser', 'Business not verified with Meta'] },
      { title: 'Verify Phone Ownership', module: 'whatsapp-numbers',
        detail: 'Enter the OTP Meta sends to the number by SMS or call.',
        prerequisites: ['Access to receive a code on that number'],
        result: 'Phone ownership confirmed.',
        errors: ['Number still active on the consumer WhatsApp app — delete it there first'] },
      { title: 'Wait for Active Status', module: 'whatsapp-numbers',
        detail: 'The number flips from Pending to Active when Meta confirms. Display-name approval is separate and slower.',
        prerequisites: [],
        result: 'Number shows Active with a quality rating.',
        errors: ['Stuck in Pending for hours → check Meta Business Manager for a blocking task'] },
      { title: 'Send a Test Message', module: 'whatsapp-numbers',
        detail: 'Use the test send in Number Setup or reply to yourself in the Shared Inbox.',
        prerequisites: ['An Active number'],
        result: 'A message you receive on a real handset.',
        errors: ['Sending to a number that has never messaged you needs a template'] },
      { title: 'Note Quality & Limits', module: 'whatsapp-numbers',
        detail: 'Record the starting quality rating and messaging tier so you can spot a downgrade later.',
        prerequisites: [],
        result: 'A baseline you can monitor.',
        errors: [] },
    ],
  },
  {
    id: 'template-approval',
    title: 'Get a Template Approved',
    summary: 'Draft, sample, submit and land an Approved template without a rejection loop.',
    steps: [
      { title: 'Pick the Category', module: 'templates',
        detail: 'Marketing, Utility or Authentication. The category sets the price and the policy bar.',
        prerequisites: ['Know whether the message is promotional or transactional'],
        result: 'A category chosen — honestly.',
        errors: ['Labelling a promo as Utility to save cost → Meta re-categorises or rejects'] },
      { title: 'Write the Body with Variables', module: 'templates',
        detail: 'Use {{1}}, {{2}} for personalised fields. Keep variables out of the first and last position.',
        prerequisites: [],
        result: 'Body text that reads naturally with sample data.',
        errors: ['Variable at the start/end of the body', 'Two variables adjacent with no text between'] },
      { title: 'Add Sample Values', module: 'templates',
        detail: 'Give every variable a realistic example so Meta can review the rendered message.',
        prerequisites: [],
        result: 'All variables have samples; submit is enabled.',
        errors: ['Missing samples is a top rejection reason'] },
      { title: 'Submit to Meta', module: 'templates',
        detail: 'Submit and watch the status move from Pending.',
        prerequisites: ['A connected number to own the template'],
        result: 'Status Pending, then Approved or Rejected.',
        errors: [] },
      { title: 'Handle the Outcome', module: 'templates',
        detail: 'Approved → use it. Rejected → read the reason, edit a clone, resubmit. Category changed → check your new price.',
        prerequisites: [],
        result: 'An Approved template, or a clear next edit.',
        errors: ['Trying to edit an approved template in place — clone it instead'] },
    ],
  },
  {
    id: 'setup-automation',
    title: 'Set Up Automation',
    summary: 'Go from manual replies to a tested, active workflow.',
    steps: [
      { title: 'Map the Conversation', module: 'automation',
        detail: 'Write out the real back-and-forth you want to automate, including the branches.',
        prerequisites: ['A few real transcripts to work from'],
        result: 'A sketch of triggers, decisions and messages.',
        errors: ['Automating a flow you have never handled manually'] },
      { title: 'Choose the Trigger', module: 'automation',
        detail: 'Keyword, new contact, tag added, or campaign reply. Keyword triggers alone may be enough for FAQs.',
        prerequisites: [],
        result: 'A trigger that fires on the right event.',
        errors: ['Overlapping keywords across multiple triggers'] },
      { title: 'Add Steps and Branches', module: 'automation',
        detail: 'Add message, condition and delay nodes. A delay is what makes this a workflow rather than a keyword reply.',
        prerequisites: ['Templates for any step outside the 24-hour window'],
        result: 'A complete flow with every branch ending somewhere.',
        errors: ['A branch with no terminal step', 'Free-text node where a template is required'] },
      { title: 'Test Against a Test Contact', module: 'automation',
        detail: 'Run the workflow end to end for each branch before it touches customers.',
        prerequisites: ['A test contact you control'],
        result: 'Every branch verified.',
        errors: ['Only testing the happy path'] },
      { title: 'Activate and Watch', module: 'automation',
        detail: 'Switch to Active and watch the first real runs in the Shared Inbox.',
        prerequisites: [],
        result: 'A live workflow with observed real runs.',
        errors: ['Not checking how it interacts with the AI Agent or assignment rules'] },
    ],
  },
  {
    id: 'deploy-ai-agent',
    title: 'Deploy the AI Agent',
    summary: 'Persona, knowledge, guardrails, sandbox, limited rollout, then scale.',
    steps: [
      { title: 'Write the Persona', module: 'ai-agent',
        detail: 'Tone, scope, and explicit refusals. Be specific about pricing, refunds and legal topics.',
        prerequisites: [],
        result: 'A persona a stranger could follow.',
        errors: ['Vague scope → the agent answers things it should escalate'] },
      { title: 'Attach a Knowledge Base', module: 'ai-agent',
        detail: 'Add FAQ text, docs or a site URL to index. Short single-topic entries retrieve best.',
        prerequisites: ['Up-to-date content'],
        result: 'The agent answers from your content, not guesses.',
        errors: ['Going live with no knowledge base'] },
      { title: 'Set Guardrails & Hand-off', module: 'ai-agent',
        detail: 'Define when to stop and assign a human: anger, "talk to a person", unknown topic.',
        prerequisites: [],
        result: 'Clear escalation rules.',
        errors: ['No hand-off path → frustrated customers stuck with the bot'] },
      { title: 'Test in the Sandbox', module: 'ai-agent',
        detail: 'Try out-of-scope questions, multi-part questions and attempts to extract promises.',
        prerequisites: [],
        result: 'Confidence in the awkward cases, not just the easy ones.',
        errors: ['Only testing questions you already know it can answer'] },
      { title: 'Deploy to a Limited Scope', module: 'ai-agent',
        detail: 'Start after-hours or on one workflow. Read transcripts, tune the persona, then widen.',
        prerequisites: ['Sandbox testing done'],
        result: 'A live agent on a small surface with reviewed transcripts.',
        errors: ['Enabling it on all conversations on day one'] },
      { title: 'Review & Scale', module: 'ai-agent',
        detail: 'After a day of real transcripts, apply the obvious persona fixes and expand scope.',
        prerequisites: ['At least a day of real conversations'],
        result: 'A tuned agent handling a widening share of conversations.',
        errors: [] },
    ],
  },
  {
    id: 'invite-team-member',
    title: 'Invite a Team Member',
    summary: 'Add a teammate with exactly the access they need.',
    steps: [
      { title: 'Open Team Settings', module: 'team',
        detail: 'Settings → Team shows members and pending invitations.',
        prerequisites: ['Admin role'],
        result: 'The team management screen.',
        errors: ['Non-admins cannot invite — check your role'] },
      { title: 'Send the Invitation', module: 'team',
        detail: 'Enter their email and pick a role now, not later.',
        prerequisites: ['Their email address'],
        result: 'A pending invitation and a join link sent to them.',
        errors: ['Typo in the email → invite never arrives'] },
      { title: 'Choose the Right Role', module: 'team',
        detail: 'Agent for inbox-only staff, Member for broader access, Admin only for people who manage billing/numbers/keys, Viewer for read-only.',
        prerequisites: [],
        result: 'Least-privilege access for the new teammate.',
        errors: ['Defaulting everyone to Admin'] },
      { title: 'Teammate Accepts', module: 'team',
        detail: 'They open the link, sign in or sign up, and land in your workspace.',
        prerequisites: [],
        result: 'An active member in the list.',
        errors: ['They created a brand-new workspace instead of accepting — resend the link'] },
      { title: 'Set Inbox Assignment', module: 'inbox',
        detail: 'Add them to assignment rules so conversations actually route to them.',
        prerequisites: ['An accepted member'],
        result: 'Conversations reaching the new agent.',
        errors: ['Member added but never included in routing'] },
    ],
  },
  {
    id: 'recharge-wallet',
    title: 'Recharge Your Wallet',
    summary: 'Top up and make sure a low balance never blocks a launch again.',
    steps: [
      { title: 'Open Payments', module: 'billing',
        detail: 'See the current balance from the wallet ledger and recent transactions.',
        prerequisites: [],
        result: 'A clear view of what you have and what you have spent.',
        errors: [] },
      { title: 'Choose an Amount', module: 'billing',
        detail: 'Estimate upcoming campaigns (recipients × per-message rate) and top up above that.',
        prerequisites: ['A rough sense of near-term volume'],
        result: 'A top-up amount that covers planned sends.',
        errors: ['Topping up exactly the estimate leaves no room for retries'] },
      { title: 'Pay', module: 'billing',
        detail: 'Complete checkout with your payment method.',
        prerequisites: ['A valid payment method'],
        result: 'Payment submitted.',
        errors: ['Closing the tab before confirmation'] },
      { title: 'Confirm the Balance', module: 'billing',
        detail: 'The balance updates when payment confirms; the ledger shows the credit.',
        prerequisites: [],
        result: 'A higher balance, visible in the sidebar and Payments.',
        errors: ['Balance not updated yet → payment still pending'] },
      { title: 'Set a Low-balance Alert', module: 'billing',
        detail: 'Set a threshold so you are warned before a campaign is blocked.',
        prerequisites: [],
        result: 'An alert that gives you lead time to top up.',
        errors: ['No alert set → next block is a surprise'] },
    ],
  },
];

/* ── Troubleshooting explorer map ───────────────────────────────────────────── */
export const TROUBLESHOOTING = [
  { id: 'connect-whatsapp', label: 'Connect WhatsApp',
    resources: ['connect-whatsapp-number', 'whatsapp-number-quality-rating'],
    tips: ['Number stuck in Pending → check Meta Business Manager for an incomplete verification task.',
      'Number already on the consumer WhatsApp app must be deleted there first.'] },
  { id: 'send-a-campaign', label: 'Send a Campaign',
    resources: ['launch-first-campaign', 'schedule-and-throttle-campaigns', 'campaign-delivery-troubleshooting'],
    tips: ['Launch blocked → wallet balance is below the cost estimate.',
      'Whole campaign stuck at Sent → check the number’s status and quality rating.'] },
  { id: 'template-approved', label: 'Get a Template Approved',
    resources: ['create-approved-template', 'why-templates-get-rejected', 'template-variables-and-samples'],
    tips: ['Rejected for policy → move promotional wording out of a Utility template.',
      'Add a sample value for every variable before resubmitting.'] },
  { id: 'receive-messages', label: 'Receive Messages',
    resources: ['shared-inbox-basics', 'assignment-and-sla', 'webhooks-guide'],
    tips: ['Replies not appearing → confirm the number is Active and the webhook is connected.',
      'Reply box forcing a template → the 24-hour service window has closed.'] },
  { id: 'configure-automation', label: 'Configure Automation',
    resources: ['keyword-triggers', 'build-a-workflow', 'intent-matching'],
    tips: ['Two automations firing → overlapping keywords; make one more specific.',
      'Workflow not starting → its trigger event is not the one you think it is; test with a real message.'] },
  { id: 'use-ai-agent', label: 'Use the AI Agent',
    resources: ['deploy-ai-agent', 'ai-agent-knowledge-base'],
    tips: ['Vague answers → attach or expand the knowledge base; split big docs into small entries.',
      'Agent won’t escalate → no hand-off rule is configured.'] },
  { id: 'recharge-wallet', label: 'Recharge the Wallet',
    resources: ['recharge-your-wallet', 'how-billing-works'],
    tips: ['Balance not updating → payment is still pending; give it a minute and refresh.',
      'Charged more than expected → template category may have been changed by Meta to Marketing.'] },
  { id: 'use-api', label: 'Use the API',
    resources: ['api-quickstart', 'authentication-api-keys', 'webhooks-guide'],
    tips: ['401 responses → key revoked or missing the Bearer prefix.',
      'Webhooks retrying → your endpoint is not returning 2xx fast enough; process async.'] },
];

/* ── Helpers ───────────────────────────────────────────────────────────────── */
const norm = (s) => String(s || '').toLowerCase();

export function getResource(slug) {
  return RESOURCES.find((r) => r.slug === slug) || null;
}

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

// Kept as a named export so components have one entry point for "all content".
export function allResources() {
  return RESOURCES;
}

export function lookup(slug) {
  return getResource(slug);
}

export function byCategory(catId) {
  return RESOURCES.filter((r) => r.category === catId);
}

export function categoryCount(catId) {
  return byCategory(catId).length;
}

// e.g. "Beginner", or "Beginner–Advanced" for a mixed section.
export function difficultyRange(catId) {
  const levels = [...new Set(byCategory(catId).map((r) => r.difficulty))]
    .sort((a, b) => DIFFICULTIES.indexOf(a) - DIFFICULTIES.indexOf(b));
  if (!levels.length) return null;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return levels.length === 1 ? cap(levels[0]) : `${cap(levels[0])}–${cap(levels[levels.length - 1])}`;
}

export function featuredInCategory(catId) {
  return byCategory(catId).find((r) => r.featured) || byCategory(catId)[0] || null;
}

// The next `n` categories after this one (wrapping), for a "Related sections" strip.
export function relatedCategories(catId, n = 3) {
  const list = CATEGORIES.filter((c) => c.id !== 'troubleshooting');
  const i = list.findIndex((c) => c.id === catId);
  const start = i === -1 ? 0 : i;
  const out = [];
  for (let k = 1; k <= list.length && out.length < n; k++) {
    const c = list[(start + k) % list.length];
    if (c.id !== catId) out.push(c);
  }
  return out;
}

export function featured() {
  return RESOURCES.filter((r) => r.featured);
}

export function popular() {
  return RESOURCES.filter((r) => r.popular);
}

export function search(query, pool) {
  const q = norm(query).trim();
  const list = pool || allResources();
  if (!q) return list;
  const terms = q.split(/\s+/);
  return list.filter((r) => {
    const hay = [
      r.title,
      r.description,
      r.intro,
      CATEGORY_NAME[r.category],
      r.type,
      r.difficulty,
      ...(r.tags || []),
      ...(r.learn || []),
      ...(r.tips || []),
      ...(r.steps ? r.steps.map(s => s.title + ' ' + (s.body || '') + ' ' + (s.detail || '')) : []),
    ].map(norm).join(' ');
    return terms.every((t) => hay.includes(t));
  });
}

export function getRelated(slug, n = 3) {
  const base = lookup(slug);
  if (!base) return [];
  const pool = allResources().filter((r) => r.slug !== slug);
  const scored = pool.map((r) => {
    let score = 0;
    if (r.category === base.category) score += 3;
    if (r.type === base.type) score += 1;
    const shared = (r.tags || []).filter((t) => (base.tags || []).includes(t)).length;
    score += shared;
    return { r, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((s) => s.r);
}

export function prevNext(slug) {
  const list = allResources();
  const i = list.findIndex((r) => r.slug === slug);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: i > 0 ? list[i - 1] : null,
    next: i < list.length - 1 ? list[i + 1] : null,
  };
}

export function getJourney(id) {
  return JOURNEYS.find((j) => j.id === id) || null;
}
