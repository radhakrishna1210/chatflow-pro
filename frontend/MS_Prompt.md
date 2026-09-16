# MASTER EXECUTION PROMPT

## ADVANCED AGENTIC AI CRM — PRODUCTION-GRADE FEATURE EXPANSION

---

# 0. READ THIS FIRST — YOUR ROLE AND THE REQUIRED RESULT

You are acting simultaneously as the:

* Principal Product Engineer
* Staff Software Architect
* Senior Full-Stack Engineer
* Senior Product Designer
* AI Agent Engineer
* Database Architect
* QA Automation Lead
* Security Engineer
* DevOps Engineer
* Performance Engineer
* Accessibility Engineer
* Technical SEO Engineer
* AEO/GEO Engineer

Your assignment is to **extend an existing open-source agentic CRM into a production-ready advanced CRM platform**.

This is **NOT a full CRM rewrite**.

This is an **advanced-feature expansion** of an existing working codebase.

Primary repository:

`https://github.com/trycompai/crm`

A local/exported copy of this repository may also be supplied to you.

---

# 1. IMPORTANT: THERE IS NO REFERENCE VIDEO

Do not request a screen recording.

Do not pause development because a video is unavailable.

Do not ask the user to upload the video.

All required functionality, screen expectations, behaviors, architecture expectations and UX expectations are defined in this specification.

Treat this specification as the functional source of truth.

If visual references are later supplied as screenshots, they are secondary design references only.

They must never override:

* architectural integrity;
* accessibility;
* responsiveness;
* security;
* usability;
* performance;
* existing CRM conventions.

Do not block implementation waiting for screenshots.

---

# 2. CORE OBJECTIVE

Build the missing **advanced CRM layer** on top of the existing agentic CRM.

The resulting product should combine:

### Existing agentic CRM strengths

* Contacts
* Companies
* Deals
* AI agents
* Agent tasks
* Agent builder
* Enrichment
* Evidence/provenance
* Mailbox/calendar connections
* Existing activities
* Authentication
* Workspace model
* Existing settings
* Existing design system

with advanced functionality such as:

* Lead Management
* Opportunity Intelligence
* Advanced Deal Management
* Task Work Queue
* Engagement Management
* Unified Conversations
* Shared Inbox
* Sequences
* Workflow Automation
* Campaigns/Broadcasts
* Product/Service Catalog
* Quotes
* Reporting
* Forecasting
* Relationship Intelligence
* AI Recommendations
* Agent Command Center
* Gamification
* Advanced Admin
* Teams and Permissions
* Notifications
* Advanced Dashboard
* Premium Motion Design
* Customer-facing marketing website
* SEO
* AEO
* GEO

The end result must be a **working end-to-end application**, not a prototype.

---

# 3. ABSOLUTE DEVELOPMENT REQUIREMENT

Do not generate frontend mockups without backend functionality.

Do not create:

* disconnected buttons;
* fake data pretending to be live data;
* fake APIs;
* fake AI outputs;
* dead navigation;
* placeholder pages;
* TODO screens;
* nonfunctional filters;
* temporary business logic;
* dummy success states;
* empty event handlers;
* fake analytics;
* hardcoded production metrics.

Every production-facing function must connect end-to-end wherever reasonably possible:

**UI → validation → API → business logic → permissions → database → response → UI state**

and where relevant:

**event → worker → durable task → provider → result → database → UI**

---

# 4. DO NOT REWRITE THE EXISTING CRM

Before changing anything, inspect the actual repository.

The expected stack includes approximately:

* Bun
* Turborepo
* TypeScript
* Next.js App Router
* NestJS
* tRPC
* Prisma
* PostgreSQL
* Better Auth
* shadcn/ui
* shared UI package
* agent runtime/deployment
* durable agent sessions/tasks
* evidence-based AI enrichment

Verify these facts yourself.

If the repository differs, follow the repository.

Do not migrate frameworks simply because you prefer something else.

Do not replace:

* Next.js
* NestJS
* Prisma
* PostgreSQL
* Bun

unless there is an extraordinary and proven architectural reason.

A framework rewrite is outside scope.

---

# 5. FIRST PHASE: FULL REPOSITORY RECONNAISSANCE

Before feature development, inspect:

* `README.md`
* `AGENTS.md`
* `CLAUDE.md`
* nested `AGENTS.md`
* nested `CLAUDE.md`
* `/docs`
* `/adrs`
* `/apps`
* `/packages`
* Prisma schema
* migrations
* API architecture
* frontend routes
* shared UI
* authentication
* authorization
* activity system
* contacts
* companies
* deals
* mailbox
* calendar
* tracking
* AI agents
* agent builder
* agent execution
* background processing
* existing queues/workers
* analytics
* environment variables
* tests
* CI
* deployment configuration

Also inspect:

* `.agents`
* `.claude`
* installed skills
* project-specific instructions
* design skills
* code-quality skills
* testing skills
* security skills
* SEO skills

Repository instructions take priority over generic assumptions.

---

# 6. INSTALL/USE DESIGN AND ANIMATION SKILLS WHERE AVAILABLE

The application requires a sophisticated interface.

First inspect the skills already available.

Look for capabilities related to:

* product design;
* UI systems;
* UX;
* animation;
* Motion;
* accessibility;
* typography;
* color;
* layout;
* Next.js;
* React;
* shadcn;
* performance.

If suitable skills already exist:

**READ AND USE THEM.**

If the environment supports installing additional skills and an important design/animation capability is missing:

1. find a reputable skill;
2. inspect it;
3. install it;
4. use it.

Do not fabricate installation.

Do not claim to have installed something unless installation actually succeeded.

Do not say you will "train yourself."

Instead:

* research;
* study documentation;
* inspect high-quality open-source implementations;
* apply learned patterns.

---

# 7. PRODUCE A BASELINE FEATURE INVENTORY

Create:

`docs/ADVANCED_CRM_EXISTING_FEATURES.md`

Classify functionality as:

* EXISTING
* PARTIAL
* MISSING
* NEEDS IMPROVEMENT

Do this before designing new database models.

---

# 8. CREATE A FEATURE GAP DOCUMENT

Create:

`docs/ADVANCED_CRM_GAP_ANALYSIS.md`

Use:

| Capability | Existing | Partial | Missing | Industry Need | Proposed Solution | Backend | Database | UI | Tests |
| ---------- | -------- | ------- | ------- | ------------- | ----------------- | ------- | -------- | -- | ----- |

