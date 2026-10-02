import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The onboarding chat runs outside /workspaces/:workspaceId, so the usual
// workspaceContext/authorize guards never see it. These tests drive the real
// handler against an in-memory prisma and stubbed services to check the role
// gates, the delete confirmation and that writes go through the services.

const calls = { createTemplate: [], deleteTemplate: [], createCampaign: [] };

mock.module('../lib/llm.js', {
  namedExports: {
    llmAvailable: () => false,
    llmText: async () => null,
    llmJson: async () => null,
  },
});
mock.module('../services/subscription.service.js', {
  namedExports: { hasFeature: async () => true },
});
mock.module('../services/templateAi.service.js', {
  namedExports: {
    generateTemplateDraft: async () => ({
      name: 'sale_blast', category: 'MARKETING', language: 'en_US',
      body: 'Hi {{1}}, our sale is live.', variables: [{ example: 'Asha' }],
    }),
  },
});
mock.module('../services/templates.service.js', {
  namedExports: {
    createTemplate: async (workspaceId, data) => {
      calls.createTemplate.push({ workspaceId, data });
      return { id: 'tpl_new', name: data.name };
    },
    deleteTemplate: async (workspaceId, id) => { calls.deleteTemplate.push({ workspaceId, id }); },
  },
});
mock.module('../services/campaigns.service.js', {
  namedExports: {
    createCampaign: async (workspaceId, data, user) => {
      calls.createCampaign.push({ workspaceId, data, user });
      if (data.name === 'over limit') {
        const e = new Error('Your plan allows up to 1 campaigns.'); e.status = 403; throw e;
      }
      return { id: 'camp_new', name: data.name };
    },
  },
});
mock.module('../services/workflow.service.js', {
  namedExports: { createWorkflow: async () => { throw new Error('not expected'); } },
});

const { prisma } = await import('../lib/prisma.js');
const { chatWithAi, canCreateFromChat, canDeleteFromChat, workspaceBlockReason } = await import('./onboarding.controller.js');

const WS = 'ws_onb';
let member;
let session;
let templates;
let campaigns;
let deletedCampaignIds;

prisma.workspaceMember.findUnique = async () => member;
prisma.aiSession.findFirst = async () => session;
prisma.aiSession.create = async ({ data }) => { session = { id: 'sess_1', ...data }; return session; };
prisma.aiSession.update = async ({ data }) => { session = { ...session, ...data }; return session; };
prisma.waNumber.count = async () => 1;
prisma.waNumber.findFirst = async () => ({ id: 'wa_1' });
prisma.template.update = async () => ({});
prisma.campaign.update = async () => ({});
const nameMatches = (name, filter) => {
  if (filter.equals !== undefined) return name.toLowerCase() === filter.equals.toLowerCase();
  if (filter.contains !== undefined) return name.toLowerCase().includes(filter.contains.toLowerCase());
  return true;
};
prisma.template.findMany = async ({ where }) => templates
  .filter((t) => t.workspaceId === where.workspaceId && t.status !== 'DELETED')
  .filter((t) => !where.name || nameMatches(t.name, where.name));
prisma.template.findFirst = async (args) => (await prisma.template.findMany(args))[0] ?? null;
prisma.campaign.findMany = async ({ where }) => campaigns
  .filter((c) => c.workspaceId === where.workspaceId && (!where.name || nameMatches(c.name, where.name)));
prisma.campaign.deleteMany = async ({ where }) => {
  const hit = campaigns.find((c) => c.id === where.id && c.workspaceId === where.workspaceId && c.status === where.status);
  if (hit) deletedCampaignIds.push(hit.id);
  return { count: hit ? 1 : 0 };
};

const reset = (role) => {
  member = { role, workspace: { suspended: false, subscription: { status: 'ACTIVE' } } };
  session = null;
  templates = [
    { id: 'tpl_promo', workspaceId: WS, name: 'promo_offer', status: 'APPROVED', category: 'MARKETING', components: [], waNumberId: 'wa_1' },
    { id: 'tpl_a', workspaceId: WS, name: 'a_reminder', status: 'APPROVED', category: 'UTILITY', components: [], waNumberId: 'wa_1' },
  ];
  campaigns = [
    { id: 'camp_draft', workspaceId: WS, name: 'Draft blast', status: 'DRAFT' },
    { id: 'camp_live', workspaceId: WS, name: 'Live blast', status: 'RUNNING' },
  ];
  deletedCampaignIds = [];
  for (const k of Object.keys(calls)) calls[k].length = 0;
};

