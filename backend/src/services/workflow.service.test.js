import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The builder ↔ API contract for workflows (C1–C6) and "Test this workflow"
// (WF-EN-18), through the real validator, service and controller with the
// database faked in memory. Ported from the audit's builder-contract repro,
// whose FINDING tests asserted the broken behaviour.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

mock.module('../queues/workflow.queue.js', {
  namedExports: { workflowQueue: {}, enqueueWorkflowResume: async () => {}, enqueueReplyReminder: async () => {}, enqueueDelayedResponseCheck: async () => {} },
});

const { prisma } = await import('../lib/prisma.js');
const { workflowSchemas } = await import('../validators/index.js');
const service = await import('./workflow.service.js');
const controller = await import('../controllers/workflow.controller.js');

const WS = 'ws_contract';
const kw = (value = 'HELP') => ({ id: 'step_1', type: 'trigger', subtype: 'keyword', value });
const msg = (value, id = `m_${value}`) => ({ id, type: 'action', subtype: 'message', value });
const firstError = (r) => r.error?.issues?.[0]?.message ?? '';

let templates = [];
let workflows = [];
let lifecycle = null;
let pipeline = [];
let created = null;
let updated = null;
let contacts = [];
let conversations = [];

prisma.template.findFirst = async ({ where }) => templates.find((t) => {
  if (where.id) return t.id === where.id;
  if (where.status && t.status !== where.status) return false;
  return (where.OR ?? []).some((o) => (typeof o.name === 'string' ? o.name === t.name : o.name?.equals?.toLowerCase() === t.name.toLowerCase()));
}) ?? null;
prisma.template.findMany = async ({ where }) => templates.filter((t) => !where.status || t.status === where.status);
prisma.workflow.findMany = async ({ where }) => workflows.filter((w) => (where.isActive === undefined || w.isActive === where.isActive)
  && (!where.id?.not || w.id !== where.id.not));
prisma.workflow.findFirst = async ({ where }) => workflows.find((w) => w.id === where.id) ?? null;
prisma.workflow.create = async ({ data }) => { created = data; return { id: 'wf_new', createdAt: new Date(), updatedAt: new Date(), ...data }; };
prisma.workflow.update = async ({ where, data }) => { updated = data; return { ...workflows.find((w) => w.id === where.id), ...data }; };
prisma.savedView.findFirst = async () => (lifecycle ? { filters: lifecycle } : null);
prisma.pipelineStage.findMany = async () => pipeline;
prisma.contact.findFirst = async ({ where }) => contacts.find((c) => c.id === where.id) ?? null;
prisma.conversation.findFirst = async ({ where }) => conversations.find((c) => c.contactId === where.contactId) ?? null;

const reset = () => {
  templates = []; workflows = []; lifecycle = null; pipeline = []; created = null; updated = null; contacts = []; conversations = [];
  prisma.workflowRun.findMany = async () => [];
};
test.beforeEach(reset);

// ── C5 ───────────────────────────────────────────────────────────────────────

test('C5: every delay the builder offers saves, "Immediate" included', () => {
  for (const v of ['Immediate', 'immediate', '0', '5 min', '1 hour', '1 day', '1h']) {
    const r = workflowSchemas.create.safeParse({ name: 'Delay flow', nodes: [kw(), msg('Hello'), { id: 'd', type: 'action', subtype: 'delay', value: v }, msg('Later')] });
    assert.equal(r.success, true, `${v}: ${firstError(r)}`);
  }
});

// ── C2 ───────────────────────────────────────────────────────────────────────