Avoid duplicated concepts.

Example:

If Deals already represent Opportunities, extend Deal.

Do not create another Opportunity table unless there is a strong domain reason.

If Contacts can become Leads through lifecycle metadata, evaluate that before creating an unnecessary Lead model.

Architecture matters more than copying terminology.

---

# 9. REQUIRED NAVIGATION ARCHITECTURE

Design a coherent primary navigation.

A suitable architecture may include:

### Work

* Home
* Leads
* Contacts
* Companies
* Opportunities
* Tasks

### Engage

* Conversations
* Engagements
* Sequences
* Campaigns

### Automate

* Workflows
* AI Agents
* Agent Tasks

### Commerce

* Products & Services
* Quotes

### Analyze

* Reports
* Forecast

### Admin

* Integrations
* Teams
* Users
* Customization
* Settings

Do not mechanically use these sections if repository conventions suggest a better hierarchy.

Navigation should remain:

* fast;
* understandable;
* keyboard accessible;
* responsive;
* role-aware.

Provide quick search/command palette access.

---

# 10. ADVANCED HOME / COMMAND CENTER

Build a genuinely useful CRM command center.

The home dashboard should provide:

### Personal work

* today's tasks;
* overdue tasks;
* upcoming meetings;
* follow-ups;
* inbox requiring attention;
* assigned leads;
* recently active prospects.

### Sales metrics

* pipeline value;
* weighted pipeline;
* won revenue;
* win rate;
* expected closing;
* forecast;
* pipeline changes;
* new qualified leads.

### AI

* recommended actions;
* stale deals;
* risk alerts;
* AI research;
* unresolved AI questions;
* agent activity;
* failed agent jobs;
* completed automations.

### Gamification

* XP;
* level;
* weekly progress;
* daily mission;
* streak;
* achievements;
* team challenge where enabled.

Every dashboard card must deep-link into its corresponding filtered data set.

No decorative dead-end widgets.

---

# 11. LEAD MANAGEMENT

Create or extend the appropriate model to support complete lead management.

Required capabilities:

* Create lead
* Import leads
* Edit lead
* Archive lead
* Assign owner
* Assign team
* Lead stage
* Lead status
* Lifecycle
* Source
* Attribution
* Tags
* Custom fields
* Segmentation
* Lead score
* Qualification status
* Disqualification reason
* Related company
* Related contacts
* Activities
* Tasks
* Messages
* Notes
* Documents
* AI insights
* AI research
* Suggested actions
* History
* Audit data

Views:

### Lead table

Columns such as:

* Name
* Company
* Title
* Score
* Status
* Owner
* Source
* Last interaction
* Next activity
* Created
* Tags

Must support:

* sorting;
* filtering;
* search;
* saved views;
* bulk selection;
* bulk actions;
* column customization where appropriate.

### Lead focused view

Designed for quickly working through prioritized leads.

### Lead record screen

Suggested areas:

* Overview
* Activity
* Communications
* Tasks
* AI
* Notes
* Files
* History

---

# 12. LEAD CONVERSION

Lead conversion should support:

**Lead → Qualified prospect → Deal/Opportunity**

Preserve:

* contact;
* company;
* owner;
* source;
* attribution;
* notes;
* tasks;
* conversations;
* activities;
* files;
* AI research;
* history.

Conversion must be transactional.

Do not create partial objects if the process fails.

---

# 13. INTELLIGENT LEAD SCORING

Create explainable prioritization.

Possible scoring components:

* engagement recency;
* engagement frequency;
* email response;
* meeting booked;
* website activity;
* ICP fit;
* title/role match;
* company size fit;
* source quality;
* previous behavior;
* AI research indicators.

Display:

* current score;
* trend;
* reasons;
* positive factors;
* negative factors;
* recalculation timestamp.

Build a deterministic baseline scoring model.

AI can supplement it.

Do not create unexplained black-box numbers.

---

# 14. ADVANCED DEAL / OPPORTUNITY MANAGEMENT

Prefer extending the current Deal architecture.

Deal records should support:

* name;
* pipeline;
* stage;
* value;
* currency;
* probability;
* weighted value;
* owner;
* team;
* expected close date;
* actual close date;
* account/company;
* contacts;
* products;
* competitors;
* stakeholders;
* champion;
* decision maker;
* blocker;
* next step;
* last activity;
* next activity;
* health score;
* risk;
* forecast category;
* loss reason;
* win reason;
* source;
* notes;
* attachments;
* related conversations;
* timeline;
* audit history.

---

# 15. PIPELINE UI

Create a premium interactive pipeline board.

Required:

* Drag/drop cards
* Smooth but restrained animation
* Pipeline selection
* Stage configuration
* Deal count
* Stage value
* Probability
* Filters
* Search
* Owner filters
* Team filters
* Saved views
* Quick-edit
* Card preview
* Details drawer

Drag/drop must:

1. update optimistically only if safe;
2. persist through API;
3. create stage history;
4. roll back visually on API failure;
5. show error feedback.

Never lose a deal movement silently.

---

# 16. PIPELINE INTELLIGENCE

Automatically surface:

* deal stalled;
* no future activity;
* close date expired;
* excessive stage age;
* no decision maker;
* no champion;
* missing amount;
* missing products;
* low relationship activity;
* opportunity slipping;
* unusual inactivity;
* declining engagement where evidence supports it.

AI recommendation example:

> Schedule a follow-up with the decision maker. No engagement has been recorded for 12 days and the expected close date is in 6 days.

Every AI statement should indicate evidence.

---

# 17. TASK / TO-DO WORKSPACE

Build an advanced task manager.

Views:

* My Day
* Overdue
* Upcoming
* All
* Completed
* Team
* Calls
* Emails
* Meetings
* Follow-ups

Each task:

* title;
* description;
* status;
* priority;
* due date;
* time;
* owner;
* associated CRM record;
* task type;
* source;
* sequence;
* workflow;
* timestamps;
* completion outcome.

Operations:

* complete;
* snooze;
* reschedule;
* reassign;
* bulk complete;
* bulk reschedule;
* filters;
* keyboard actions.

Task completion should feel satisfying without excessive animation.

---

# 18. ENGAGEMENT CENTER

Create a consolidated Engagement area.

Activity types may include:

* Calls
* Meetings
* Video meetings
* Emails
* Messages
* Web visits
* Tasks
* Notes
* Form submissions