async function say(message, { guided = true, user = {} } = {}) {
  const out = { status: 200, body: null };
  const res = {
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
  await chatWithAi({ body: { message, workspaceId: WS, guided }, user: { id: 'u1', ...user } }, res);
  return out;
}

test('role helpers: create needs CLIENT+, delete needs ADMIN', () => {
  assert.equal(canCreateFromChat('VIEWER'), false);
  assert.equal(canCreateFromChat('AGENT'), false);
  assert.equal(canCreateFromChat('CLIENT'), true);
  assert.equal(canDeleteFromChat('CLIENT'), false);
  assert.equal(canDeleteFromChat('ADMIN'), true);
  assert.equal(workspaceBlockReason({ suspended: true }, {}) !== null, true);
  assert.equal(workspaceBlockReason({ suspended: true }, { superAdmin: true }), null);
  assert.equal(workspaceBlockReason({ subscription: { status: 'EXPIRED' } }, {}) !== null, true);
});

test('a VIEWER cannot start a template or delete flow', async () => {
  reset('VIEWER');
  const created = await say('create a template for our sale');
  assert.match(created.body.content, /can't create/);
  assert.equal(session.state.step, 'IDLE');

  const del = await say('delete a template');
  assert.match(del.body.content, /Only workspace admins/);
  assert.equal(session.state.step, 'IDLE');
  assert.equal(calls.deleteTemplate.length, 0);
});

test('a CLIENT cannot delete; a flow left mid-way is refused after a demotion', async () => {
  reset('CLIENT');
  const del = await say('delete campaign');
  assert.match(del.body.content, /Only workspace admins/);

  reset('ADMIN');
  await say('delete a template');
  assert.equal(session.state.step, 'DELETE_GATHER_TEMPLATE_NAME');
  member.role = 'CLIENT';
  const next = await say('promo_offer');
  assert.match(next.body.content, /Only workspace admins/);
  assert.equal(calls.deleteTemplate.length, 0);
});

test('suspended workspace is refused', async () => {
  reset('ADMIN');
  member.workspace.suspended = true;
  const out = await say('create a template');
  assert.equal(out.status, 403);
});

test('template delete needs an exact name and a confirmation turn, and uses the service', async () => {
  reset('ADMIN');
  await say('delete a template');
  const partial = await say('a');
  assert.match(partial.body.content, /No template named exactly/);
  assert.equal(calls.deleteTemplate.length, 0);

  await say('delete a template');
  const asked = await say('PROMO_OFFER');
  assert.match(asked.body.content, /Type DELETE to confirm/);
  assert.equal(calls.deleteTemplate.length, 0);
  await say('DELETE');
  assert.deepEqual(calls.deleteTemplate, [{ workspaceId: WS, id: 'tpl_promo' }]);

  await say('delete a template');
  await say('promo_offer');
  const declined = await say('no');
  assert.match(declined.body.content, /nothing was deleted/);
  assert.equal(calls.deleteTemplate.length, 1);
});

test('only draft campaigns can be deleted from chat', async () => {
  reset('ADMIN');
  await say('delete a campaign');
  const live = await say('Live blast');
  assert.match(live.body.content, /can't be deleted here/);
  assert.equal(session.state.step, 'IDLE');

  await say('delete a campaign');
  await say('draft blast');
  await say('delete');
  assert.deepEqual(deletedCampaignIds, ['camp_draft']);
});

test('campaign creation goes through campaigns.service and surfaces its errors', async () => {
  reset('CLIENT');
  const ok = await say('create a campaign for promo offer', { guided: false });
  assert.equal(calls.createCampaign.length, 1);
  assert.equal(calls.createCampaign[0].data.templateId, 'tpl_promo');
  assert.equal(calls.createCampaign[0].data.numberId, 'wa_1');
  assert.equal(ok.body.card?.title, 'Campaign Drafted');

  await say('create a campaign');
  await say('over limit');
  const refused = await say('promo_offer');
  assert.match(refused.body.content, /couldn't create that campaign: Your plan allows/);
  assert.equal(refused.body.card, null);
});

test('template creation is validated and goes through templates.service', async () => {
  reset('CLIENT');
  const out = await say('create a template for our sale', { guided: false });
  assert.equal(calls.createTemplate.length, 1);
  assert.equal(calls.createTemplate[0].data.name, 'sale_blast');
  assert.equal(calls.createTemplate[0].data.waNumberId, 'wa_1');
  assert.equal(out.body.card.title, 'Template Submitted');

  // Name that fails the same Zod schema the REST route uses never reaches the service.
  reset('CLIENT');
  await say('create a template');
  await say('!!!');
  session.state.templateName = 'Bad Name';
  const bad = await say('Hi {{1}}, thanks for your order.');
  assert.equal(calls.createTemplate.length, 0);
  assert.match(bad.body.content, /couldn't save that template/);
});
