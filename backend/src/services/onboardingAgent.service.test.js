import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The onboarding agent end to end, with the two edges faked: the model's
// replies are scripted and the database is an in-memory store. Everything in
// between — the blueprint checks, the repair round, apply through the real
// form / workflow / auto-reply services — is the real code.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.GEMINI_API_KEY = '';

const script = [];          // replies the model will give, in order
const prompts = [];         // what it was asked
mock.module('../lib/llm.js', {
  namedExports: {
    llmAvailable: () => true,
    llmJsonMetered: async (prompt) => {
      prompts.push(prompt);
      const data = script.shift();
      return data === undefined ? null : { data, usage: { inputTokens: 1500, outputTokens: 900, model: 'test-model' } };
    },
    llmText: async () => null,
    llmJson: async () => null,
    llmHealth: () => ({}),
    verifyGeminiKey: async () => ({ ok: true }),
    verifyGeminiModel: async () => ({ ok: true }),
    listGeminiModels: async () => ({ ok: true, models: [] }),
  },
});

const charges = [];
let available = 100;
mock.module('./aiCredits.service.js', {
  namedExports: {
    getAiCredits: async () => ({ available, remaining: available, included: 100, rate: 1, walletBalance: 0, plan: 'Test' }),
    assertAiCredits: async () => {
      if (available < 1) { const e = new Error('You are out of AI credits.'); e.status = 402; e.code = 'AI_CREDITS_EXHAUSTED'; throw e; }
    },
    chargeAiCredits: async (workspaceId, usage, meta) => { charges.push({ workspaceId, ...meta }); available -= 3; return { credits: 3 }; },
    creditsForUsage: () => 3,
    listAiCreditUsage: async () => [],
  },
});

mock.module('./subscription.service.js', {
  namedExports: {
    hasFeature: async () => true,
    getActiveSubscription: async () => ({ plan: { features: {} } }),
    assertWithinLimit: async () => {},
    consumeMessageCredit: async () => ({ ok: true }),
    releaseMessageCredit: async () => ({}),
    getPlanLimits: async () => ({}),
  },
});

const submittedTemplates = [];
mock.module('./templates.service.js', {
  namedExports: {
    createTemplate: async (workspaceId, data) => {
      const row = { id: `tpl_${submittedTemplates.length + 1}`, workspaceId, status: 'PENDING', ...data };
      submittedTemplates.push(row);
      tables.template.push(row);
      return row;
    },
    updateTemplate: async (workspaceId, id, data) => Object.assign(tables.template.find((t) => t.id === id), data),
  },
});

const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../lib/prisma.js');

for (const model of Prisma.dmmf.datamodel.models) {
  const delegate = prisma[model.name[0].toLowerCase() + model.name.slice(1)];
  if (!delegate) continue;
  Object.assign(delegate, { findMany: async () => [], findFirst: async () => null, findUnique: async () => null, count: async () => 0 });
}

