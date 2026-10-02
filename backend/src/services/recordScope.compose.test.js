import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Record visibility must survive every other filter on a list.
//
// The scope fragment is an `OR`. listLeads and listDeals used to spread it into
// `where` and then assign `where.OR` for a status/stage filter, which replaced
// the scope: under OWN, `GET /leads?status=NEW` listed every NEW lead in the
// workspace. These tests run the real list functions against an in-memory
// Prisma stand-in that evaluates the `where` it is given, so a scope that is
// dropped shows up as a colleague's record in the result.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

mock.module('./dealHealth.service.js', {
  namedExports: {
    computeWorkspaceDealHealth: async () => new Map(),
    computeDealHealth: async () => null,
  },
});

const { prisma } = await import('../lib/prisma.js');
const { withScope, scopedWhere, scopeFilter } = await import('./recordScope.service.js');
const { listLeads } = await import('./leads.service.js');
const { listDeals } = await import('./deals.service.js');
const { listTasks } = await import('./tasks.service.js');
const { listTickets } = await import('./tickets.service.js');
const { listActivities } = await import('./activities.service.js');

// Evaluates the subset of Prisma's where-syntax the list endpoints use.
function matches(row, where) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return [].concat(cond).every((w) => matches(row, w));
    if (key === 'OR') return cond.some((w) => matches(row, w));
    if (key === 'NOT') return ![].concat(cond).some((w) => matches(row, w));
    const value = row[key];
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return (value ?? null) === cond;
    if ('is' in cond) return value != null && matches(value, cond.is);
    if ('contains' in cond) return typeof value === 'string' && value.includes(cond.contains);
    if ('path' in cond) {
      const v = cond.path.reduce((o, k) => (o == null ? undefined : o[k]), value);
      return (v ?? null) === cond.equals;
    }
    if ('equals' in cond) return (value ?? null) === cond.equals;
    if ('in' in cond) return cond.in.includes(value);
    if ('notIn' in cond) return !cond.notIn.includes(value);
    if ('lt' in cond) return value != null && value < cond.lt;
    return true; // relation filters are not exercised here
  });
}

let visibility = 'OWN';
let teams = [];
const rows = {
  lead: [
    { id: 'l_me_new', workspaceId: 'ws', ownerUserId: 'me', status: 'NEW', customFields: null },
    { id: 'l_peer_new', workspaceId: 'ws', ownerUserId: 'peer', status: 'NEW', customFields: null },
    { id: 'l_other_new', workspaceId: 'ws', ownerUserId: 'other', status: 'NEW', customFields: null },
    { id: 'l_none_new', workspaceId: 'ws', ownerUserId: null, status: 'NEW', customFields: null },
    { id: 'l_other_custom', workspaceId: 'ws', ownerUserId: 'other', status: 'NEW', customFields: { statusKey: 'DEMO' } },
    { id: 'l_me_custom', workspaceId: 'ws', ownerUserId: 'me', status: 'NEW', customFields: { statusKey: 'DEMO' } },
  ],
  deal: [
    { id: 'd_me', workspaceId: 'ws', ownerUserId: 'me', stage: 'PROPOSAL', customFields: null },
    { id: 'd_other', workspaceId: 'ws', ownerUserId: 'other', stage: 'PROPOSAL', customFields: null },
    { id: 'd_other_custom', workspaceId: 'ws', ownerUserId: 'other', stage: 'QUALIFICATION', customFields: { stageKey: 'PILOT' } },
  ],
  task: [
    { id: 't_me', workspaceId: 'ws', assignedToUserId: 'me', status: 'PENDING', dueDate: new Date(0) },
    { id: 't_other', workspaceId: 'ws', assignedToUserId: 'other', status: 'PENDING', dueDate: new Date(0) },
  ],
  crmActivity: [
    { id: 'a_my_lead', workspaceId: 'ws', type: 'NOTE', content: 'x', createdByUserId: 'other', leadId: 'l1', lead: { ownerUserId: 'me' }, dealId: null, deal: null },
    { id: 'a_other_lead', workspaceId: 'ws', type: 'NOTE', content: 'x', createdByUserId: 'other', leadId: 'l2', lead: { ownerUserId: 'other' }, dealId: null, deal: null },
    { id: 'a_mine_on_other_lead', workspaceId: 'ws', type: 'CALL', content: 'x', createdByUserId: 'me', leadId: 'l2', lead: { ownerUserId: 'other' }, dealId: null, deal: null },
    { id: 'a_unowned_deal', workspaceId: 'ws', type: 'MEETING', content: '{"engagementType":"Visit"}', createdByUserId: 'other', leadId: null, lead: null, dealId: 'd9', deal: { ownerUserId: null } },
    { id: 'a_other_contact_note', workspaceId: 'ws', type: 'MEETING', content: 'x', createdByUserId: 'other', leadId: null, lead: null, dealId: null, deal: null },
    { id: 'a_system_note', workspaceId: 'ws', type: 'NOTE', content: 'x', createdByUserId: null, leadId: null, lead: null, dealId: null, deal: null },
  ],
  crmTicket: [
    { id: 'k_me', workspaceId: 'ws', ownerUserId: 'me', status: 'OPEN', priority: 'HIGH' },
    { id: 'k_other', workspaceId: 'ws', ownerUserId: 'other', status: 'OPEN', priority: 'HIGH' },
  ],
};