Filters:

* Type
* Date
* Owner
* Company
* Lead
* Contact
* Deal
* Direction
* Outcome

Avoid duplicating activity events unnecessarily.

Reuse the existing activity system when possible.

---

# 19. UNIFIED CONVERSATIONS

Build a modern conversation workspace.

Layout:

### Left

Conversation/inbox list.

### Center

Conversation thread.

### Right

CRM context.

Right sidebar may show:

* person;
* company;
* lead status;
* deal;
* owner;
* tags;
* tasks;
* notes;
* AI summary.

Conversation actions:

* Reply
* Draft
* AI rewrite
* AI summarize
* Assign
* Change status
* Snooze
* Add note
* Create task
* Link CRM record

---

# 20. PERSONAL AND TEAM INBOXES

Support:

### Personal inbox

Messages owned by the individual user.

### Team inbox

Shared team conversations.

Features:

* Assignment
* Unassigned
* Open
* Waiting
* Closed
* Snoozed
* Priority
* Tags
* Search
* Saved filters

Do not claim channel support that has not actually been implemented.

---

# 21. SEQUENCES / CADENCES

Create an outbound sales-sequence builder.

Possible steps:

* Send email
* Wait
* Create call task
* Create follow-up task
* AI research
* Conditional branch
* Update CRM property
* Exit sequence

Sequence features:

* Draft
* Published
* Paused
* Steps
* Delays
* Conditions
* Business hours
* Timezones
* Enrollment
* Unenrollment
* Completion
* Response detection
* Metrics
* Failure handling

UI should visually show sequence progression.

Do not create unsafe mass-spam tooling.

Respect opt-outs and provider limits.

---

# 22. VISUAL WORKFLOW AUTOMATION

Create a workflow builder.

UX can resemble professional visual automation tools without copying them.

Workflow canvas:

### Trigger

Example:

`Lead Score exceeds 80`

↓

### Condition

`Lead status = Open`

↓

### Action

`Assign to Sales`

↓

### Action

`Create follow-up task`

↓

### Agent action

`Research company`

↓

### Branch

`ICP Fit?`

---

# 23. WORKFLOW TRIGGERS

Potential triggers:

* Record created
* Record updated
* Lead qualified
* Lead score changed
* Deal stage changed
* Task completed
* Reply received
* Form submitted
* Tag added
* Scheduled time
* Agent result
* Sequence event

---

# 24. WORKFLOW CONDITIONS

Support:

* equals;
* not equals;
* contains;
* comparison;
* empty/not empty;
* dates;
* before/after;
* AND;
* OR;
* nested groups;
* relationships.

---

# 25. WORKFLOW ACTIONS

Examples:

* Assign owner
* Update property
* Create task
* Add tag
* Remove tag
* Send approved message
* Enroll sequence
* Unenroll sequence
* Create Deal
* Move stage
* Run agent
* Create notification
* Call webhook

---

# 26. WORKFLOW ENGINE

Must be production-grade.

Required:

* Durable execution
* Retry
* Backoff
* Idempotency
* Execution logs
* Input/output
* Failed state
* Version
* Pause
* Resume
* Test mode
* Loop prevention
* Recursion protection
* Concurrency rules

A visual builder without reliable execution is unacceptable.

---

# 27. CAMPAIGNS / BROADCASTS

Where supported, build:

* Campaign name
* Audience
* Segment
* Channel
* Message
* Template
* Schedule
* Test send
* Personalization
* Status
* Delivery
* Failure
* Bounce
* Response
* Conversion attribution

Do not build unethical spam functionality.

---

# 28. AUTOMESSAGING

Allow conditional messages based on supported events.

Examples:

* new lead acknowledgement;
* meeting follow-up;
* abandoned qualification;
* post-demo follow-up.

Include:

* quiet hours;
* timezone;
* consent;
* exit condition;
* provider status;
* execution logs.

---

# 29. AI CUSTOMER AGENT / CHATBOT

Provide configurable customer-facing AI where appropriate.

Capabilities:

* Web chat
* Lead collection
* Qualification
* FAQ answering
* Meeting routing
* Human handoff
* CRM record linking
* Conversation history
* Goals
* Guardrails
* Configurable knowledge
* Availability
* Analytics

Do not allow the chatbot to modify critical CRM information outside the trusted write architecture.

---

# 30. SUPPORT TICKETS

Provide lightweight tickets.

Fields:

* Ticket ID
* Subject
* Contact
* Company
* Priority
* Status
* Category
* Owner
* Team
* SLA
* Conversation
* Created
* Updated
* Resolved

Statuses:

* New
* Open
* Waiting
* Resolved
* Closed

Views:

* Mine
* Team
* Unassigned
* Overdue
* All

---

# 31. PRODUCTS & SERVICES

Create a catalog.

Product fields:

* Name
* Product/service
* SKU
* Category
* Description
* Price
* Currency
* Unit
* Status
* Tax settings
* Metadata

Views:

* Products
* Services
* Categories

Allow products to attach to opportunities.

---

# 32. DEAL LINE ITEMS

Support:

* Product
* Quantity
* Unit price
* Discount
* Tax
* Subtotal
* Total

Calculate on trusted server logic.

Do not trust totals sent directly by the browser.

---

# 33. QUOTES / PROPOSALS

Allow users to build quotes attached to opportunities.

Fields:

* Quote number
* Company
* Contact
* Opportunity
* Line items
* Discount
* Tax
* Valid until
* Terms
* Notes
* Status

Statuses:

* Draft
* Sent
* Viewed
* Accepted
* Rejected
* Expired

If PDF output is supported, generate securely.

---

# 34. PAYMENT DATA

First inspect whether payment functionality already exists.

Never store raw payment card information.

Use one canonical typed payment-summary contract.

Explicitly guard against previous key-renaming regressions.

Search every producer and consumer.

---

# 35. GLOBAL CRM SEARCH

Implement fast global search.

Search:

* Leads
* Contacts
* Companies
* Deals
* Tasks
* Products
* Tickets
* Agents

Results should be permission-aware.

---

# 36. COMMAND PALETTE

Provide a modern command palette.

Examples:

`⌘ / Ctrl + K`

Actions:

* Search
* New lead
* New contact
* New company
* New deal
* New task
* Run agent
* Open inbox
* Open workflow
* Navigate

Optimized for keyboard usage.