test('C2: create stores the normalised graph (the inserted wait) and returns warnings', async () => {
  const nodes = [
    kw('HELP'),
    { id: 'b', type: 'action', subtype: 'buttons', value: 'How can we help? | Track my order | Talk to support', pos: { x: 10, y: 20 } },
    { id: 'c', type: 'condition', subtype: 'equals', value: 'Track my order', skipIfFalse: 1 },
    msg('Send your order ID'),
  ];
  const out = await service.createWorkflow(WS, { name: 'API flow', nodes });
  assert.deepEqual(created.nodes.map((n) => n.subtype), ['keyword', 'buttons', 'wait_reply', 'equals', 'message']);
  assert.deepEqual(created.nodes[1].pos, { x: 10, y: 20 }, 'canvas positions survive');
  assert.equal(created.nodes[0].id, 'step_1');
  assert.ok(Array.isArray(out.warnings));
  assert.match(out.warnings[0], /Added a "wait for their reply" after step 1/);
});

test('C2: update returns warnings and stores the normalised graph; a hard error is still a 400', async () => {
  workflows = [{ id: 'wf_1', workspaceId: WS, name: 'x', isActive: true, nodes: [kw(), msg('hi')] }];
  const out = await service.updateWorkflow(WS, 'wf_1', { nodes: [kw(), msg('hi'), { type: 'action', subtype: 'agent', value: '' }] });
  assert.ok(out.warnings.some((w) => /pauses all automation/.test(w)));
  assert.equal(updated.nodes.length, 3);
  await assert.rejects(service.updateWorkflow(WS, 'wf_1', { nodes: [msg('no trigger')] }), (e) => e.status === 400);
  // A plain toggle still reports the saved steps' warnings.
  const toggled = await service.updateWorkflow(WS, 'wf_1', { isActive: false });
  assert.deepEqual(toggled.warnings, []);
});

// ── C3 / WF-EN-13 ────────────────────────────────────────────────────────────

const tpl = (name, body, status = 'APPROVED') => ({ id: `tpl_${name}`, name, status, components: [{ type: 'BODY', text: body }] });

test('C3: a template that is missing or not approved warns at save (it may be approved later)', async () => {
  templates = [tpl('pending_one', 'Hi', 'PENDING')];
  const out = await service.createWorkflow(WS, { name: 't', nodes: [kw(), { type: 'action', subtype: 'template', value: 'nope' }, { type: 'action', subtype: 'template', value: 'pending_one' }] });
  assert.ok(out.warnings.some((w) => /^Step 1: template "nope" was not found/.test(w)));
  assert.ok(out.warnings.some((w) => /^Step 2: template "pending_one" is pending/.test(w)));
});

test('C3: the number of values is checked against the template\'s placeholders', async () => {
  templates = [tpl('order_update', 'Hi {{1}}, order {{2}} ships on {{3}}')];
  const none = await service.createWorkflow(WS, { name: 't', nodes: [kw(), { type: 'action', subtype: 'template', value: 'order_update' }] });
  assert.ok(none.warnings.some((w) => /3 placeholders .* no values/.test(w)));
  const short = await service.createWorkflow(WS, { name: 't', nodes: [kw(), { type: 'action', subtype: 'template', value: 'order_update', params: ['{{name}}'] }] });
  assert.ok(short.warnings.some((w) => /gives 1 value/.test(w)));
  const ok = await service.createWorkflow(WS, { name: 't', nodes: [kw(), { type: 'action', subtype: 'template', value: 'order_update', templateId: 'tpl_order_update', params: ['a', 'b', 'c'] }] });
  assert.deepEqual(ok.warnings, []);
  assert.deepEqual(created.nodes[1].params, ['a', 'b', 'c'], 'params are stored');
});

test('WF-EN-13: a message whose text is an approved template name is flagged, not converted', async () => {
  templates = [tpl('thank_you', 'Thanks')];
  const out = await service.createWorkflow(WS, { name: 't', nodes: [kw('THANKS'), msg('thank_you')] });
  assert.ok(out.warnings.some((w) => /Step 1 sends the text "thank_you".*"Send template" step/.test(w)));
});

// ── C6 ───────────────────────────────────────────────────────────────────────