for (const model of Object.keys(rows)) {
  prisma[model].findMany = async ({ where }) => rows[model].filter((r) => matches(r, where));
  prisma[model].count = async ({ where }) => rows[model].filter((r) => matches(r, where)).length;
}
prisma.crmActivity.groupBy = async ({ where }) => {
  const counts = {};
  for (const r of rows.crmActivity.filter((x) => matches(x, where))) counts[r.type] = (counts[r.type] || 0) + 1;
  return Object.entries(counts).map(([type, n]) => ({ type, _count: { _all: n } }));
};
prisma.workspace.findUnique = async () => ({ recordVisibility: visibility });
prisma.teamMember.findMany = async ({ where }) => {
  if (where.userId) return teams.filter((t) => t.userId === where.userId).map(({ teamId }) => ({ teamId }));
  return teams.filter((t) => where.teamId.in.includes(t.teamId)).map(({ userId }) => ({ userId }));
};

const me = { id: 'me', role: 'CLIENT' };
const ids = (res) => res.data.map((r) => r.id).sort();

test.beforeEach(() => { visibility = 'OWN'; teams = []; });

test('withScope ANDs the scope beside an existing OR and keeps prior AND clauses', () => {
  const scope = { OR: [{ ownerUserId: 'me' }, { ownerUserId: null }] };
  const where = withScope({ workspaceId: 'ws', OR: [{ status: 'NEW' }], AND: [{ category: 'HOT' }] }, scope);
  assert.deepEqual(where, {
    workspaceId: 'ws',
    OR: [{ status: 'NEW' }],
    AND: [{ category: 'HOT' }, scope],
  });
  assert.deepEqual(withScope({ AND: { a: 1 } }, scope).AND, [{ a: 1 }, scope]);
  const plain = { workspaceId: 'ws' };
  assert.equal(withScope(plain, {}), plain, 'an empty scope leaves the where untouched');
});

test('scopedWhere leaves internal (user-less) callers unscoped and scopes members', async () => {
  assert.deepEqual(await scopedWhere('ws', null, { id: 'x' }), { id: 'x' });
  assert.deepEqual(await scopedWhere('ws', me, { id: 'x' }), {
    id: 'x',
    AND: [{ OR: [{ ownerUserId: 'me' }, { ownerUserId: null }] }],
  });
  assert.deepEqual(await scopedWhere('ws', { id: 'a', role: 'ADMIN' }, { id: 'x' }), { id: 'x' });
});

test('OWN: a built-in status filter no longer lists colleagues\' leads', async () => {
  assert.deepEqual(ids(await listLeads('ws', { status: 'NEW' }, me)), ['l_me_new', 'l_none_new']);
});

test('OWN: a custom lifecycle status filter stays scoped', async () => {
  assert.deepEqual(ids(await listLeads('ws', { status: 'DEMO' }, me)), ['l_me_custom']);
});

test('OWN: an explicit owner filter cannot widen the scope', async () => {
  assert.deepEqual(ids(await listLeads('ws', { ownerUserId: 'other' }, me)), []);
});

test('TEAM: a status filter shows the team\'s leads and nobody else\'s', async () => {
  visibility = 'TEAM';
  teams = [{ teamId: 'sales', userId: 'me' }, { teamId: 'sales', userId: 'peer' }];
  assert.deepEqual(ids(await listLeads('ws', { status: 'NEW' }, me)), ['l_me_new', 'l_none_new', 'l_peer_new']);
});

test('ALL and admins still see every lead under a status filter', async () => {
  visibility = 'ALL';
  assert.equal((await listLeads('ws', { status: 'NEW' }, me)).total, 4);
  visibility = 'OWN';
  assert.equal((await listLeads('ws', { status: 'NEW' }, { id: 'boss', role: 'ADMIN' })).total, 4);
});

test('OWN: built-in and custom stage filters on deals stay scoped', async () => {
  assert.deepEqual(ids(await listDeals('ws', { stage: 'PROPOSAL' }, me)), ['d_me']);
  assert.deepEqual(ids(await listDeals('ws', { stage: 'PILOT' }, me)), []);
});

test('OWN: tasks filtered by status/overdue stay scoped to the assignee', async () => {
  assert.deepEqual(ids(await listTasks('ws', { status: 'PENDING' }, me)), ['t_me']);
  assert.deepEqual(ids(await listTasks('ws', { isOverdue: 'true' }, me)), ['t_me']);
  assert.deepEqual(ids(await listTasks('ws', { assignedToUserId: 'other' }, me)), []);
});

test('OWN: ticket views stay scoped', async () => {
  assert.deepEqual(ids(await listTickets('ws', { view: 'all', status: 'OPEN' }, me)), ['k_me']);
});

test('a user without an id sees nothing even when a filter names an owner', async () => {
  const scope = await scopeFilter('ws', {});
  const where = withScope({ workspaceId: 'ws', ownerUserId: 'other' }, scope);
  assert.equal(rows.lead.filter((r) => matches(r, where)).length, 0);
});

test("OWN: activities follow their lead/deal, plus the caller's own notes", async () => {
  const res = await listActivities('ws', {}, me);
  assert.deepEqual(ids(res), ['a_mine_on_other_lead', 'a_my_lead', 'a_system_note', 'a_unowned_deal']);
  assert.equal(res.counts.ALL, 4, 'tab counts are scoped too');
  const searched = await listActivities('ws', { search: 'x' }, me);
  assert.ok(!searched.data.some((a) => a.id === 'a_other_lead'), 'a search OR cannot drop the scope');
});

test('visits and video calls are counted and filtered separately', async () => {
  visibility = 'ALL';
  const all = await listActivities('ws', {}, me);
  assert.equal(all.counts.VISITS, 1);
  assert.equal(all.counts.VIDEO_CALL, 1);
  assert.deepEqual(ids(await listActivities('ws', { type: 'VISITS' }, me)), ['a_unowned_deal']);
  assert.deepEqual(ids(await listActivities('ws', { type: 'VIDEO_CALL' }, me)), ['a_other_contact_note']);
});