---

# 37. RECORD DETAIL EXPERIENCE

Create premium 360° record pages.

Example Contact/Lead page:

## Header

* Avatar
* Name
* Company
* Role
* Score
* Status
* Owner
* Tags
* Primary actions

## Summary

* email;
* phone;
* location;
* source;
* relationship;
* last activity;
* next activity.

## Tabs

* Overview
* Activity
* Conversations
* Tasks
* Deals
* AI
* Files
* Notes
* History

Use contextual side panels where appropriate.

---

# 38. TIMELINE

Use a unified chronological timeline.

Events may include:

* Lead created
* Property changed
* Email sent
* Email received
* Meeting
* Call
* Note
* Task
* Deal movement
* AI enrichment
* Agent result
* Workflow execution
* Quote
* Ticket

Support event filtering.

---

# 39. REPORTING

Implement practical reports.

Sales:

* Pipeline
* Revenue
* Win rate
* Stage conversion
* Forecast
* Deal velocity
* Sales cycle
* Loss reasons

Lead:

* Lead creation
* Qualification rate
* Conversion
* Source
* Response time
* Score distribution

Activity:

* Calls
* Emails
* Meetings
* Completed tasks
* Follow-ups

Agent:

* Agent executions
* Success
* Failure
* Recommendations
* Accepted suggestions
* Evidence quality

---

# 40. FORECASTING

Provide:

* Commit
* Best case
* Pipeline
* Closed
* Weighted forecast
* Quota
* Coverage
* Expected revenue
* Team
* Owner
* Period

Allow drilldown into underlying deals.

Do not fabricate predictions when there is insufficient information.

---

# 41. SAVED VIEWS

Users should be able to save useful filters.

Examples:

* Hot leads
* No activity 14 days
* Closing this month
* Unassigned
* Enterprise
* Needs follow-up
* Overdue
* My open opportunities

Persist per user/workspace appropriately.

---

# 42. CUSTOM FIELDS

Admins should configure CRM fields.

Types:

* Text
* Number
* Currency
* Date
* Date/time
* Boolean
* Dropdown
* Multi-select
* URL
* Email
* Phone
* User
* Relationship where architecture supports it

Validate custom-field definitions server-side.

---

# 43. CRM CUSTOMIZATION

Admin sections:

* Properties
* Pipelines
* Stages
* Lead statuses
* Loss reasons
* Task types
* Call outcomes
* Tags
* Forms
* Product categories
* Currency
* Workspace configuration

---

# 44. USERS AND TEAMS

Support:

* Invite user
* Remove user
* Suspend user
* Team membership
* Role
* Ownership

Possible roles:

* Admin
* Manager
* Member
* Support
* Read-only

Actual roles should follow the repository's authorization design.

---

# 45. ACCESS CONTROL

Authorization must be implemented on the server.

Never rely on hidden UI.

Consider permissions such as:

* Own records
* Team records
* All records
* Edit
* Delete
* Export
* Analytics
* Settings
* Automations
* Agents
* User management

---

# 46. IMPORT

Build an import workflow.

Support CSV at minimum.

Flow:

1. Upload
2. Detect columns
3. Map properties
4. Validate
5. Detect duplicates
6. Preview
7. Import
8. Progress
9. Summary
10. Error file

Large jobs should execute asynchronously/durably.

---

# 47. EXPORT

Allow authorized users to export filtered data.

Protect against spreadsheet formula injection.

Log sensitive exports.

---

# 48. FORMS

Allow public lead forms.

Builder:

* Fields
* Required
* Consent
* Hidden attribution
* Success message
* Routing

Must include:

* validation;
* anti-spam;
* duplicate handling;
* secure submission;
* attribution.

---

# 49. NOTIFICATIONS

Build a notification center.

Possible notifications:

* Assigned lead
* Due task
* Overdue
* Reply
* Deal risk
* Agent completion
* Agent failure
* Workflow failure
* Achievement

Provide user preferences.

Avoid notification overload.

---

# 50. AGENTIC ARCHITECTURE IS THE MAIN DIFFERENTIATOR

This CRM must remain agentic-first.

AI should not simply exist as a chat popup.

Agent capabilities should be embedded into operational workflows.

---

# 51. AGENT COMMAND CENTER

Create a central interface for:

* Agents
* Running
* Completed
* Failed
* Scheduled
* Awaiting approval
* Agent tasks
* Tool activity
* Evidence
* Outputs
* Runtime status

---

# 52. NEXT-BEST-ACTION AGENT

Provide AI suggestions such as:

* Follow up with lead
* Research company
* Schedule a meeting
* Revive stale opportunity
* Contact decision maker
* Add next step
* Review deal
* Update stage

Each recommendation must include:

* Recommendation
* Why
* Evidence
* Record
* Suggested action

---

# 53. RELATIONSHIP INTELLIGENCE

Create explainable relationship signals.

Potential factors:

* Recent communication
* Frequency
* Response
* Meetings
* Stakeholders
* Time since activity
* Contact coverage

Present:

* Strong
* Moderate
* Weak
* At risk

with supporting factors.

Do not pretend relationship health is scientifically precise.

---

# 54. DEAL HEALTH

Create a deal-health indicator.

Possible factors:

* Close date
* Stage age
* Next activity
* Decision maker
* Engagement
* Multiple stakeholders
* Product completeness
* Recent communication

Display explanations.

---

# 55. AI RESEARCH

Preserve the evidence/provenance principles of the existing CRM.

Do not let the model silently invent:

* email;
* phone;
* title;
* company;
* role;
* address;
* revenue;
* employee count.

AI research should retain its source/evidence.

---

# 56. AI DRAFTING

Provide AI assistance for:

* Emails
* Follow-ups
* Meeting summaries
* Call notes
* Deal summaries
* Lead summaries
* Task creation
* Suggested replies

The human must retain control over outbound communication unless explicitly configured otherwise.

---

# 57. HUMAN APPROVALS

For consequential AI actions provide approval states.

Examples:

* sending an external message;
* large bulk update;
* mass sequence enrollment;
* deal deletion;
* potentially sensitive export.

---

# 58. GAMIFICATION

The CRM should feel engaging, particularly for:

* college-going users;
* student founders;
* young professionals;
* Gen Z;
* emerging Gen Alpha professional users.

But do not make it childish.

Use meaningful gamification.

---

# 59. XP SYSTEM