test('C6: CONVERTED, NURTURING and custom lifecycle keys save; unknown keys warn', async () => {
  lifecycle = { stages: [{ key: 'NEW', label: 'New' }, { key: 'HOT', label: 'Hot lead' }] };
  const r = workflowSchemas.create.safeParse({ name: 'Won', nodes: [{ type: 'trigger', subtype: 'lead_status', value: 'CONVERTED' }, { type: 'action', subtype: 'task', value: 'Onboard' }] });
  assert.equal(r.success, true, firstError(r));

  const known = await service.createWorkflow(WS, { name: 'ok', nodes: [{ type: 'trigger', subtype: 'lead_status', value: 'Hot lead' }, { type: 'action', subtype: 'lead_status', value: 'NURTURING' }] });
  assert.deepEqual(known.warnings, []);

  const unknown = await service.createWorkflow(WS, { name: 'bad', nodes: [{ type: 'trigger', subtype: 'lead_status', value: 'WARM' }, { type: 'action', subtype: 'lead_status', value: 'INTERESTED' }, { type: 'action', subtype: 'lead_status', value: 'CONVERTED' }] });
  assert.ok(unknown.warnings.some((w) => /trigger's lead status "WARM"/.test(w)));
  assert.ok(unknown.warnings.some((w) => /^Step 1: "INTERESTED" is not a stage/.test(w)));
  assert.ok(unknown.warnings.some((w) => /^Step 2: a lead becomes CONVERTED only by converting/.test(w)));
});

test('C6: deal stages are checked against the workspace pipeline', async () => {
  pipeline = [{ key: 'DEMO_BOOKED', label: 'Demo booked' }];
  const ok = await service.createWorkflow(WS, { name: 'ok', nodes: [{ type: 'trigger', subtype: 'deal_stage', value: 'demo booked' }, { type: 'action', subtype: 'task', value: 'x' }] });
  assert.deepEqual(ok.warnings, []);
  const bad = await service.createWorkflow(WS, { name: 'bad', nodes: [{ type: 'trigger', subtype: 'deal_stage', value: 'ALMOST_THERE' }, { type: 'action', subtype: 'task', value: 'x' }] });
  assert.ok(bad.warnings.some((w) => /deal stage "ALMOST_THERE"/.test(w)));
});

// ── WF-EN-14: overlapping keywords ───────────────────────────────────────────

test('WF-EN-14: an active keyword already used by another workflow is named at save', async () => {
  workflows = [
    { id: 'wf_old', name: 'Price list v1', isActive: true, nodes: [kw('PRICE, COST'), msg('old')] },
    { id: 'wf_off', name: 'Paused', isActive: false, nodes: [kw('PRICE'), msg('x')] },
  ];
  const out = await service.createWorkflow(WS, { name: 'Price list v2', nodes: [kw('PRICE'), msg('new')] });
  assert.ok(out.warnings.includes('"PRICE" is also used by "Price list v1" — the more specific keyword wins, and on a tie the most recently updated workflow runs.'), out.warnings.join(' | '));
  assert.ok(!out.warnings.some((w) => /Paused/.test(w)), 'inactive workflows do not compete');

  const phrase = await service.createWorkflow(WS, { name: 'Lists', nodes: [kw('PRICE LIST'), msg('x')] });
  assert.ok(phrase.warnings.some((w) => /"PRICE LIST" overlaps "PRICE" in "Price list v1"/.test(w)));

  const inactive = await service.createWorkflow(WS, { name: 'Draft', isActive: false, nodes: [kw('PRICE'), msg('x')] });
  assert.deepEqual(inactive.warnings, []);
});

// ── C1: list statistics and run paging ───────────────────────────────────────

test('C1: GET /workflows items carry all-time runCount, lastRunAt and lastRunStatus', async () => {
  workflows = [
    { id: 'wf_busy', name: 'Busy', isActive: true, nodes: [kw(), msg('x')] },
    { id: 'wf_quiet', name: 'Quiet', isActive: true, nodes: [kw('Q'), msg('x')] },
    { id: 'wf_never', name: 'Never', isActive: true, nodes: [kw('N'), msg('x')] },
  ];
  const t = (ms) => new Date(1_700_000_000_000 + ms);
  prisma.workflowRun.groupBy = async () => [
    { workflowId: 'wf_busy', _count: { _all: 25 }, _max: { startedAt: t(9) } },
    { workflowId: 'wf_quiet', _count: { _all: 5 }, _max: { startedAt: t(1) } },
  ];
  prisma.workflowRun.findMany = async ({ where }) => [
    { workflowId: 'wf_busy', status: 'COMPLETED', startedAt: t(9) },
    { workflowId: 'wf_quiet', status: 'FAILED', startedAt: t(1) },
  ].filter((r) => where.OR.some((o) => o.workflowId === r.workflowId && o.startedAt.getTime() === r.startedAt.getTime()));
  const list = await service.listWorkflows(WS);
  const by = Object.fromEntries(list.map((w) => [w.id, [w.runCount, w.lastRunAt?.getTime() ?? null, w.lastRunStatus]]));
  assert.deepEqual(by, {
    wf_busy: [25, t(9).getTime(), 'COMPLETED'],
    wf_quiet: [5, t(1).getTime(), 'FAILED'],
    wf_never: [0, null, null],
  });
});

test('C1: GET /workflows/runs pages by workflowId/limit/offset, returns an array and X-Total-Count', async () => {
  const all = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, workspaceId: WS, workflowId: i < 5 ? 'wf_quiet' : 'wf_busy', startedAt: new Date(1_000_000 - i) }));
  let args = null;
  prisma.workflowRun.findMany = async (a) => {
    args = a;
    return all.filter((r) => !a.where.workflowId || r.workflowId === a.where.workflowId).slice(a.skip ?? 0, (a.skip ?? 0) + a.take);
  };
  prisma.workflowRun.count = async ({ where }) => all.filter((r) => !where.workflowId || r.workflowId === where.workflowId).length;
  const res = { headers: {}, body: null, set(k, v) { this.headers[k] = v; return this; }, json(b) { this.body = b; return this; }, status() { return this; } };

  await controller.runs({ params: { workspaceId: WS }, query: { workflowId: 'wf_quiet' } }, res);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 5);
  assert.equal(res.headers['X-Total-Count'], '5');
  assert.equal(args.take, 20);

  await controller.runs({ params: { workspaceId: WS }, query: { limit: '500', offset: '10' } }, res);
  assert.equal(args.take, 100, 'limit is capped at 100');
  assert.equal(args.skip, 10);
  assert.equal(res.headers['X-Total-Count'], '30');
  assert.equal(res.body[0].id, 'r10');
});

