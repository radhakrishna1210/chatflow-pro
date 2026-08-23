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

// Safe methods never change anything, so both roles keep full read access —
// that is what they are for.
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The mount paths (as they appear under /workspaces/:id/…) where an agent's
// day-to-day work happens. An agent handles conversations: replying, assigning,
// taking notes, resolving; keeping contact records straight as they do it; and
// blocking a number that asks to be left alone.
const AGENT_WRITABLE_PREFIXES = [
  '/conversations',
  '/contacts',
  '/opt-outs',
  '/blocked-numbers',
  // Reading a thread marks it read, and the inbox needs its own AI reply
  // suggestions — both are POSTs that change nothing an agent should not touch.
  '/ai-agent/test',
];

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

  if (READ_ONLY_METHODS.has(req.method)) return null;

  if (role === 'VIEWER') return deny(role, 'change anything in this workspace');

  // AGENT: writes confined to the surfaces above. `baseUrl` carries the
  // resource mount (…/workspaces/:id/conversations) and `path` the rest, so the
  // two together are what the prefixes are written against.
  const mounted = `${req.baseUrl || ''}${req.path || ''}`;
  const idx = mounted.indexOf('/workspaces/');
  const relative = idx === -1
    ? mounted
    : mounted.slice(idx + '/workspaces/'.length).replace(/^[^/]+/, '');
  const allowed = AGENT_WRITABLE_PREFIXES.some((p) => relative === p || relative.startsWith(`${p}/`));
  if (allowed) return null;

  return deny(role, 'change this — agents work in the inbox and with contacts');
}
