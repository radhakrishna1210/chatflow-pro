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

// Operational work: campaigns, templates, automations, numbers, API keys,
// settings. Member and above.
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