// ── WF-EN-18: "Test this workflow" matches production ────────────────────────

test('WF-EN-18: a paused workflow is reported as switched off — it would not run', async () => {
  workflows = [{ id: 'wf', name: 'Paused draft', isActive: false, nodes: [kw('ORDER'), msg('Thanks')] }];
  const out = await service.simulateWorkflow(WS, 'wf', 'my ORDER');
  assert.equal(out.inactive, true);
  assert.equal(out.wouldRun, false);
  assert.match(out.reason, /switched off/);
});

test('WF-EN-18: the workflow production would actually run is reported', async () => {
  workflows = [
    { id: 'wf_me', name: 'Help (AI-built)', isActive: true, updatedAt: new Date(2), nodes: [kw('HELP, SUPPORT, PRICE, COST'), msg('How can we help?')] },
    { id: 'wf_price', name: 'Pricing (hand-built)', isActive: true, updatedAt: new Date(1), nodes: [kw('PRICE LIST'), msg('Prices')] },
  ];
  const out = await service.simulateWorkflow(WS, 'wf_me', 'can you send the price list');
  assert.equal(out.ran, true, 'the trigger itself matched');
  assert.deepEqual(out.winner, { id: 'wf_price', name: 'Pricing (hand-built)', isThisWorkflow: false });
  assert.equal(out.wouldRun, false);
  assert.match(out.reason, /answered by "Pricing \(hand-built\)"/);

  const mine = await service.simulateWorkflow(WS, 'wf_me', 'I need help');
  assert.equal(mine.winner.isThisWorkflow, true);
  assert.equal(mine.wouldRun, true);
});