Award XP for useful actions.

Examples:

* Completing follow-up
* Qualifying lead
* Clearing overdue tasks
* Updating stale opportunity
* Completing onboarding
* Closing deal
* Completing weekly goal

Do not reward spam volume.

---

# 60. LEVEL SYSTEM

Users may progress through tasteful levels.

Examples:

* Explorer
* Operator
* Builder
* Strategist
* Closer
* Rainmaker

Names may be improved.

Avoid embarrassing childish terminology.

---

# 61. STREAKS

Possible streaks:

* Daily CRM hygiene
* Follow-ups completed
* Inbox cleared
* Tasks completed

Provide grace periods or recovery.

Do not create unhealthy compulsive behavior.

---

# 62. MISSIONS

Daily/weekly missions:

> Follow up with 5 priority leads.

> Clear all overdue tasks.

> Add next steps to 3 stalled opportunities.

> Qualify 3 leads.

Tie missions to genuine productivity.

---

# 63. ACHIEVEMENTS

Examples:

* First Lead
* First Qualified Lead
* First Opportunity
* First Closed Deal
* Inbox Zero
* Pipeline Pro
* Follow-up Hero
* CRM Hygiene Master
* Automation Builder
* Agent Operator

Use elegant celebration animation.

---

# 64. OPTIONAL LEADERBOARD

If implemented:

* Personal/team
* Configurable
* Disableable
* Privacy-aware

Do not force competition.

---

# 65. VISUAL DESIGN DIRECTION

Preserve the project's dark visual language.

Target:

* premium;
* dark;
* futuristic;
* agentic;
* clean;
* energetic;
* visually rich;
* highly polished.

Imagine a modern combination of:

* premium AI workspace;
* professional sales platform;
* modern developer tool;
* productivity command center.

Do not copy another CRM.

---

# 66. COLOR

Prefer a palette built around:

* deep near-black backgrounds;
* graphite panels;
* neutral borders;
* elevated dark surfaces;
* limited high-energy accents;
* semantic green/yellow/red;
* subtle gradients.

Use existing design tokens whenever possible.

---

# 67. TYPOGRAPHY

Typography should feel:

* contemporary;
* crisp;
* technical;
* legible;
* premium.

Avoid tiny gray typography.

Maintain sufficient contrast.

---

# 68. ANIMATION STRATEGY

Research current stable animation libraries before implementing.

Potential options:

* Motion
* GSAP
* CSS
* Web Animations
* Rive
* dotLottie
* Three.js

Do NOT install all of them.

Choose an intentional stack.

---

# 69. PRODUCT UI MOTION

Inside the CRM, prioritize:

* Motion/native CSS;
* layout transitions;
* hover feedback;
* drawers;
* tabs;
* pipeline drag/drop;
* task completion;
* progress;
* score changes;
* notifications;
* achievement celebrations.

Operational workflows must remain fast.

---

# 70. MARKETING SITE MOTION

The public website can use more expressive animation.

Examples:

* interactive hero;
* animated product visualization;
* cursor-responsive effects;
* scroll storytelling;
* feature reveals;
* agent workflow demo;
* dashboard transitions;
* floating cards;
* animated metrics;
* interactive pipeline;
* subtle depth.

Possible technology:

* Motion;
* GSAP;
* Rive;
* selectively Three.js.

Do not destroy page performance.

---

# 71. MOTION ACCESSIBILITY

Always implement:

`prefers-reduced-motion`

Reduced motion must remain fully usable.

---

# 72. MOBILE EXPERIENCE

Provide a genuinely designed mobile interface.

Navigation may become:

* bottom navigation;
* compact menu;
* command sheet.

Large tables may become:

* cards;
* focused lists;
* condensed tables.

Do not simply shrink desktop screens.

---

# 73. ACCESSIBILITY

Target WCAG 2.2 AA where practical.

Verify:

* Contrast
* Keyboard
* Focus
* Labels
* Forms
* Dialogs
* Screen readers
* Reduced motion
* Error messaging
* Semantic HTML

---

# 74. MARKETING WEBSITE

Build a customer-facing site separate from the authenticated CRM.

Primary purpose:

* explain;
* demonstrate;
* rank;
* convert.

---

# 75. LANDING PAGE STRUCTURE

Recommended homepage:

### Hero

Headline clearly stating what the CRM does.

Subheading.

Primary CTA.

Secondary CTA.

Animated product UI demonstration.

### Trust / credibility

Only factual proof.

Do not invent company logos or customer counts.

### Problem

Explain current CRM pain.

### Solution

Explain the agentic approach.

### Interactive product demo

Show:

* Lead
* Agent
* Pipeline
* Automation
* Engagement

### Core benefits

* Sell smarter
* Automate repetitive work
* Keep CRM clean
* Never miss follow-up
* Get AI recommendations
* Understand your pipeline

### Feature sections

Animated.

### Agentic AI section

Explain differentiation.

### Gamification

Show engagement/productivity benefits.

### Integrations

Only real/planned supported integrations clearly labeled.

### Security

Explain actual safeguards.

### FAQ

Useful questions.

### Final CTA

Strong conversion.

---

# 76. PUBLIC PAGE ARCHITECTURE

Consider:

* `/`
* `/features`
* `/features/ai-agents`
* `/features/lead-management`
* `/features/pipeline`
* `/features/automation`
* `/features/conversations`
* `/features/analytics`
* `/features/gamification`
* `/solutions/students`
* `/solutions/student-founders`
* `/solutions/startups`
* `/pricing`
* `/integrations`
* `/security`
* `/faq`
* `/about`
* `/resources`
* `/blog`
* `/legal/...`

Only build pages that contain useful unique information.

Avoid thin SEO pages.

---

# 77. SEO

Implement:

* semantic SSR HTML;
* titles;
* descriptions;
* canonical URLs;
* OpenGraph;
* social metadata;
* sitemap;
* robots;
* breadcrumbs;
* internal linking;
* clean URLs;
* structured data;
* image optimization;
* alt text;
* responsive performance;
* Core Web Vitals.

Core page content must be visible to crawlers without requiring user interactions.

---

# 78. AEO

Answer Engine Optimization requires content that is easy to extract and understand.

Provide:

* direct answers;
* clear definitions;
* question-style headings where natural;
* comparison tables;
* use cases;
* step-by-step answers;
* factual FAQs;
* concise summaries;
* feature explanations.

