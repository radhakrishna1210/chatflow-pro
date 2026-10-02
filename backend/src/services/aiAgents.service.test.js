import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Runs the AI Agents studio service against an in-memory prisma, with the CRM
// services it delegates to stubbed so each test can see exactly what was
// written and for which workspace. No database is needed.

const calls = { updateLead: [], createTask: [], assign: [], escalate: [] };
let llmOn = false;
let llmReply = null;

mock.module('../lib/llm.js', {
  namedExports: {
    llmAvailable: () => llmOn,
    llmText: async () => llmReply,
    llmJson: async () => null,
  },
});
mock.module('./leads.service.js', {
  namedExports: {
    updateLead: async (workspaceId, id, updates, user) => {
      calls.updateLead.push({ workspaceId, id, updates, user });
      const lead = leads.find((l) => l.id === id && l.workspaceId === workspaceId);
      if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
      return { ...lead, ...updates };
    },
  },
});
mock.module('./tasks.service.js', {
  namedExports: {
    createTask: async (workspaceId, body, userId) => {
      calls.createTask.push({ workspaceId, body, userId });
      return { id: 'task_1', ...body };
    },
  },
});
mock.module('./leadDistribution.service.js', {
  namedExports: {
    evaluateAndAssignLead: async (workspaceId, leadId) => {
      calls.assign.push({ workspaceId, leadId });
      return { assigned: true };
    },
  },
});
mock.module('./intentRouting.service.js', {
  namedExports: {
    escalateToHuman: async (args) => { calls.escalate.push(args); },
  },
});

const { prisma } = await import('../lib/prisma.js');
const svc = await import('./aiAgents.service.js');

const WS = 'ws_mine';
const OTHER = 'ws_other';
const leads = [
  { id: 'lead_mine', workspaceId: WS, contactId: 'ct_mine' },
  { id: 'lead_other', workspaceId: OTHER, contactId: 'ct_other' },
];
const contacts = [
  { id: 'ct_mine', workspaceId: WS },
  { id: 'ct_other', workspaceId: OTHER },
];
const conversations = [
  { id: 'conv_mine', workspaceId: WS, contactId: 'ct_mine', contact: { id: 'ct_mine', name: 'Asha', phoneNumber: '+91' } },
  { id: 'conv_other', workspaceId: OTHER, contactId: 'ct_other', contact: { id: 'ct_other', name: 'Bo', phoneNumber: '+1' } },
];
let activities = [];
let savedViews = [];
let members = [];

