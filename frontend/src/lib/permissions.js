// Who can do what inside a workspace.
//
// Four roles, ordered by capability:
//
//   VIEWER  sees everything and changes nothing. For a stakeholder who wants
//           the numbers without the ability to send, spend or edit.
//   AGENT   works the inbox — replying, assigning, resolving, taking notes,
//           keeping contacts straight, blocking a number. Everything else is
//           read-only.
//   CLIENT  ("Member") runs the workspace day to day: numbers, templates,
//           campaigns, contacts, segments, automations, the AI agent, forms,
//           integrations, API keys and settings.
//   ADMIN   additionally holds the two capabilities that are really one —
//           spending money (wallet recharge, plan checkout) and granting access
//           (invites, role changes). The second guards the first: a member who
//           could change roles could promote themselves into billing.
//
// Mirrors backend/src/middleware/authorize.js and roleCapabilities.js. This
// only decides what the UI offers — every one of these is enforced server-side,
// so a stale localStorage role can hide a button but never grant a permission.

const RANK = { VIEWER: 0, AGENT: 1, CLIENT: 2, ADMIN: 3 };

export const ROLE_LABELS = {
  VIEWER: 'Viewer',
  AGENT: 'Agent',
  CLIENT: 'Member',
  ADMIN: 'Admin',
};

export const ROLE_DESCRIPTIONS = {
  VIEWER: 'Read-only. Can see everything, change nothing.',
  AGENT: 'Handles the inbox and contacts. Cannot run campaigns or change settings.',
  CLIENT: 'Runs the workspace day to day. Cannot spend money or manage members.',
  ADMIN: 'Full access, including billing and members.',
};

// The order the role picker should list them in.
export const ASSIGNABLE_ROLES = ['VIEWER', 'AGENT', 'CLIENT', 'ADMIN'];

function currentUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null') || {};
  } catch {
    return {};
  }
}

export function workspaceRole(user = currentUser()) {
  return user?.role ?? null;
}

const rank = (user) => (user?.superAdmin === true ? RANK.ADMIN : (RANK[workspaceRole(user)] ?? -1));

const isWorkspaceAdmin = (user) => workspaceRole(user) === 'ADMIN' || user?.superAdmin === true;

// Operational work: campaigns, templates, automations, settings. Member and
// above.
export function canManage(user = currentUser()) {
  return rank(user) >= RANK.CLIENT;
}

// Inbox work: replying, assigning, notes, contacts, blocking a number.
export function canHandleConversations(user = currentUser()) {
  return rank(user) >= RANK.AGENT;
}

// Anything at all. False only for someone with no workspace role.
export function canView(user = currentUser()) {
  return rank(user) >= RANK.VIEWER;
}

// True when the role is read-only, so a screen can say so once at the top
// instead of disabling twenty controls silently.
export function isReadOnly(user = currentUser()) {
  return workspaceRole(user) === 'VIEWER' && user?.superAdmin !== true;
}

// Wallet recharge, plan checkout, billing details.
export function canBill(user = currentUser()) {
  return isWorkspaceAdmin(user);
}

// Invites, role changes, removing members.
export function canManageMembers(user = currentUser()) {
  return isWorkspaceAdmin(user);
}

// Credentials and connections: API keys, the webhook destination, WhatsApp
// numbers and the OTP configuration.
export function canManageIntegrations(user = currentUser()) {
  return isWorkspaceAdmin(user);
}