Do not keyword-stuff.

---

# 79. GEO

Optimize content for generative search/AI systems through:

* unambiguous product identity;
* factual claims;
* clear entities;
* original information;
* strong hierarchy;
* transparent authorship where relevant;
* publication/update dates;
* source-backed claims;
* structured data;
* crawlability;
* good internal links;
* XML sitemap;
* IndexNow where appropriate.

GEO must not be treated as magic.

Never promise AI search ranking.

---

# 80. CONTENT ARCHITECTURE

The owner intends future changes to mostly concern:

* keywords;
* SEO;
* AEO;
* GEO;
* marketing copy.

Therefore separate marketing content from application logic.

Use a maintainable typed content/MDX structure.

Do not hardcode every sentence deep inside React components.

---

# 81. SCHEMA.ORG

Use appropriate structured data such as:

* Organization
* SoftwareApplication
* Product
* Offer
* BreadcrumbList
* Article
* FAQPage
* WebSite
* WebPage
* VideoObject where actual videos exist

Only add schema that accurately describes visible content.

---

# 82. DATABASE ENGINEERING

Before creating tables:

1. Inspect existing schema.
2. Reuse domain models.
3. Avoid duplicates.
4. Define indexes.
5. Define ownership.
6. Define relations.
7. Define delete behavior.
8. Define auditability.
9. Define migration.

Potential entities may include:

* Lead
* LeadScore
* Sequence
* SequenceStep
* SequenceEnrollment
* Workflow
* WorkflowVersion
* WorkflowRun
* WorkflowStepRun
* Ticket
* Product
* ProductCategory
* DealLineItem
* Quote
* QuoteLineItem
* Campaign
* Notification
* Goal
* Achievement
* UserAchievement
* SavedView

These are suggestions, not mandatory table names.

---

# 83. MIGRATIONS

Every database migration must:

* preserve existing data;
* provide safe defaults;
* include indexes;
* support rollback strategy where feasible;
* update seeds;
* update fixtures;
* update tests.

Do not reset a potentially real database.

---

# 84. API ENGINEERING

Follow existing NestJS/tRPC patterns.

Required:

* validation;
* authorization;
* typed contracts;
* pagination;
* transactions;
* error normalization;
* idempotency;
* concurrency handling.

Do not move agent logic into API code if project architecture prohibits it.

---

# 85. BACKGROUND JOBS

Long-running operations must not depend on an open browser request.

Use the project's durable execution architecture.

Examples:

* imports;
* enrichment;
* sequences;
* workflows;
* broadcasts;
* scheduled AI;
* large exports.

---

# 86. SECURITY

Threat-model all new functionality.

Check:

* IDOR
* workspace isolation
* authorization
* SQL injection
* XSS
* CSRF
* SSRF
* file upload
* OAuth
* webhooks
* prompt injection
* AI tool permissions
* secret leakage
* workflow loops
* export authorization

Never expose secrets.

---

# 87. OBSERVABILITY

Add appropriate:

* structured logs;
* request IDs;
* workflow IDs;
* agent run IDs;
* errors;
* provider failures;
* sync errors;
* slow operations.

Do not log secrets.

---

# 88. PERFORMANCE

High-end design must stay fast.

Optimize:

* route bundles;
* server queries;
* JS;
* images;
* fonts;
* animations;
* tables;
* charts.

Use virtualization for large lists where appropriate.

Use pagination/cursors.

Do not fetch the entire CRM database to render a screen.

---

# 89. TESTING IS MANDATORY

Create tests at the correct layers.

### Unit

* calculations
* validation
* scoring
* permissions
* conditions

### Integration

* database
* transactions
* workflows
* sequences
* APIs

### Frontend

* components
* forms
* errors
* loading
* filters

### E2E

Verify major user flows.

---

# 90. REQUIRED END-TO-END FLOWS

At minimum verify:

### Flow 1

Create lead → qualify → convert → opportunity.

### Flow 2

Opportunity → stage movement → close.

### Flow 3

Task creation → completion.

### Flow 4

Sequence → enrollment → execution.

### Flow 5

Workflow → trigger → actions.

### Flow 6

Inbox conversation → CRM association.

### Flow 7

Product → opportunity line item.

### Flow 8

Quote generation.

### Flow 9

AI recommendation → approval/action.

### Flow 10

Gamification event.

### Flow 11

Role restrictions.

### Flow 12

Marketing public page rendering.

---

# 91. VISUAL QA

Verify actual rendered screens using browser automation if available.

Test:

* 1440 desktop
* laptop
* tablet
* mobile

Also test:

* Empty states
* Loading
* Errors
* Long names
* Large lists
* Dark mode
* Reduced motion
* Keyboard

---

# 92. SCREENSHOT EVIDENCE

Screenshots are useful as **verification evidence**.

Generate screenshots of the final implementation for important screens such as:

* Home
* Leads
* Lead record
* Opportunities
* Pipeline
* Tasks
* Conversations
* Sequences
* Workflow builder
* Agents
* Reports
* Products
* Admin
* Landing page
* Mobile navigation

These screenshots should show the implementation produced from this specification.

They are NOT a prerequisite input.

---

# 93. OPTIONAL SCREENSHOT REFERENCE PACK

If external screenshots are supplied in the future:

* inspect them;
* infer patterns;
* do not pixel-copy;
* preserve this application's identity.

If screenshots conflict with better accessibility or UX, improve them.

The specification remains authoritative.

---

# 94. NO-PLACEHOLDER RULE

Production code must not contain unfinished features disguised as complete.

Forbidden:

* `TODO: implement`
* mock success
* fake metrics
* random numbers
* empty handlers
* temporary auth bypass
* disabled feature pretending to work
* hardcoded AI response
* fake integration state

Development fixtures/tests are allowed.

---

# 95. ZERO-TECH-DEBT MINDSET

Before declaring a phase complete:

* remove dead imports;
* remove duplication;
* remove unused dependencies;
* remove debug logs;
* resolve type errors;
* resolve warnings caused by your work;
* ensure tests;
* ensure indexes;
* ensure permissions;
* ensure loading/error states.

Do not leave obvious debt for the user to fix.

---

# 96. AUTONOMOUS EXECUTION

Do not ask the user to approve every phase.

Proceed autonomously through implementation.

Ask only when blocked by:

* missing production credentials;
* irreversible production operation;
* domain/DNS control;
* legal/compliance choice;
* payment-provider ownership;
* genuinely ambiguous business rule with material consequences.

