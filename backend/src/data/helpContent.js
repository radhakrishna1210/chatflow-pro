// User-facing help content: what each screen is for and how to get something
// done. This is the "how do I…" half of the assistant's knowledge; the
// marketing half lives in siteContent.js.
//
// These are documents, not answers. The assistant retrieves the relevant ones
// and writes a reply from them, so a guide should describe the real flow in
// plain prose and never try to anticipate a question's phrasing.
//
// One document per task, not per screen. "How do I import contacts" and "how
// do I build a cluster" are different questions with different answers, and a
// single Contacts page dumped into one chunk retrieves for both equally badly.
// Splitting by task is what lets retrieval return the steps someone asked for
// instead of the page they live on.
//
// Every step below was written against the actual UI — the wizard step titles
// in CreateCampaign.jsx, the sidebar labels and tab ids in Dashboard.jsx,
// AutomationView.jsx, SettingsView.jsx and the rest, down to the field labels.
// When a screen changes, the guide for it has to change too, or the assistant
// will confidently walk someone through a button that no longer exists.
//
// Nothing here states a price or a plan limit: those come from the Plan table
// at index time (see siteKnowledge.service.js), so they cannot go stale.

export const HELP_DOCS = [
  // ─── orientation ───────────────────────────────────────────────────────────
  {
    id: 'getting-started',
    title: 'Getting started with ChatFlow Pro',
    topic: 'Onboarding',
    body: `Sign up with an email address and password, or with Google. New accounts must create or join a workspace before the dashboard opens — a workspace is the container for everything you do, and it owns its own WhatsApp numbers, contacts, campaigns, conversations, wallet and team.

If a colleague has invited you, open the invitation link and accept it; you will join their workspace instead of creating your own. You can belong to more than one workspace and switch between them from the dashboard.

The usual first run, in order: connect or claim a WhatsApp number under Number Setup, create a message template and get it approved by Meta, import your contacts, top up the wallet, then build and launch a campaign. New workspaces start on the Free plan, which needs no card.

Everything is reached from the dashboard sidebar: Home, Templates, Campaigns, Contacts, Inbox, Integrations, Automation, Analytics, Chat Analysis, User Analytics, Number Setup, Payments, API Keys, Help & Support and Settings.`,
  },

  {
    id: 'dashboard-home',
    title: 'The dashboard home screen',
    topic: 'Onboarding',
    body: `Home is the workspace summary. It shows the wallet balance, today's spend, total campaign spend, the number of campaigns run, the average cost per campaign and when the wallet was last recharged.

A red wallet balance means the workspace is at or below zero and campaign launches will be refused until it is topped up under Payments.

Home is also where quick links to the common actions sit, so a new workspace can get to number setup, templates and contacts without hunting through the sidebar.`,
  },

  // ─── campaigns ─────────────────────────────────────────────────────────────
  {
    id: 'create-campaign',
    title: 'How to create and launch a campaign',
    topic: 'Campaigns',
    body: `Campaigns send an approved WhatsApp template to a list of contacts. Open Campaigns in the sidebar and start a new campaign. The builder is a nine-step form; the first four are required and the rest are optional additions you can skip. Name the campaign at the top before you begin.

Step 1, Campaign Type and WhatsApp Number: pick which of your connected numbers it sends from.

Step 2, Message Template: choose an approved template. Only templates Meta has approved can be sent. If the template has variables, set how each one is filled per contact.

Step 3, Audience: choose who receives it — all contacts, a segment, a cluster, or an uploaded list. Numbers that have opted out are removed here and are never charged for.

Step 4, Schedule: send immediately, or set a date and time to send later.

Step 5, AI Agent: attach a deployed AI agent and give its button a label. The agent answers questions about this specific campaign from a snapshot of what the campaign said.

Step 6, Reply Flows: set automatic replies for how recipients respond.

Step 7, Retries: retry failed sends on a backoff schedule you control.

Step 8, Conversion Tracking: track what the campaign led to.

Step 9, Fallback Channels: fall back to SMS or email for recipients WhatsApp could not reach. Fallbacks and retries cannot both be active on one campaign — turn retries off first.

Save as a draft at any point, or launch when the required steps are done. Launching reserves the campaign's cost from the workspace wallet; anything not actually sent is refunded when the campaign completes.`,
  },

  {
    id: 'campaign-statuses',
    title: 'Campaign statuses and what happens after launch',
    topic: 'Campaigns',
    body: `A campaign starts as a draft. Launching moves it to running, and it completes when every recipient has been attempted. A scheduled campaign waits until its send time and then runs on its own — the schedule survives a server restart.

While it runs, the campaign tracks counts per recipient: sent, delivered, read, failed, and skipped. Skipped is counted separately from failed on purpose: a blocked or opted-out number is not a delivery error and never stops the rest of the campaign.

Delivery and read receipts arrive from Meta by webhook after the send, so those numbers keep moving after the campaign itself has finished sending.

When the campaign completes, billing settles and anything unsent is refunded to the wallet.`,
  },

  {
    id: 'campaign-retries',
    title: 'Retries and fallback channels on a campaign',
    topic: 'Campaigns',
    body: `Step 7 of the campaign builder turns on retries. A retryable failure is attempted again on a backoff schedule you configure, rather than being written off on the first error. Permanent failures — an invalid number, a rejected template — are not retried, because repeating them cannot succeed.

A recipient is billed once no matter how many attempts it took, so retries never double-charge.

Step 9 configures fallback channels: when WhatsApp cannot reach a recipient at all, the message can go out over SMS or email instead. Retries and fallbacks are mutually exclusive on a single campaign — the builder blocks enabling fallbacks while retries are active, so disable retries in the retries step first.

Retry outcomes appear in the campaign report alongside the original attempts, so the campaign's real reach is visible rather than just its first pass.`,
  },

  {
    id: 'campaign-billing',
    title: 'How campaigns are charged and refunded',
    topic: 'Billing',
    body: `A campaign reserves its full estimated cost from the workspace wallet at the moment you launch it, then settles when it completes. This is deliberate: it guarantees the money is there before the first message goes out.

At settlement, everything that was not actually sent comes back to the wallet as a refund. That includes recipients skipped because they had opted out, numbers that were unsendable, and any part of the campaign that never reached Meta.

A recipient is billed once no matter how many delivery attempts it took. The wallet ledger under Payments shows every deduction and every refund with its reason attached.

If the wallet does not hold enough to cover the reservation, the launch is refused rather than partly sent. Top up under Payments and launch again.`,
  },

  {
    id: 'message-pricing',
    title: 'What a message costs',
    topic: 'Billing',
    body: `WhatsApp charges per conversation category, and ChatFlow Pro passes Meta's rate through without a markup on paid plans. The three categories are Marketing (offers, launches, re-engagement), Utility (order updates, reminders, receipts) and Authentication (one-time passcodes). A template's category therefore decides what sending it costs.

The published per-category rate card is the same table campaign launches are billed against, so the figure quoted on the website is the figure charged.

Paid plans also include a message quota per billing cycle. Sends inside the quota draw on it; sends past it are charged at the plan's per-message overage rate. The Free plan pays a markup on over-quota template sends rather than cost.

Money for messages comes out of the workspace wallet, which is separate from the plan subscription. The plan is the monthly or quarterly platform fee; the wallet pays for the traffic.`,
  },

  // ─── contacts ──────────────────────────────────────────────────────────────
  {
    id: 'contacts-add',
    title: 'How to add contacts and import a CSV',
    topic: 'Contacts',
    body: `Open Contacts in the sidebar. To add one by hand, use Add Contacts and fill in the name, the phone number in full international format (for example +91 9876543210), optionally an email address, and any tags you want to file them under, such as vip, newsletter or prospect.

To load a list, use the CSV import: drop a CSV onto the upload area or click to browse for it. The screen carries instructions for how the CSV should be laid out — follow those column names, because a mismatched header is the usual reason an import brings in fewer rows than expected.

Contacts are searchable by name or phone from the search box at the top of the list.

A contact who has opted out stays in the list but is marked as such, and is skipped and un-billed on every campaign from then on.`,
  },

  {
    id: 'contacts-segments-clusters',
    title: 'Segments, clusters and smart lists',
    topic: 'Contacts',
    body: `There are three ways to target part of your contact list rather than all of it, and any of them can be chosen as a campaign audience in step 3 of the campaign builder.

Segments are named, tag-like groupings you assign contacts to — useful for a standing group such as newsletter subscribers.

Clusters are built from the Contacts screen with Create Cluster: give the cluster a name (for example "VIP Customers" or "Pune Leads"), an optional description, then select the contacts that belong to it.

Smart Lists live under Automation and build a list from interaction rather than by hand.

Whichever you use, opted-out numbers are removed from the audience before the campaign is costed, so they never appear in the charge.`,
  },

  // ─── templates ─────────────────────────────────────────────────────────────
  {
    id: 'templates-create',
    title: 'How to create a message template',
    topic: 'Templates',
    body: `WhatsApp requires that any message you start a conversation with uses a template Meta approved in advance. Templates live under Templates in the sidebar, split into My Templates and a starter Library you can copy from rather than write from scratch.

To build one: give it a name, pick a language, and choose a category. Marketing is for promotions and announcements, Utility for order updates, confirmations and alerts, Authentication for one-time passwords only. The category also sets what each send costs, so choosing Marketing for what is really an order update overpays for it.

Then assemble the message: an optional header (text or an image), the body, an optional footer, and optional buttons. Numbered variables in the body get filled per recipient at send time.

The template studio can draft the body copy with AI and generate the header image for you, or you can write and upload your own.

Submit the finished template to Meta for review when it is ready.`,
  },

  {
    id: 'templates-approval',
    title: 'Template approval, statuses and rejections',
    topic: 'Templates',
    body: `A submitted template is reviewed by Meta, not by ChatFlow Pro, and approval is not instant. The status shown on the Templates screen updates automatically when Meta decides — the result arrives by webhook, so there is nothing to poll or refresh.

A template is pending until Meta rules on it, then approved or rejected. Only approved templates can be selected in a campaign, which is why the campaign builder's template step shows nothing until at least one has come back approved.

If a template is rejected, edit what Meta objected to and submit it again. Marketing copy in a Utility template, or a template whose variables are not explained by surrounding text, are the common causes.

You can be notified of both outcomes: Settings has Template Approved and Template Rejected notifications, available both in-app and by email.`,
  },

  // ─── number setup ──────────────────────────────────────────────────────────
  {
    id: 'number-setup',
    title: 'How to connect a WhatsApp number',
    topic: 'Setup',
    body: `Open Number Setup in the sidebar. There are three routes to a working WhatsApp Business API number.

Connect via Meta is the recommended one: you go through Meta's embedded signup and authorise ChatFlow Pro against your own WhatsApp Business account, and the number is bound to your workspace at the end of it.

Connect Your Own is the manual version, for a number already set up on the API elsewhere. It asks for the number's access token (the long value beginning EAA…).

Get a Number claims one from the platform's number pool instead, when you do not have your own. Pool numbers are assigned by an administrator.

However it arrives, the number, the templates created on it and its access token belong to your workspace, and access tokens are encrypted at rest. Disconnecting a pool number returns it to the pool for someone else.

The screen also shows the number's quality rating from Meta. Keeping it high matters: a rating that falls far enough gets a number's sending limits cut by Meta, and the usual cause is marketing to people who did not expect it.`,
  },

  // ─── inbox ─────────────────────────────────────────────────────────────────
  {
    id: 'inbox',
    title: 'Using the team inbox and replying to customers',
    topic: 'Inbox',
    body: `Inbox is the shared view of every WhatsApp conversation the workspace is having. Incoming messages arrive in real time and any team member can reply from the same thread, so a conversation is not stuck with whoever owns a phone.

Pick a conversation from the list on the left — searchable from the box above it — and type into the composer to reply. A conversation can be assigned to a specific team member or left unassigned, so it is clear who is handling what.

Quick Replies are saved responses for the things you answer constantly, so a common reply is one click rather than retyping.

Internal Notes are for the team only. A note is attached to the conversation and is never sent to the customer, which makes it the right place for context to hand over to a colleague.

Automation, workflows and AI agents write into these same threads, so you can see exactly what was sent automatically before you take over.

One WhatsApp rule shapes all of this: outside the customer service window that a customer's own message opens, you cannot send a free-form reply and must use an approved template instead.`,
  },

  // ─── automation ────────────────────────────────────────────────────────────
  {
    id: 'automation-overview',
    title: 'What is on the Automation screen',
    topic: 'Automation',
    body: `Automation in the sidebar collects everything that replies or acts without a person. It is organised into tabs:

Basic Automations — welcome message, out-of-office reply and business hours.
Custom Auto Reply — keyword triggers and the replies they send.
Workflows — multi-step flows with conditions and delays.
AI Intent Matching — routes a message to the right trigger without an exact keyword.
WhatsApp AI Agent — the free-form AI responder.
Instagram Quickflows — the same keyword model applied to Instagram.
Voice AI, Inbound Calls — answering and transcribing phone calls.
WhatsApp Forms — collecting answers one question per message.
Smart Lists — lists built from how contacts interact.

When more than one could reply to the same message, they are tried in a fixed order: a matching keyword trigger first, then welcome and out-of-office rules, and the AI agent last, as the fallback for anything nothing else claimed.`,
  },

  {
    id: 'automation-basic',
    title: 'Welcome messages, out-of-office replies and business hours',
    topic: 'Automation',
    body: `These are on the Basic Automations tab of the Automation screen. Each is switched on independently and each has its own message body, so you can run one without the others.

The welcome message is sent the first time a contact messages you, so a new conversation is acknowledged instantly rather than sitting unanswered.

The out-of-office message covers the hours you are closed. It works with the business hours setting: define the hours the team is available, enable them, and messages arriving outside those hours get the out-of-office reply. With business hours disabled, the workspace is treated as always open and the out-of-office reply does not fire on its own.

Set the hours, save them, and turn the toggle on — saving the hours and enabling them are separate actions, so a saved schedule that was never enabled will not do anything.`,
  },

  {
    id: 'automation-keyword-triggers',
    title: 'How to set up a keyword auto-reply',
    topic: 'Automation',
    body: `Keyword triggers live on the Custom Auto Reply tab of the Automation screen. A trigger is a keyword plus the message to send when an inbound message matches it.

Create one by entering the keyword, choosing how it should match, and writing the auto-reply message. Keywords can be matched on whole words, so a trigger on "order" fires for "where is my order" but not for "reordered" — which is what stops a short keyword from firing on half your inbox.

Each trigger can be active or deactivated. Deactivating keeps the trigger and its message but stops it firing, which is more useful than deleting one you only want off for a while.

Keyword triggers are checked before the welcome, out-of-office and AI agent replies, so a message matching a trigger gets the trigger's answer and nothing else responds to it.

If you want messages that mean the same thing but do not contain the keyword to reach the trigger anyway, turn on AI Intent Matching.`,
  },

  {
    id: 'automation-intent-matching',
    title: 'AI intent matching',
    topic: 'Automation',
    body: `AI Intent Matching, on its own tab under Automation, scores an inbound message against your existing keyword triggers by meaning rather than by exact text. It is what sends "my parcel hasn't come" to a shipping trigger whose keyword is "delivery".

You set a confidence threshold: how sure the match must be before the trigger fires. Raise it and only clear matches route, which is safer but lets more messages through to a human; lower it and more messages route automatically at the cost of the occasional wrong trigger.

It classifies with the AI provider when one is configured and falls back to a deterministic word-overlap scorer when none is, so it keeps working either way — just less cleverly.

It routes to triggers you have already created; it does not invent replies of its own. That is the AI agent's job.`,
  },

  {
    id: 'automation-ai-agent',
    title: 'How to set up and deploy the WhatsApp AI agent',
    topic: 'Automation',
    body: `The AI agent answers free-form questions when nothing else matched. Configure it on the WhatsApp AI Agent tab under Automation.

Give the agent a name, then write its instructions — the system prompt describing how it should behave, what it is allowed to discuss and when it should hand over to a person. Then fill in the knowledge base: the text about your business it is allowed to answer from, such as your policies, delivery times and product details.

Deploy it when the configuration is ready. Deployment is a deliberate step, and it is refused in two cases: an agent with no instructions (they must be at least ten characters) will not deploy, and neither will one on a platform with no AI provider configured, because it would have nothing to generate replies with.

Once deployed, the agent replies only to messages that no keyword trigger, welcome rule or out-of-office rule already handled.

It is instructed to answer from the knowledge base you gave it and nothing else. Asked something the knowledge base does not cover, it says it does not have that and offers a person rather than inventing an answer.

To have an agent answer questions about a specific campaign, attach it in step 5 of the campaign builder. It then also gets a snapshot of what that campaign said, so it can answer on the offer, price and deadline that particular customer received.`,
  },

  {
    id: 'automation-workflows',
    title: 'How to build a workflow',
    topic: 'Automation',
    body: `Workflows are the multi-step version of automation: a trigger, then conditions, delays and sends chained together. Use one where a single reply is not enough — a follow-up two hours later, or a sequence that branches on what the customer did.

They are on the Workflows tab under Automation. Create a flow, name it, and lay out its steps in the builder: what starts it, what has to be true to continue, how long to wait between steps, and what to send. You can also have AI draft a flow from a description and then edit it in the builder.

A workflow has to be activated before it runs; a saved flow that was never activated does nothing.

Every execution is recorded with its run history, so "did it actually fire?" is a question you can answer by looking rather than by guessing. That history is the first place to check when a workflow appears not to have run.`,
  },

  {
    id: 'automation-forms',
    title: 'Collecting answers with WhatsApp forms',
    topic: 'Automation',
    body: `A chat form asks its questions one message at a time over WhatsApp instead of sending someone to a web page. Build one on the WhatsApp Forms tab under Automation: name the form and add the questions in the order they should be asked.

Each answer is validated as it arrives, so a malformed phone number or email is caught and re-asked in the moment rather than landing in your data. When the last question is answered the whole thing is stored as a completed submission you can act on.

Forms suit anything you would otherwise ask for in free text — enrolment, booking, lead qualification — because the answers come back structured instead of as a paragraph someone has to read and retype.`,
  },

  {
    id: 'automation-voice-instagram',
    title: 'Voice AI calls and Instagram automation',
    topic: 'Channels',
    body: `Voice AI, on the Voice AI Inbound Calls tab under Automation, answers inbound phone calls. The call is answered and transcribed, turned into a lead, and handed over to a person when the caller needs one — useful when the desk is busy or closed.

Instagram Quickflows automates Instagram direct messages, comment replies and story replies on the same keyword model as WhatsApp automation. Connect the Instagram account first from that tab, then set up the keyword flows.

Both are available on plans that include them.`,
  },

  // ─── billing and plans ─────────────────────────────────────────────────────
  {
    id: 'wallet-recharge',
    title: 'How to top up the wallet',
    topic: 'Billing',
    body: `The wallet pays for message traffic and is separate from the plan subscription. Open Payments in the sidebar to see the total wallet balance, then use Recharge Wallet, enter an amount and pay through Razorpay.

The credit lands once the payment is verified on the server — the amount is read back from the payment gateway rather than trusted from the browser, so a failed or tampered payment cannot credit the wallet.

Only workspace administrators can recharge. Other roles can see the balance and the ledger but not add funds.

Campaign launches are refused when the balance will not cover the reservation, so a campaign that will not launch is usually a wallet that needs topping up rather than a broken campaign.`,
  },

  {
    id: 'wallet-ledger-invoices',
    title: 'Transaction history, invoices and billing details',
    topic: 'Billing',
    body: `Payments holds the transaction history: every movement of the wallet as a row with its type, category and reason. Campaign reservations, refunds at completion, top-ups and adjustments all appear there, which makes a surprising balance traceable to the thing that caused it.

Invoices for plan subscriptions are downloadable from the same area.

Billing details are set once and appear on those invoices: the legal business name, a billing email address, the business address and GST or tax details.

Payments also shows how many messages have been used against the plan's included quota this cycle, and a breakdown of paid message spend.`,
  },

  {
    id: 'plans-subscription',
    title: 'How to change plan, upgrade or downgrade',
    topic: 'Billing',
    body: `Every workspace is on a plan. The plan sets the included message quota per billing cycle and the limits on numbers, team members, contacts and API keys, plus which features are switched on. New workspaces start on Free, which needs no card.

Available plans and the current one are shown under Payments. Choose a plan to buy or change to it. Some plans can be billed monthly or quarterly at a discount; others are monthly only, which the plan card says.

Changing plan is an administrator action — other roles see a prompt to ask a workspace admin instead of the buttons.

An upgrade or downgrade is scheduled and applied at the next billing cycle rollover rather than prorated mid-cycle, so you keep what you have until the cycle ends. Cancelling likewise sets the subscription to end at the period end rather than cutting off immediately.

Enterprise is not sold self-serve; it is arranged through Talk to sales.`,
  },

  // ─── compliance ────────────────────────────────────────────────────────────
  {
    id: 'opt-outs',
    title: 'Opt-outs, STOP and blocked numbers',
    topic: 'Compliance',
    body: `If a customer replies STOP, that number is opted out permanently. The match is on the whole message, so "stop" opts out but "don't stop sending me these" does not.

Once a number is opted out it is skipped by every future campaign, removed from the cost before your wallet is charged, and no automation, workflow or AI agent replies to it again. A second STOP changes nothing, because the rule is already in force.

Review the list under Settings, in Blocked Numbers. You can also block a number manually there, which has the same effect as the customer having sent STOP themselves.

Settings can also alert you to a High Opt-out Alert, which is worth leaving on: a spike in opt-outs is the earliest warning that a campaign's targeting or frequency is wrong, and it damages the number's quality rating with Meta if it continues.`,
  },

  // ─── analytics ─────────────────────────────────────────────────────────────
  {
    id: 'analytics',
    title: 'Analytics, chat analysis and reporting',
    topic: 'Analytics',
    body: `Analytics reports delivery and spend: sent, delivered, read and failed per campaign, tied back to what the campaign cost. Retries and any SMS or email fallback are included, so a campaign's real reach is visible rather than just its first attempt.

Chat Analysis looks at conversation activity — what customers are actually messaging about and how those conversations resolve.

User Analytics covers your own team's activity rather than your customers'.

The Home screen carries the running workspace totals, and Payments carries the message-spend breakdown.

Delivered and read counts arrive from Meta by webhook after sending, so they continue to rise for a while after a campaign shows as complete. A gap between sent and delivered immediately after a launch is normal and not a failure.`,
  },

  // ─── team ──────────────────────────────────────────────────────────────────
  {
    id: 'team-members',
    title: 'How to invite team members and manage roles',
    topic: 'Team',
    body: `Team Members is under Settings. Invite a colleague by entering their email address; they get an invitation link, and accepting it adds them to the workspace. Someone without an account yet signs up through the same link and joins on the way in.

Invitations that have not been accepted appear under Pending Invitations, so you can see who has not joined yet.

Members have roles, and the role decides what they can do. Administrators can change the plan, recharge the wallet and manage the team; other roles work inside the workspace without those controls. The effective role is re-checked on every request against the membership record, so it cannot be stale.

How many members a workspace can hold depends on its plan.`,
  },

  {
    id: 'settings-notifications',
    title: 'Notification settings and workspace configuration',
    topic: 'Settings',
    body: `Settings holds workspace configuration beyond the team list.

In-app notifications can be switched on per event: New Conversation, Template Approved, Template Rejected, Campaign Completed, High Opt-out Alert and Rate Limit Warning.

Email notifications are configured separately and cover much the same ground — a summary email when a campaign completes, when Meta approves or rejects a template, and when a teammate is invited.

Settings also carries the outbound webhook configuration, a rate limit monitor showing how close the workspace is to its sending limits, daily usage, and Blocked Numbers.`,
  },

  // ─── developers ────────────────────────────────────────────────────────────
  {
    id: 'api-keys',
    title: 'How to create an API key and use the public API',
    topic: 'Developers',
    body: `API Keys in the sidebar issues keys for the public API. Create one with an optional name to tell it apart from the others.

The key is shown once, at creation. Copy it then and store it somewhere safe — it cannot be read back afterwards, because it is stored hashed. If a key is lost or leaked, rotate it to get a new value, or revoke it to kill it outright.

A key is scoped to the workspace that created it, and how many keys a workspace can hold depends on its plan.

The public API authenticates with that key and can send messages, list and create templates, list, create and launch campaigns, list, create and update contacts, and register a webhook URL.

The API Playground on the same screen sends a real test request without writing any code — put in a phone number and a message, or a template id, and see what the API returns.`,
  },

  {
    id: 'webhooks',
    title: 'How to set up webhooks',
    topic: 'Developers',
    body: `Webhooks push events to your own server rather than making you poll for them. Set the webhook URL — an HTTPS endpoint you control — from the API Keys screen or from Settings, and choose which events to subscribe to.

A verify token is used to confirm the endpoint is really yours when the webhook is registered, the same handshake Meta uses.

Your endpoint should answer quickly and do its real work afterwards; a slow endpoint causes deliveries to be treated as failures.

Note the distinction from Meta's own webhooks, which ChatFlow Pro consumes internally for template approval results and delivery receipts. Those need no setup from you. The webhook configured here is the one that forwards events on to your systems.`,
  },

  {
    id: 'integrations',
    title: 'Connecting third-party integrations',
    topic: 'Developers',
    body: `Integrations in the sidebar lists the third-party tools that can be connected to a workspace. Search for the one you want, review its key capabilities, and activate it — connecting usually means authorising ChatFlow Pro against that tool through OAuth.

Connection credentials are encrypted at rest, and a connection belongs to the workspace that made it.

For anything not in the list, the public API and outbound webhooks are the general-purpose route.`,
  },

  // ─── support and security ──────────────────────────────────────────────────
  {
    id: 'support',
    title: 'How to get help or contact support',
    topic: 'Support',
    body: `Help & Support in the dashboard sidebar raises a ticket with the ChatFlow Pro team. Give it a subject, pick a category and describe the issue. The categories are General, Billing, Technical, Bug report and Feature request.

Tickets are tied to your workspace and the team replies to the account's email address. Your previous requests are listed on the same screen, so you can see what you have already raised.

For sales questions about Enterprise — custom volume, SSO and audit logs, custom integrations, an SLA — use Talk to sales on the pricing section of the website instead.`,
  },

  {
    id: 'security-data',
    title: 'Security, privacy and data handling',
    topic: 'Security',
    body: `Everything is scoped to a workspace: contacts, campaigns, conversations and wallet all belong to one, and members reach them only through their membership in it. That boundary is what lets an agency keep one workspace per client with no leakage between them.

WhatsApp access tokens and integration credentials are encrypted at rest. API keys are stored hashed and shown only once, at creation.

Sign-in supports email and password or Google. Sessions use short-lived access tokens with refresh tokens behind them, so a stolen access token has a short life.

Workspace roles are re-derived from the membership record on every request rather than trusted from the session, so a role that changed takes effect immediately.`,
  },

  // ─── troubleshooting ───────────────────────────────────────────────────────
  {
    id: 'troubleshooting',
    title: 'Common problems and what causes them',
    topic: 'Troubleshooting',
    body: `A campaign will not launch: the wallet does not cover the reservation. Top up under Payments. Launches are refused outright rather than sent halfway.

No templates appear in the campaign builder: only Meta-approved templates can be sent, so nothing shows until at least one has come back approved.

An automation did not reply: check the order. A keyword trigger wins over the welcome and out-of-office rules, and the AI agent only answers what nothing else claimed. Also check the rule is active — saving is not the same as enabling, and business hours must be turned on as well as saved.

A workflow did not run: open its run history, which records every execution. Also confirm the workflow was activated after it was saved.

The AI agent will not deploy: it needs instructions of at least ten characters and an AI provider configured on the platform.

Delivered and read counts look low right after a launch: those arrive from Meta by webhook after sending and keep rising for a while.

Fallback channels cannot be enabled: retries are on. The two are mutually exclusive on one campaign — turn retries off first.

Messages to one contact are not sending: check whether that number has opted out. Opted-out numbers are skipped silently by design and appear under Settings, Blocked Numbers.`,
  },
];
