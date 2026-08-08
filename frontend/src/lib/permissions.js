// Who can do what inside a workspace.
//
// Members run the workspace: numbers, templates, campaigns, contacts,
// segments, automations, the AI agent, forms, integrations, API keys and
// settings are all theirs. Two things stay with admins, and they are really
// one thing — spending money, and handing out the access that would let
// someone start spending it. A member who could change roles could promote
// themselves and reach billing anyway, so both live behind the same gate.
//
// Mirrors backend/src/middleware/authorize.js. Note that this only decides
// what the UI offers: every one of these actions is enforced server-side, so
// a stale localStorage role can hide a button but never grant a permission.

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

const isWorkspaceAdmin = (user) => workspaceRole(user) === 'ADMIN' || user?.superAdmin === true;

// Everything operational. Both roles.
export function canManage(user = currentUser()) {
  return Boolean(workspaceRole(user)) || user?.superAdmin === true;
}

// Wallet recharge, plan checkout, billing details.
export function canBill(user = currentUser()) {
  return isWorkspaceAdmin(user);
}

// Invites, role changes, removing members.
export function canManageMembers(user = currentUser()) {
  return isWorkspaceAdmin(user);
}