Do not ask for the reference video.

---

# 97. EXECUTION PHASES

Follow this sequence.

## PHASE 0

Environment and baseline.

## PHASE 1

Repository discovery.

## PHASE 2

Gap analysis.

## PHASE 3

Architecture and database planning.

## PHASE 4

Shared design system.

## PHASE 5

Lead and Deal advanced features.

## PHASE 6

Tasks and Engagements.

## PHASE 7

Conversations.

## PHASE 8

Products and Quotes.

## PHASE 9

Sequences.

## PHASE 10

Workflow Automation.

## PHASE 11

Advanced Agents.

## PHASE 12

Reporting and Forecasting.

## PHASE 13

Gamification.

## PHASE 14

Admin and Customization.

## PHASE 15

Animation polish.

## PHASE 16

Marketing website.

## PHASE 17

SEO/AEO/GEO.

## PHASE 18

Security/performance/accessibility.

## PHASE 19

Complete regression testing.

## PHASE 20

Final evidence report.

Dependencies may justify implementing portions concurrently, but do not skip validation.

---

# 98. CRITICAL ISSUE RESOLUTION RULE

This rule is absolute:

> An issue is not resolved until you reproduce it failing, apply the fix, reproduce it again, and obtain actual evidence that it passes.

An implementation change is not proof.

---

# 99. DEFECT WORKFLOW

For every issue:

## A. Reproduce

Run the real failing scenario.

Save actual evidence.

## B. Fix

Apply the smallest correct change.

## C. Reproduce again

Run the exact scenario again.

## D. Evidence

Capture:

* command output;
* test output;
* API response;
* database state;
* browser result;
* screenshot;
* network response;

as appropriate.

If you cannot produce pass evidence:

`STATUS: OPEN`

---

# 100. NEVER SAY THESE WITHOUT PROOF

Do not report:

* "should now work"
* "likely fixed"
* "this resolves it"
* "looks correct"
* "implemented successfully"

without verification evidence.

---

# 101. FINAL FULL VERIFICATION RUN

At the end, rerun every applicable Verify step back-to-back.

Do this in one validation session.

Produce:

| Item | Verification | Evidence | Status |
| ---- | ------------ | -------- | ------ |

Allowed states:

* PASS
* FAIL
* BLOCKED

Anything other than PASS is not completed.

---

# 102. AUDIT_REPORT.md

Search for:

`AUDIT_REPORT.md`

If present:

* read it;
* identify previously passing functionality;
* rerun relevant verification;
* confirm no regression.

If absent:

Report exactly:

`BLOCKED — AUDIT_REPORT.md was not available for regression verification.`

Never invent its contents.

---

# 103. COMPLETION_REPORT.md

Search for:

`COMPLETION_REPORT.md`

Perform the same procedure.

If absent:

`BLOCKED — COMPLETION_REPORT.md was not available for regression verification.`

---

# 104. PAYMENT SUMMARY REGRESSION

An earlier system issue may have involved a payment-summary key rename.

Therefore explicitly search for:

* Payment summary
* PaymentSummary
* paymentSummary
* old property names
* new property names
* serializers
* API responses
* clients
* portals
* dashboards

Verify every actual consumer.

A renamed backend property is not complete if a portal still expects the previous name.

---

# 105. TEST_EVIDENCE.md

Maintain:

`TEST_EVIDENCE.md`

Include:

* feature/issue;
* failing evidence;
* fix;
* passing evidence;
* final state.

---

# 106. OPEN_ISSUES.md

Maintain:

`OPEN_ISSUES.md`

For every unresolved issue include:

* issue;
* severity;
* affected area;
* blocker;
* recommended next action.

Do not hide unresolved items.

---

# 107. BUILD VERIFICATION

Use the repository's actual scripts.

Verify applicable:

* install;
* format;
* lint;
* typecheck;
* unit tests;
* integration tests;
* API tests;
* frontend tests;
* build;
* migrations;
* E2E.

Never invent convenient passing commands while ignoring repository-standard checks.

---

# 108. PRODUCTION READINESS

Verify:

* environment validation;
* error handling;
* logging;
* auth;
* authorization;
* migrations;
* rate limits;
* timeouts;
* retry logic;
* observability;
* storage;
* backup assumptions;
* secret handling.

---

# 109. FINAL DELIVERABLE DOCUMENTATION

Produce:

### `ADVANCED_CRM_EXISTING_FEATURES.md`

### `ADVANCED_CRM_GAP_ANALYSIS.md`

### `ADVANCED_CRM_IMPLEMENTATION_PLAN.md`

### `TEST_EVIDENCE.md`

### `OPEN_ISSUES.md`

plus architecture decisions where necessary.

---

# 110. FINAL REPORT

Your final response/report must contain:

## Executive Summary

What was actually built.

## Existing System Preserved

Important existing capabilities retained.

## Advanced Features Added

Exact list.

## Architecture

Backend, frontend, data and agent changes.

## Database

Models and migrations.

## AI/Agent Improvements

What is operational.

## Automation

Sequences/workflows.

## Gamification

What was built.

## UX

Design and animation.

## Marketing Website

Public pages.

## SEO/AEO/GEO

Implemented technical features.

## Security

What was verified.

## Performance

What was measured.

## Testing

Actual results.

## Regression Results

Including historical reports where available.

## Payment Contract Verification

Explicit results.

## Open Issues

Anything unverified.

## Deployment

Required commands/environment configuration.

## Final Status

Use only:

`FINAL STATUS: VERIFIED COMPLETE`

or

`FINAL STATUS: NOT COMPLETE — OPEN ITEMS REMAIN`

---

# 111. SCREEN-BY-SCREEN DEFINITION OF THE REQUIRED ADVANCED PRODUCT

To eliminate any dependence on a reference video, the following screens represent the expected advanced CRM experience.

These are functional specifications, not mandatory pixel designs.

---

## SCREEN A — HOME

Desktop composition:

### Top

* Greeting/context
* Search/command trigger
* Global create
* Notifications
* Profile

### KPI area

* Pipeline
* Forecast
* Leads
* Win rate
* Tasks

### Main area

Priority queue.

### Side area

AI recommendations.

### Secondary area

* Upcoming meetings
* Recent activity
* Goals
* Gamification

---

## SCREEN B — LEADS LIST

Header:

`Leads`