// ─── role → capability map ───────────────────────────────────────────────────
//
// The one place a screen asks "may this role do X". Each entry is the lowest
// workspace role the server accepts for that action, read off the backend:
//
//   - authorize('CLIENT' | 'ADMIN') on the route (backend/src/routes/*.js), and
//   - the VIEWER/AGENT floor in backend/src/middleware/roleCapabilities.js,
//     which denies every write to VIEWER and every write outside AGENT_WRITES
//     to AGENT — so a route with no authorize() at all is still CLIENT here.
//
// When a route's guard changes, change its line here; views call can(...)
// rather than comparing roles themselves.
export const CAPABILITIES = Object.freeze({
  // AGENT_WRITES: inbox work and keeping contacts straight.
  'inbox.reply':            'AGENT',  // POST /conversations/:id/messages|media
  'inbox.manage':           'AGENT',  // notes, assign, status, bot toggle, reply suggestions
  'inbox.sendTemplate':     'CLIENT', // POST /conversations/:id/template (paid send)
  'inbox.startConversation':'CLIENT', // POST /conversations
  'contacts.edit':          'AGENT',  // POST /contacts, PATCH /contacts/:id
  'contacts.block':         'AGENT',  // POST /opt-outs, /blocked-numbers
  'activities.log':         'AGENT',  // POST /activities
  'aiAgent.test':           'AGENT',  // POST /ai-agents/whatsapp/test (alias /ai-agent/test)

  // Member work (authorize('CLIENT'), or no guard below the floor).
  'contacts.import':        'CLIENT',
  'contacts.delete':        'CLIENT',
  'contacts.export':        'CLIENT', // MEMBER_ONLY_READS
  'contacts.unblock':       'CLIENT',
  'segments.manage':        'CLIENT', // segments and clusters
  'templates.manage':       'CLIENT', // create, edit, delete, sync, library install, AI draft
  'campaigns.manage':       'CLIENT', // create, edit, launch, pause, resume, cancel, export
  'automation.manage':      'CLIENT', // basic, auto-replies, workflows, IG flows, voice, WhatsApp forms
  'intents.manage':         'CLIENT',
  'aiAgents.manage':        'CLIENT', // studio agents and channels, WhatsApp agent config/deploy/knowledge
  'aiAgents.studioTest':    'CLIENT', // POST /ai-agents/:id/test
  'aiAgent.settleSuggestion':'CLIENT',// PATCH /ai-agents/autonomous/facts/:id
  'widgets.manage':         'CLIENT',
  'crm.records':            'CLIENT', // leads, deals, tasks, quotes, products, sequences, forms, tickets
  'crm.savedViews':         'CLIENT',
  'activities.delete':      'CLIENT',
  'support.create':         'CLIENT',
  'settings.workspace':     'CLIENT', // PATCH /settings (non-webhook fields)

  // Admin only (authorize('ADMIN')).
  'billing':                'ADMIN',  // wallet, plan checkout, billing profile, add-ons
  'members.manage':         'ADMIN',  // invites, roles, removal
  'teams.manage':           'ADMIN',
  'integrations.manage':    'ADMIN',  // API keys, webhook, WhatsApp connect/disconnect, OTP config
  'crm.customize':          'ADMIN',  // CRM customization, pipeline stages, custom field definitions
  'gamification.settings':  'ADMIN',
  'autonomousAgent.manage': 'ADMIN',  // switch, run, queue: cancel / run early / retry
});

// True when the user's role meets the capability's floor. An unknown
// capability is denied, so a typo hides a button rather than showing one the
// server will refuse.
export function can(capability, user = currentUser()) {
  const min = CAPABILITIES[capability];
  if (!min) return false;
  return rank(user) >= RANK[min];
}

// Dashboard sections a role cannot do anything in. VIEWER and AGENT keep every
// section they can read; these are pure configuration, so opening one shows a
// no-access page instead. Sections not listed are open to every member.
export const SECTION_MIN_ROLE = Object.freeze({
  widget:               'CLIENT',
  integrations:         'CLIENT',
  setup:                'CLIENT',
  api:                  'CLIENT',
  'customize-business': 'CLIENT',
  'campaigns-create':   'CLIENT',
});

export function canOpenSection(section, user = currentUser()) {
  if (user?.superAdmin === true) return true;
  const min = SECTION_MIN_ROLE[section];
  return !min || rank(user) >= RANK[min];
}

export function roleLabel(user = currentUser()) {
  return ROLE_LABELS[workspaceRole(user)] || 'Member';
}
