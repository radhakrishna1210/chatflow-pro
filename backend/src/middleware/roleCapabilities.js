// What the two read-mostly roles may do, enforced centrally.
//
// The alternative was annotating every workspace route with an authorize()
// call. There are around forty route files and many routes carry no guard at
// all beyond membership — which was fine when the only roles were ADMIN and
// CLIENT, since both were trusted to run the workspace. Adding VIEWER and AGENT
// changes that: a route nobody remembered to annotate would silently hand a
// viewer full write access, and the failure would be invisible.
//
// So the rule is inverted. This runs on every workspace-scoped request and
// denies by default for the restricted roles, allowing only what each is
// explicitly for. A new route added tomorrow is closed to them until someone
// decides otherwise, which is the right direction for the mistake to fall.

// The one ordering of workspace roles. authorize() and the floor below both
// compare against it, so "at least CLIENT" means the same thing everywhere.
export const ROLE_RANK = Object.freeze({ VIEWER: 0, AGENT: 1, CLIENT: 2, ADMIN: 3 });

export function roleAtLeast(role, minimum) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minimum] ?? Infinity);
}

// Safe methods never change anything, so both roles keep read access — that is
// what they are for — except for the bulk exports below.
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Reads that hand over the whole contact base in one file. Seeing a record in
// the inbox is the job; walking off with all of them is not.
const MEMBER_ONLY_READS = [
  /^\/contacts\/export$/,
  /^\/(opt-outs|blocked-numbers)\/export$/,
];

// Exactly the writes an agent's day-to-day work needs, by method and path (as
// they appear under /workspaces/:id/…). Listing them one by one rather than by
// resource prefix matters: a prefix also grants every route added under it
// later, which is how paid template sends, inbound simulation and bulk import
// ended up open to agents.
//
// An agent handles conversations — replying, assigning, taking notes,
// resolving; keeps contact records straight as they do it; logs CRM
// activities; and blocks a number that asks to be left alone.
const AGENT_WRITES = [
  ['POST', /^\/conversations\/[^/]+\/messages$/],
  ['POST', /^\/conversations\/[^/]+\/media$/],
  ['POST', /^\/conversations\/[^/]+\/suggest$/],
  ['POST', /^\/conversations\/[^/]+\/notes$/],
  ['DELETE', /^\/conversations\/[^/]+\/notes\/[^/]+$/],
  ['PATCH', /^\/conversations\/[^/]+\/(assign|status|bot)$/],
  ['POST', /^\/contacts$/],
  ['PATCH', /^\/contacts\/[^/]+$/],
  ['POST', /^\/(opt-outs|blocked-numbers)$/],
  ['POST', /^\/activities$/],
  // The inbox's own AI reply preview; changes nothing. Old and canonical path.
  ['POST', /^\/ai-agent\/test$/],
  ['POST', /^\/ai-agents\/whatsapp\/test$/],
];

// Writes that change the caller's own session, not the workspace: every
// member may make this workspace their active one.
const ANY_MEMBER_WRITES = [
  ['POST', /^\/switch$/],
];

// Path of the request relative to /workspaces/:id. `baseUrl` carries the
// resource mount (…/workspaces/:id/conversations) and `path` the rest.
function workspaceRelativePath(req) {
  const mounted = `${req.baseUrl || ''}${req.path || ''}`;
  const idx = mounted.indexOf('/workspaces/');
  const relative = idx === -1
    ? mounted
    : mounted.slice(idx + '/workspaces/'.length).replace(/^[^/]+/, '');
  return relative.length > 1 ? relative.replace(/\/+$/, '') : relative;
}

const ROLE_LABEL = {
  VIEWER: 'Viewer',
  AGENT: 'Agent',
  CLIENT: 'Member',
  ADMIN: 'Admin',
};

const deny = (role, action) => ({
  status: 403,
  body: {
    error: `${ROLE_LABEL[role] || role}s cannot ${action}. Ask a workspace admin if you need this.`,
    code: 'ROLE_NOT_PERMITTED',
    role,
  },
});

// Returns null when the request is allowed, or { status, body } when it is not.
//
// Called from workspaceContext rather than mounted as its own middleware,
// because it needs `req.user.role` — which only exists once authenticate and
// the membership lookup have run, and those live inside each resource router.
// Mounting it on the parent router would have run it first, with no role set,
// and quietly allowed everything.
export function checkRoleCapability(req) {
  const role = req.user?.role;

  // Platform super admins are reviewing workspaces, not members of them.
  if (req.user?.superAdmin === true) return null;
  // CLIENT and ADMIN are unchanged — their limits are the authorize() calls
  // that already exist on the routes that need them.
  if (role !== 'VIEWER' && role !== 'AGENT') return null;

  const relative = workspaceRelativePath(req);

  if (READ_ONLY_METHODS.has(req.method)) {
    if (MEMBER_ONLY_READS.some((re) => re.test(relative))) {
      return deny(role, 'export the full list — ask a member or admin');
    }
    return null;
  }

  if (ANY_MEMBER_WRITES.some(([method, re]) => method === req.method && re.test(relative))) return null;

  if (role === 'VIEWER') return deny(role, 'change anything in this workspace');

  const allowed = AGENT_WRITES.some(([method, re]) => method === req.method && re.test(relative));
  if (allowed) return null;

  return deny(role, 'change this — agents work in the inbox and with contacts');
}