test('WF-EN-18: conditions are evaluated against a named contact', async () => {
  contacts = [{ id: 'ct_vip', name: 'Asha', tags: ['VIP'] }];
  workflows = [{ id: 'wf', name: 'VIP', isActive: true, nodes: [kw('ORDER'), { type: 'condition', subtype: 'has_tag', value: 'VIP', skipIfFalse: 1 }, msg('VIP line for {{name}}')] }];
  const nobody = await service.simulateWorkflow(WS, 'wf', 'ORDER');
  assert.match(nobody.trace[1].result, /^no/);
  const vip = await service.simulateWorkflow(WS, 'wf', 'ORDER', { contactId: 'ct_vip' });
  assert.equal(vip.trace[1].result, 'yes');
  assert.equal(vip.trace[2].detail, 'Would send: "VIP line for Asha"');
  assert.deepEqual(vip.contact, { id: 'ct_vip', name: 'Asha' });
  await assert.rejects(service.simulateWorkflow(WS, 'wf', 'ORDER', { contactId: 'ct_other_ws' }), (e) => e.status === 404);
});

test('WF-EN-18: a CRM-triggered free-form step is flagged instead of "ok"', async () => {
  workflows = [{ id: 'wf', name: 'Lead', isActive: true, nodes: [{ type: 'trigger', subtype: 'lead_created', value: '' }, msg('Welcome!')] }];
  const out = await service.simulateWorkflow(WS, 'wf', 'Hi');
  assert.equal(out.trace[0].result, 'assumed fired (simulation)');
  assert.equal(out.trace[1].result, 'warning');
  assert.match(out.trace[1].detail, /only delivered if the contact messaged you in the last 24h/);

  // A contact who wrote an hour ago is inside the window.
  contacts = [{ id: 'ct_1', name: 'Asha', tags: [] }];
  conversations = [{ contactId: 'ct_1', lastInboundAt: new Date(Date.now() - 3_600_000) }];
  const recent = await service.simulateWorkflow(WS, 'wf', 'Hi', { contactId: 'ct_1' });
  assert.equal(recent.trace[1].result, 'ok');
});

test('WF-EN-18: a template step that would fail says so', async () => {
  templates = [tpl('order_update', 'Hi {{1}}, order {{2}}')];
  workflows = [{ id: 'wf', name: 'T', isActive: true, nodes: [kw('ORDER'), { type: 'action', subtype: 'template', value: 'order_update' }, { type: 'action', subtype: 'template', value: 'missing' }] }];
  const out = await service.simulateWorkflow(WS, 'wf', 'order');
  assert.equal(out.trace[1].result, 'would fail');
  assert.match(out.trace[1].detail, /no values/);
  assert.equal(out.trace[2].result, 'would fail');
  assert.match(out.trace[2].detail, /not found/);
});

test('WF-EN-18: the posted draft is tested instead of the saved steps', async () => {
  workflows = [{ id: 'wf', name: 'Saved', isActive: true, nodes: [kw('ORDER'), msg('saved text')] }];
  const out = await service.simulateWorkflow(WS, 'wf', 'order', { nodes: [kw('ORDER'), msg('draft text')] });
  assert.equal(out.draft, true);
  assert.equal(out.trace[1].detail, 'Would send: "draft text"');
  const unsaved = await service.simulateWorkflow(WS, null, 'order', { nodes: [kw('ORDER'), msg('new')] });
  assert.equal(unsaved.workflowId, null);
  assert.equal(unsaved.ran, true);
  assert.equal(unsaved.wouldRun, false, 'an unsaved draft does not run');
  const invalid = await service.simulateWorkflow(WS, null, 'order', { nodes: [msg('no trigger')] });
  assert.equal(invalid.ran, false);
  assert.match(invalid.reason, /no starting point/);
});