const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
prisma.lead.findFirst = async ({ where }) => leads.find((l) => matches(l, where)) ?? null;
prisma.contact.findFirst = async ({ where }) => contacts.find((c) => matches(c, where)) ?? null;
prisma.conversation.findFirst = async ({ where }) => conversations.find((c) => matches(c, where)) ?? null;
prisma.crmActivity.create = async ({ data }) => { activities.push(data); return { id: `act_${activities.length}`, ...data }; };
prisma.savedView.findMany = async ({ where }) => savedViews.filter((v) => matches(v, where));
prisma.savedView.findFirst = async ({ where }) => savedViews.find((v) => matches(v, where)) ?? null;
prisma.savedView.create = async ({ data }) => {
  const row = { id: `sv_${savedViews.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
  savedViews.push(row);
  return row;
};
prisma.workspaceMember.findFirst = async ({ where }) => members.find((m) => matches(m, where)) ?? null;
prisma.user.findFirst = async () => { throw new Error('must never look up an arbitrary user'); };

const reset = () => {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  activities = [];
  savedViews = [];
  members = [];
  llmOn = false;
  llmReply = null;
};

const USER = { id: 'u_admin', role: 'ADMIN' };

test('crm.qualify_lead calls updateLead(workspaceId, leadId, …) and logs an activity', async () => {
  reset();
  const out = await svc.executeAction(WS, 'crm.qualify_lead', { leadId: 'lead_mine' }, USER);
  assert.equal(out.success, true);
  assert.deepEqual(calls.updateLead[0].workspaceId, WS);
  assert.deepEqual(calls.updateLead[0].id, 'lead_mine');
  assert.equal(calls.updateLead[0].updates.status, 'QUALIFIED');
  assert.equal(calls.updateLead[0].user, USER);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].contactId, 'ct_mine');
  assert.equal(activities[0].createdByUserId, 'u_admin');
});

test('crm.qualify_lead on another tenant\'s lead is a 404 and writes nothing', async () => {
  reset();
  await assert.rejects(svc.executeAction(WS, 'crm.qualify_lead', { leadId: 'lead_other' }, USER), { status: 404 });
  assert.equal(activities.length, 0);
});

test('crm.book_meeting refuses a foreign lead or contact', async () => {
  reset();
  await assert.rejects(svc.executeAction(WS, 'crm.book_meeting', { leadId: 'lead_other', note: 'x' }, USER), { status: 404 });
  await assert.rejects(svc.executeAction(WS, 'crm.book_meeting', { leadId: 'lead_mine', contactId: 'ct_other' }, USER), { status: 404 });
  assert.equal(activities.length, 0);

  const ok = await svc.executeAction(WS, 'crm.book_meeting', { leadId: 'lead_mine' }, USER);
  assert.equal(ok.activity.workspaceId, WS);
  assert.equal(ok.activity.contactId, 'ct_mine');
  assert.equal(ok.activity.type, 'MEETING');
});

test('crm.assign_rep checks the lead belongs to the workspace first', async () => {
  reset();
  await assert.rejects(svc.executeAction(WS, 'crm.assign_rep', { leadId: 'lead_other' }, USER), { status: 404 });
  assert.equal(calls.assign.length, 0);
  await svc.executeAction(WS, 'crm.assign_rep', { leadId: 'lead_mine' }, USER);
  assert.deepEqual(calls.assign, [{ workspaceId: WS, leadId: 'lead_mine' }]);
});

test('crm.create_task goes through createTask (which scopes ids) with the acting user', async () => {
  reset();
  await svc.executeAction(WS, 'crm.create_task', { leadId: 'lead_mine', assignedToUserId: 'u_rep' }, USER);
  assert.equal(calls.createTask[0].workspaceId, WS);
  assert.equal(calls.createTask[0].body.assignedToUserId, 'u_rep');
  assert.equal(calls.createTask[0].userId, 'u_admin');
});

test('crm.escalate_human really hands the conversation to a human, scoped to the workspace', async () => {
  reset();
  await assert.rejects(svc.executeAction(WS, 'crm.escalate_human', { conversationId: 'conv_other' }, USER), { status: 404 });
  await assert.rejects(svc.executeAction(WS, 'crm.escalate_human', {}, USER), { status: 400 });
  assert.equal(calls.escalate.length, 0);

  const out = await svc.executeAction(WS, 'crm.escalate_human', { contactId: 'ct_mine' }, USER);
  assert.equal(out.conversationId, 'conv_mine');
  assert.equal(calls.escalate.length, 1);
  assert.equal(calls.escalate[0].workspaceId, WS);
  assert.equal(calls.escalate[0].conversationId, 'conv_mine');
});

test('unknown action is a 400', async () => {
  reset();
  await assert.rejects(svc.executeAction(WS, 'crm.nope', {}, USER), { status: 400 });
});

test('createAgent without a user is attributed to a workspace admin, never an arbitrary user', async () => {
  reset();
  await assert.rejects(svc.createAgent(WS, null, { name: 'A' }), { status: 400 });
  assert.equal(savedViews.length, 0);

  members = [{ workspaceId: WS, role: 'ADMIN', userId: 'u_owner' }];
  await svc.createAgent(WS, null, { name: 'A' });
  assert.equal(savedViews[0].createdByUserId, 'u_owner');

  await svc.createAgent(WS, 'u_me', { name: 'B' });
  assert.equal(savedViews[1].createdByUserId, 'u_me');
});

test('listAgents returns the starter agents when none are saved', async () => {
  reset();
  const agents = await svc.listAgents(WS);
  assert.ok(agents.length >= 3);
  assert.ok(agents.every((a) => a.isDefault === true && a.systemPrompt.length > 20));
});

test('actions catalogue lists every action executeAction implements', () => {
  const ids = svc.listActions().map((a) => a.id).sort();
  assert.deepEqual(ids, ['crm.assign_rep', 'crm.book_meeting', 'crm.create_task', 'crm.escalate_human', 'crm.qualify_lead']);
});