// ── In-memory tables ────────────────────────────────────────────────────────
let tables;
let seq = 0;
const matches = (row, where = {}) => Object.entries(where).every(([key, want]) => {
  if (want && typeof want === 'object' && !Array.isArray(want)) {
    if ('in' in want) return want.in.includes(row[key]);
    if ('not' in want) return row[key] !== want.not;
    if ('equals' in want) return String(row[key]).toLowerCase() === String(want.equals).toLowerCase();
    return true;
  }
  return row[key] === want;
});
const applyData = (row, data) => {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value && typeof value === 'object' && 'increment' in value ? (row[key] || 0) + value.increment : value;
  }
  return row;
};
function table(name, prefix) {
  // The schema may be newer than the generated client in this checkout; a
  // delegate that is missing is created so the fake still stands in for it.
  const delegate = prisma[name] ?? (prisma[name] = {});
  Object.assign(delegate, {
    findMany: async ({ where } = {}) => structuredClone(tables[name].filter((r) => matches(r, where))),
    findFirst: async ({ where } = {}) => structuredClone(tables[name].find((r) => matches(r, where)) ?? null),
    findUnique: async ({ where }) => structuredClone(tables[name].find((r) => r.id === where.id) ?? null),
    create: async ({ data }) => {
      // Column defaults the real table would supply.
      const defaults = name === 'agentBuild' ? { status: 'DRAFT', creditsUsed: 0 } : {};
      const row = { id: `${prefix}_${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...structuredClone(data) };
      tables[name].push(row);
      return structuredClone(row);
    },
    update: async ({ where, data }) => structuredClone(applyData(tables[name].find((r) => r.id === where.id), structuredClone(data))),
    delete: async ({ where }) => { tables[name] = tables[name].filter((r) => r.id !== where.id); return null; },
  });
}
['agentBuild', 'whatsappForm', 'workflow', 'automationTrigger', 'template', 'waNumber'].forEach((n) => table(n, n.slice(0, 4)));
prisma.workspace.findUnique = async () => ({ id: 'ws_A', name: 'Asha Mushrooms' });

function reset() {
  tables = { agentBuild: [], whatsappForm: [], workflow: [], automationTrigger: [], template: [], waNumber: [] };
  script.length = 0; prompts.length = 0; charges.length = 0; submittedTemplates.length = 0;
  available = 100;
}

const agent = await import('./onboardingAgent.service.js');

// ── What the model "designs" ────────────────────────────────────────────────
const orderForm = {
  key: 'order_form', type: 'form', name: 'Mushroom order', keyword: '',
  completionMessage: 'Thanks! We will confirm your order shortly.',
  fields: [
    { label: 'Which mushrooms?', type: 'multi', options: ['Button', 'Oyster'] },
    { label: 'Delivery address?', type: 'text' },
  ],
};
const welcomeFlow = {
  key: 'welcome', type: 'workflow', name: 'Welcome menu', nodes: [
    { type: 'trigger', subtype: 'welcome' },
    { type: 'action', subtype: 'buttons', value: 'Hi {{name}}! What would you like? | Place order | Talk to us' },
    { type: 'action', subtype: 'wait_reply' },
    { type: 'condition', subtype: 'equals', value: 'Place order', skipIfFalse: 1 },
    { type: 'action', subtype: 'form', value: '@order_form' },
    { type: 'condition', subtype: 'equals', value: 'Talk to us', skipIfFalse: 1 },
    { type: 'action', subtype: 'agent' },
  ],
};
const priceReply = { key: 'price', type: 'auto_reply', keyword: 'price', response: 'Button ₹60, Oyster ₹90 per pack.' };
const design = (items, reply = 'Here is your setup.') => ({ reply, title: 'Mushroom ordering', blueprint: { summary: 'Order taking for a mushroom seller.', items } });

test('a request becomes a reviewable setup, and nothing is created until it is applied', async () => {
  reset();
  script.push(design([orderForm, welcomeFlow, priceReply]));

  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'I sell mushrooms, take orders on WhatsApp' });

  assert.equal(build.title, 'Mushroom ordering');
  assert.equal(build.status, 'DRAFT');
  assert.deepEqual(build.items.map((i) => i.type), ['form', 'workflow', 'auto_reply']);
  assert.equal(build.canApply, true);
  assert.match(build.items[1].description, /start the form "Mushroom order"/);
  assert.equal(build.creditsUsed, 3);
  assert.equal(charges[0].feature, 'onboarding_agent');
  assert.equal(charges[0].reference, build.id);
  // The model was told who it is working for.
  assert.match(prompts[0], /Asha Mushrooms/);
  // Described, not created.
  assert.equal(tables.whatsappForm.length + tables.workflow.length + tables.automationTrigger.length, 0);
});

test('apply creates connected records through the real services, and re-applying does not duplicate them', async () => {
  reset();
  script.push(design([orderForm, welcomeFlow, priceReply]));
  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'take orders' });

  const applied = await agent.applyBuild('ws_A', build.id, { activate: true });
  assert.equal(applied.failed, 0);
  assert.equal(applied.status, 'APPLIED');
  assert.equal(applied.hasUnappliedChanges, false);

  assert.equal(tables.whatsappForm.length, 1);
  assert.equal(tables.whatsappForm[0].status, 'Active');
  assert.equal(tables.whatsappForm[0].schema.length, 2);
  assert.equal(tables.automationTrigger[0].keyword, 'PRICE');
  const workflow = tables.workflow[0];
  assert.equal(workflow.isActive, true);
  // The "@order_form" reference became the form's real name.
  assert.equal(workflow.nodes.find((n) => n.subtype === 'form').value, 'Mushroom order');
  assert.equal(applied.items.every((i) => i.record?.on), true);

  await agent.applyBuild('ws_A', build.id, { activate: true });
  assert.equal(tables.whatsappForm.length, 1);
  assert.equal(tables.workflow.length, 1);
  assert.equal(tables.automationTrigger.length, 1);
});

test('"keep switched off" creates drafts, and switching on is one step', async () => {
  reset();
  script.push(design([orderForm, welcomeFlow, priceReply]));
  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'take orders' });

  await agent.applyBuild('ws_A', build.id, { activate: false });
  assert.equal(tables.whatsappForm[0].status, 'Draft');
  assert.equal(tables.workflow[0].isActive, false);
  assert.equal(tables.automationTrigger[0].isActive, false);

  const on = await agent.setLive('ws_A', build.id, true);
  assert.deepEqual(on.skipped, []);
  assert.equal(tables.whatsappForm[0].status, 'Active');
  assert.equal(tables.workflow[0].isActive, true);

  await agent.setLive('ws_A', build.id, false);
  assert.equal(tables.workflow[0].isActive, false);
  assert.equal(tables.whatsappForm.length, 1, 'switching off deletes nothing');
});

test('a hand edit after applying is marked as not created yet, then updates the same record', async () => {
  reset();
  script.push(design([orderForm, welcomeFlow, priceReply]));
  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'take orders' });
  await agent.applyBuild('ws_A', build.id, { activate: true });
  const triggerId = tables.automationTrigger[0].id;

  const edited = await agent.updateItem('ws_A', build.id, 'price', { keyword: 'PRICE', response: 'Button ₹70 per pack.' });
  assert.equal(edited.status, 'CHANGED');
  assert.equal(edited.items.find((i) => i.key === 'price').record.upToDate, false);
  assert.equal(tables.automationTrigger[0].responseTemplate, 'Button ₹60, Oyster ₹90 per pack.', 'not touched until applied');

  await agent.applyBuild('ws_A', build.id, { activate: true });
  assert.equal(tables.automationTrigger.length, 1);
  assert.equal(tables.automationTrigger[0].id, triggerId);
  assert.equal(tables.automationTrigger[0].responseTemplate, 'Button ₹70 per pack.');
});

test('an item removed after applying is switched off, not deleted', async () => {
  reset();
  script.push(design([orderForm, welcomeFlow, priceReply]));
  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'take orders' });
  await agent.applyBuild('ws_A', build.id, { activate: true });

  await agent.removeItem('ws_A', build.id, 'price');
  await agent.applyBuild('ws_A', build.id, { activate: true });
  assert.equal(tables.automationTrigger.length, 1);
  assert.equal(tables.automationTrigger[0].isActive, false);
});

test('a design whose pieces do not connect gets one repair round, then is shown but cannot be applied', async () => {
  reset();
  const clash = { key: 'order_reply', type: 'auto_reply', keyword: 'ORDER', response: 'We will call you.' };
  const keyworded = { ...orderForm, keyword: 'ORDER' };
  script.push(design([keyworded, clash]), design([keyworded, clash]));

  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'orders' });
  assert.equal(prompts.length, 2, 'the model was asked once to fix it, and not again');
  assert.match(prompts[1], /Fix every one/);
  assert.equal(build.creditsUsed, 6);
  assert.equal(build.canApply, false);
  assert.match(build.items.find((i) => i.key === 'order_reply').issues[0].message, /"ORDER" starts both/);

  await assert.rejects(agent.applyBuild('ws_A', build.id, {}), (err) => err.status === 400 && err.code === 'BLUEPRINT_INVALID');
  assert.equal(tables.whatsappForm.length, 0);
});

test('a repair that fixes the problem is the one that is kept', async () => {
  reset();
  const clash = { key: 'order_reply', type: 'auto_reply', keyword: 'ORDER', response: 'We will call you.' };
  script.push(
    design([{ ...orderForm, keyword: 'ORDER' }, clash]),
    design([{ ...orderForm, keyword: 'ORDER' }, { ...clash, keyword: 'CALLBACK' }], 'Fixed the clashing keyword.'),
  );
  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'orders' });
  assert.equal(build.canApply, true);
  assert.equal(build.messages.at(-1).text, 'Fixed the clashing keyword.');
});

test('asking for a change sends the current setup and the focused item to the model', async () => {
  reset();
  script.push(design([orderForm, welcomeFlow, priceReply]));
  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'take orders' });

  script.push(design([orderForm, welcomeFlow, { ...priceReply, response: 'Call us for prices.' }], 'Updated the price reply.'));
  const next = await agent.sendMessage('ws_A', 'u_1', build.id, { message: 'do not show prices', itemKey: 'price' });

  assert.match(prompts.at(-1), /Current blueprint:/);
  assert.match(prompts.at(-1), /item with key "price"/);
  assert.equal(next.items.find((i) => i.key === 'price').response, 'Call us for prices.');
  assert.equal(next.title, 'Mushroom ordering', 'a later turn does not rename the setup');
  assert.equal(next.messages.length, 4);
});

test('a question from the model leaves the setup as it was', async () => {
  reset();
  script.push(design([orderForm, welcomeFlow]));
  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'take orders' });
  script.push({ reply: 'Which days do you deliver?' });
  const next = await agent.sendMessage('ws_A', 'u_1', build.id, { message: 'add delivery days' });
  assert.equal(next.items.length, 2);
  assert.equal(next.messages.at(-1).text, 'Which days do you deliver?');
});

test('with no credits the model is never called', async () => {
  reset();
  available = 0;
  script.push(design([orderForm]));
  await assert.rejects(agent.createBuild('ws_A', 'u_1', { prompt: 'orders' }), (err) => err.code === 'AI_CREDITS_EXHAUSTED');
  assert.equal(prompts.length, 0);
  assert.equal(tables.agentBuild.length, 0, 'no empty setup is left in the list');
});

test('when the model does not answer nothing is charged and nothing is saved', async () => {
  reset();
  await assert.rejects(agent.createBuild('ws_A', 'u_1', { prompt: 'orders' }), (err) => err.status === 503);
  assert.equal(charges.length, 0);
  assert.equal(tables.agentBuild.length, 0);
});

test('a workflow that sends a new template stays off until Meta approves it', async () => {
  reset();
  const template = { key: 'offer', type: 'template', name: 'weekend_offer', category: 'MARKETING', body: 'Hi {{1}}, fresh stock this weekend.', examples: ['Asha'], buttons: [] };
  const flow = { key: 'lead_flow', type: 'workflow', name: 'New lead offer', nodes: [{ type: 'trigger', subtype: 'lead_created' }, { type: 'action', subtype: 'template', value: '@offer' }] };
  script.push(design([template, flow]));
  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'send new leads an offer' });

  const applied = await agent.applyBuild('ws_A', build.id, { activate: true });
  assert.equal(submittedTemplates.length, 1);
  assert.equal(submittedTemplates[0].components.find((c) => c.type === 'BODY').text, 'Hi {{1}}, fresh stock this weekend.');
  assert.equal(tables.workflow[0].isActive, false);
  assert.equal(tables.workflow[0].nodes[1].value, 'weekend_offer');
  assert.match(applied.items.find((i) => i.key === 'lead_flow').record.note, /until Meta approves/);

  const early = await agent.setLive('ws_A', build.id, true);
  assert.deepEqual(early.skipped, ['New lead offer']);
  assert.equal(tables.workflow[0].isActive, false);

  tables.template[0].status = 'APPROVED';
  const later = await agent.setLive('ws_A', build.id, true);
  assert.deepEqual(later.skipped, []);
  assert.equal(tables.workflow[0].isActive, true);
});

test('one workspace cannot open or apply another workspace\'s setup', async () => {
  reset();
  script.push(design([orderForm, welcomeFlow]));
  const build = await agent.createBuild('ws_A', 'u_1', { prompt: 'take orders' });
  await assert.rejects(agent.getBuild('ws_B', build.id), (err) => err.status === 404);
  await assert.rejects(agent.applyBuild('ws_B', build.id, {}), (err) => err.status === 404);
  assert.equal(tables.whatsappForm.length, 0);
});