Actions:

`Import`
`Create lead`

Tabs/views:

* All
* Mine
* Hot
* New
* Qualified

Toolbar:

* Search
* Filter
* Sort
* Views

Data grid plus optional focused/kanban view.

---

## SCREEN C — LEAD PROFILE

Header:

* Person identity
* Company
* Lead status
* Lead score
* Owner

Actions:

* Email
* Call
* Task
* Meeting
* Convert

Main:

* Information
* Timeline
* AI insights

Tabs:

* Overview
* Activity
* Conversation
* Tasks
* AI
* Notes
* Files
* History

---

## SCREEN D — OPPORTUNITIES

Views:

* Pipeline
* Table
* Forecast

Pipeline board contains stages and opportunity cards.

Cards display:

* Name
* Company
* Amount
* Close date
* Owner
* Risk/health

---

## SCREEN E — DEAL PROFILE

Header:

* Deal
* Company
* Amount
* Stage
* Probability
* Owner

Primary areas:

* Overview
* Activity
* Contacts
* Products
* AI insights
* Tasks
* Quotes
* Timeline

---

## SCREEN F — TASKS

Three-pane or focused productivity layout where appropriate.

Sections:

* Today
* Overdue
* Upcoming

Task row:

* type;
* record;
* due;
* priority;
* quick complete.

---

## SCREEN G — ENGAGEMENTS

Tabs:

* All
* Calls
* Emails
* Meetings
* Messages
* Web

Timeline/table with advanced filters.

---

## SCREEN H — CONVERSATIONS

Three-column professional inbox:

### Inbox list

### Thread

### CRM context

AI actions inside conversation toolbar.

---

## SCREEN I — SEQUENCES

Sequence list.

Metrics:

* Active
* Enrolled
* Replies
* Meetings

Opening sequence shows a vertically connected step builder.

---

## SCREEN J — WORKFLOW BUILDER

Canvas.

Left node library.

Center flow.

Right property inspector.

Top bar:

* Name
* Status
* Test
* Publish

Bottom/secondary panel:

* execution history.

---

## SCREEN K — AI AGENTS

Cards/list of agents.

Agent card:

* Name
* Purpose
* State
* Last run
* Schedule
* Success/failure

Actions:

* Run
* Edit
* Pause
* History

---

## SCREEN L — AGENT DETAIL

Sections:

* Objective
* Tools
* Trigger
* Instructions
* Tasks
* Runs
* Evidence
* Logs

---

## SCREEN M — PRODUCTS

Table/cards.

Fields:

* Name
* SKU
* Category
* Price
* Status

Product details drawer/page.

---

## SCREEN N — QUOTES

Table:

* Quote
* Customer
* Opportunity
* Amount
* Status
* Valid until

Quote builder.

---

## SCREEN O — REPORTS

Report navigation/sidebar.

Main dashboard:

* KPI cards
* charts
* filters
* date range
* ownership
* pipeline

Clicking metrics drills into source data.

---

## SCREEN P — FORECAST

Grid by:

* Owner
* Commit
* Best Case
* Pipeline
* Closed
* Quota

Support manager/team view.

---

## SCREEN Q — NOTIFICATIONS

Dropdown/panel:

* Today
* Earlier

Grouped notification types.

Deep links.

---

## SCREEN R — GAMIFICATION PROFILE

May exist as panel rather than entire page.

Display:

* Level
* XP
* Weekly missions
* Streak
* Achievements
* Personal performance

---

## SCREEN S — ADMIN

Settings navigation:

* Workspace
* CRM Customization
* Pipelines
* Fields
* Teams
* Users
* Integrations
* Templates
* Automations
* Notifications
* Security

---

## SCREEN T — MARKETING LANDING PAGE

Visually richer than CRM.

Sections:

1. Navigation
2. Hero
3. Animated CRM preview
4. Social proof/trust if factual
5. Problem
6. Agentic solution
7. Feature demonstrations
8. Workflow animation
9. Lead intelligence
10. Gamification
11. Integrations
12. Security
13. Pricing/CTA
14. FAQ
15. Footer

---

# 112. IMPORTANT PRODUCT PHILOSOPHY

The finished CRM should feel like:

> An AI-native operating system for managing and growing relationships and revenue.

Not:

> A traditional CRM with ChatGPT added to the sidebar.

AI should participate in:

* prioritization;
* research;
* enrichment;
* work planning;
* summaries;
* workflow;
* next actions;
* risk analysis;
* automation.

But humans retain appropriate control over consequential actions.

---

# 113. DO NOT OVERBUILD

Advanced does not mean bloated.

Before adding anything ask:

> Does this materially help users capture relationships, progress opportunities, automate work, or understand the business?

If no, do not add it.

---

# 114. USE INDUSTRY REFERENCES INTELLIGENTLY

Research modern patterns from high-quality CRM and productivity products.

Examples of categories worth studying:

* Salesforce
* HubSpot
* Attio
* Twenty
* Close
* Pipedrive
* Linear
* Notion
* Raycast
* Stripe
* modern AI tools
* modern workflow products

Study patterns.

Do not duplicate their proprietary designs.

Use open-source repositories where legally appropriate.

---

# 115. DO NOT CLAIM "PRODUCTION READY" CASUALLY

Production readiness requires evidence.

A beautiful interface with incomplete backend functions is NOT production ready.

A backend with no tested UX is NOT production ready.

A passing build with broken workflows is NOT production ready.

A unit-test suite without E2E evidence is NOT production ready.

---

# 116. YOUR OPERATING LOOP

For each meaningful feature:

**Inspect existing implementation**

↓

**Design minimal coherent extension**

↓

**Create/update schema**

↓

**Implement backend**

↓

**Implement UI**

↓

**Add tests**

↓

**Reproduce behavior**

↓

**Verify actual result**

↓

**Check regression**

↓

**Move forward**

---

# 117. THE MOST IMPORTANT INSTRUCTION

Never confuse code generation with completed software.

The required output is a functioning application.

Therefore:

**BUILD IT.**

**RUN IT.**

**TEST IT.**

**BREAK IT.**

**FIX IT.**

**RUN IT AGAIN.**

**SHOW THE PASSING EVIDENCE.**

If you cannot show the evidence:

**THE ITEM REMAINS OPEN.**

Do not request the reference video.

Do not depend on the reference video.

The specification above contains the functional product requirements required to execute the advanced CRM expansion.