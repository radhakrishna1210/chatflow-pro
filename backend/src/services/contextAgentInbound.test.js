import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// A WhatsApp message arriving on a number dedicated to a context agent, end to
// end: webhook payload → inbound handler → context agent → reply. Everything is
// the real code except three edges — the database is an in-memory store, the
// Meta send is captured, and the model is a stub that records what it was
// asked — so these tests see what a customer would receive and what the model
// was actually told.
//
// The database URL points at a closed local port: a query this file forgot to
// fake fails loudly instead of reaching a real database.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';

let db;
let seq = 0;
const id = (p) => `${p}_${++seq}`;

const sent = [];
mock.module('./outbound.service.js', {
  namedExports: {
    // Stores the reply as the real sender does, so the next message's history
    // contains it.
    sendAutomatedReply: async (args) => {
      sent.push(args);
      db.messages.push({ id: id('msg'), conversationId: args.conversationId, direction: 'OUTBOUND', body: args.body, sentAt: new Date(Date.now() + sent.length) });
      return { id: `out_${sent.length}` };
    },
    markNumberUnreachable: async () => {},
  },
});

mock.module('../queues/workflow.queue.js', {
  namedExports: {
    workflowQueue: {},
    enqueueWorkflowResume: async () => {},
    enqueueReplyReminder: async () => {},
    enqueueDelayedResponseCheck: async () => { delayedChecks += 1; },
  },
});
let delayedChecks = 0;

// The model. Records every call and answers with a fixed line, or null when a
// test wants the provider to be down.
const llmCalls = [];
let llmReply = 'We are open 9am to 6pm, Monday to Saturday.';
let llmUp = true;
mock.module('../lib/llm.js', {
  namedExports: {
    llmAvailable: () => llmUp,
    llmText: async (prompt, system) => { llmCalls.push({ prompt, system }); return llmReply; },
    llmJson: async () => null,
    llmHealth: () => ({ ok: llmUp }),
    verifyGeminiKey: async () => ({ ok: true }),
  },
});

const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../lib/prisma.js');

const CONTEXT = 'Acme Clinic is open 9am to 6pm, Monday to Saturday. Consultation fee is Rs 500. Closed on Sundays.';

function resetDb() {
  db = {
    agents: [
      { id: 'ca_1', workspaceId: 'ws_A', name: 'Clinic Helper', context: CONTEXT, instructions: 'Be warm.', strictContext: true, enabled: true, waNumberId: 'wa_support' },
    ],
    waNumbers: [
      { id: 'wa_support', workspaceId: 'ws_A', metaPhoneNumberId: 'PN_SUPPORT', phoneNumber: '+10000000009', displayName: 'Acme Support' },
      { id: 'wa_main', workspaceId: 'ws_A', metaPhoneNumberId: 'PN_MAIN', phoneNumber: '+10000000001', displayName: 'Acme' },
    ],
    workspaces: {
      ws_A: {
        id: 'ws_A', name: 'Acme Clinic', aiAgentEnabled: false, escalationRules: {},
        autoWelcomeEnabled: true, welcomeMessage: 'Welcome to Acme!', autoDelayedEnabled: true, delayedAfterMinutes: 15,
      },
    },
    contacts: [],
    conversations: [],
    messages: [],
    workflows: [],
    runs: new Map(),
    optOuts: [],
    notifications: [],
  };
  sent.length = 0;
  llmCalls.length = 0;
  llmReply = 'We are open 9am to 6pm, Monday to Saturday.';
  llmUp = true;
  delayedChecks = 0;
}

const clone = (v) => (v == null ? v : structuredClone(v));
const agentForNumber = (numberId) => db.agents.find((a) => a.waNumberId === numberId) ?? null;

function applyData(target, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) target[key] = (target[key] ?? 0) + value.increment;
    else target[key] = value;
  }
  return target;
}

// Every model starts as an empty table, so code paths this file does not care
// about see "nothing here" rather than hitting the network.
for (const model of Prisma.dmmf.datamodel.models) {
  const delegate = prisma[model.name[0].toLowerCase() + model.name.slice(1)];
  if (!delegate) continue;
  Object.assign(delegate, {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    create: async ({ data }) => ({ id: id(model.name), ...data }),
    update: async ({ data }) => ({ ...data }),
    updateMany: async () => ({ count: 0 }),
    upsert: async ({ create }) => ({ id: id(model.name), ...create }),
    delete: async () => null,
    deleteMany: async () => ({ count: 0 }),
    aggregate: async () => ({}),
    groupBy: async () => [],
  });
}
prisma.$transaction = async (arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg));

// The lookup the webhook does, honouring `include: { contextAgent: true }` the
// way the database would.
prisma.waNumber.findFirst = async ({ where, include, select }) => {
  const row = db.waNumbers.find((n) => (where.metaPhoneNumberId ? n.metaPhoneNumberId === where.metaPhoneNumberId : true)
    && (where.id ? n.id === where.id : true)
    && (where.workspaceId ? n.workspaceId === where.workspaceId : true));
  if (!row) return null;
  const out = clone(row);
  if (include?.contextAgent || select?.contextAgent) out.contextAgent = clone(agentForNumber(row.id));
  return out;
};
prisma.waNumber.findUnique = async ({ where }) => clone(db.waNumbers.find((n) => n.id === where.id) ?? null);
prisma.workspace.findUnique = async ({ where }) => clone(db.workspaces[where.id] ?? null);

prisma.contextAgent.findUnique = async ({ where }) => clone(
  db.agents.find((a) => (where.waNumberId ? a.waNumberId === where.waNumberId : a.id === where.id)) ?? null,
);
prisma.contextAgent.findFirst = async ({ where }) => {
  const a = db.agents.find((x) => x.id === where.id && x.workspaceId === where.workspaceId);
  return a ? { ...clone(a), waNumber: clone(db.waNumbers.find((n) => n.id === a.waNumberId) ?? null) } : null;
};
prisma.contextAgent.update = async ({ where, data }) => {
  const a = applyData(db.agents.find((x) => x.id === where.id), data);
  return { ...clone(a), waNumber: clone(db.waNumbers.find((n) => n.id === a.waNumberId) ?? null) };
};

prisma.contact.findFirst = async ({ where }) => {
  const phones = (where.OR ?? []).map((o) => o.phoneNumber);
  return clone(db.contacts.find((c) => c.workspaceId === where.workspaceId && phones.includes(c.phoneNumber)) ?? null);
};
prisma.contact.create = async ({ data }) => {
  const row = { id: id('ct'), tags: [], createdAt: new Date(), ...data };
  db.contacts.push(row);
  return clone(row);
};
prisma.contact.findUnique = async ({ where }) => clone(db.contacts.find((c) => c.id === where.id) ?? null);

const withContact = (c) => c && { ...clone(c), contact: clone(db.contacts.find((x) => x.id === c.contactId)) };
prisma.conversation.findFirst = async ({ where }) => clone(db.conversations.find((c) => c.workspaceId === where.workspaceId
  && c.contactId === where.contactId && c.waNumberId === where.waNumberId) ?? null);
prisma.conversation.create = async ({ data }) => {
  const row = { id: id('conv'), humanHandoffAt: null, assignedToUserId: null, unreadCount: 0, ...data };
  db.conversations.push(row);
  return clone(row);
};
prisma.conversation.findUnique = async ({ where }) => withContact(db.conversations.find((c) => c.id === where.id) ?? null);
prisma.conversation.update = async ({ where, data }) => clone(applyData(db.conversations.find((c) => c.id === where.id), data));

prisma.message.create = async ({ data }) => {
  if (data.metaMessageId && db.messages.some((m) => m.metaMessageId === data.metaMessageId)) {
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  }
  const row = { id: id('msg'), createdAt: new Date(), ...data };
  db.messages.push(row);
  return clone(row);
};
prisma.message.findMany = async ({ where, take }) => clone(
  db.messages
    .filter((m) => m.conversationId === where.conversationId)
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
    .slice(0, take ?? 100),
);

prisma.workflow.findMany = async ({ where }) => clone(db.workflows.filter((w) => w.workspaceId === where.workspaceId));
prisma.workflowRun.create = async ({ data }) => {
  const run = { id: id('run'), startedAt: new Date(), ...clone(data) };
  db.runs.set(run.id, run);
  return clone(run);
};
prisma.workflowRun.findUnique = async ({ where }) => clone(db.runs.get(where.id) ?? null);
prisma.workflowRun.update = async ({ where, data }) => {
  const run = { ...db.runs.get(where.id), ...clone(data) };
  db.runs.set(where.id, run);
  return clone(run);
};

prisma.optOut.upsert = async ({ create }) => { db.optOuts.push(create); return { id: id('oo'), ...create }; };
prisma.optOut.create = async ({ data }) => { db.optOuts.push(data); return { id: id('oo'), ...data }; };
prisma.notification.create = async ({ data }) => { db.notifications.push(data); return { id: id('n'), ...data }; };

const { processWebhook } = await import('./webhook.service.js');
const contextAgents = await import('./contextAgent.service.js');
const { assertNumberNotDedicated } = await import('../lib/dedicatedNumber.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

const CUSTOMER = '919800000001';
let clock = 1_700_000_000;

function webhookFor(phoneNumberId, text) {
  return {
    entry: [{
      id: 'waba_1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: 'Asha' } }],
          messages: [{
            from: CUSTOMER,
            id: `wamid.${++seq}`,
            // Strictly increasing, so history ordering is deterministic.
            timestamp: String(++clock),
            type: 'text',
            text: { body: text },
          }],
        },
      }],
    }],
  };
}

async function customerSends(text, phoneNumberId = 'PN_SUPPORT') {
  const before = sent.length;
  await processWebhook(webhookFor(phoneNumberId, text));
  return sent.slice(before).map((s) => s.body);
}

const KEYWORD_WORKFLOW = {
  id: 'wf_1', workspaceId: 'ws_A', isActive: true, createdAt: new Date(), name: 'Hours', edges: [],
  nodes: [
    { id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'HOURS' },
    { id: 'step_2', type: 'action', subtype: 'message', value: 'Workflow says hello' },
  ],
};

test.beforeEach(() => resetDb());

// ── The agent answers on its number ─────────────────────────────────────────

test('a message on the dedicated number is answered by the context agent, from its context', async () => {
  const replies = await customerSends('what are your hours?');

  assert.deepEqual(replies, ['We are open 9am to 6pm, Monday to Saturday.']);
  assert.equal(sent[0].waNumberId, 'wa_support', 'the reply goes out from the dedicated number');

  assert.equal(llmCalls.length, 1);
  const { system, prompt } = llmCalls[0];
  assert.ok(system.includes(CONTEXT), 'the model is given the agent\'s context');
  assert.ok(system.includes('Clinic Helper'), 'and the agent\'s name');
  assert.ok(system.includes('Be warm.'), 'and its instructions');
  assert.ok(system.includes('Acme Clinic'), 'and the business it answers for');
  assert.ok(/Answer only from the context/.test(system), 'strict mode restricts it to the context');
  assert.ok(prompt.includes('what are your hours?'));

  const conversation = db.conversations[0];
  assert.equal(conversation.waNumberId, 'wa_support');
  assert.equal(db.messages.filter((m) => m.direction === 'INBOUND').length, 1, 'the message is stored for the inbox');
});

test('the conversation so far is carried into the next reply', async () => {
  await customerSends('what are your hours?');
  llmReply = 'The consultation fee is Rs 500.';
  const replies = await customerSends('and the fee?');

  assert.deepEqual(replies, ['The consultation fee is Rs 500.']);
  const { prompt } = llmCalls[1];
  assert.ok(prompt.includes('Customer: what are your hours?'), 'earlier question is in the transcript');
  assert.ok(prompt.includes('Clinic Helper: We are open 9am to 6pm'), 'and the agent\'s earlier answer');
  assert.equal(prompt.split('and the fee?').length - 1, 1, 'the message being answered appears once, not twice');
});

test('general-knowledge mode tells the model the context comes first', async () => {
  db.agents[0].strictContext = false;
  await customerSends('what is a normal body temperature?');
  const { system } = llmCalls[0];
  assert.ok(/general knowledge/.test(system));
  assert.ok(!/Answer only from the context/.test(system));
});

// ── Nothing else runs on a dedicated number ─────────────────────────────────

test('workflows, the welcome message and the delayed-response check do not run on a dedicated number', async () => {
  db.workflows.push(KEYWORD_WORKFLOW);

  const replies = await customerSends('hours');

  assert.deepEqual(replies, ['We are open 9am to 6pm, Monday to Saturday.'], 'only the agent replied');
  assert.equal(db.runs.size, 0, 'the matching workflow did not start');
  assert.ok(!replies.includes('Welcome to Acme!'), 'no welcome message, though this is a first-time contact');
  assert.equal(delayedChecks, 0, 'the delayed-response automation was not armed');
});

test('the same workspace\'s other number still runs its automations normally', async () => {
  db.workflows.push(KEYWORD_WORKFLOW);

  const replies = await customerSends('hours', 'PN_MAIN');

  assert.deepEqual(replies, ['Workflow says hello']);
  assert.equal(llmCalls.length, 0, 'the context agent was not involved');
});

test('an agent that is switched off sends nothing, and nothing else answers for it', async () => {
  db.agents[0].enabled = false;
  db.workflows.push(KEYWORD_WORKFLOW);

  const replies = await customerSends('hours');

  assert.deepEqual(replies, []);
  assert.equal(llmCalls.length, 0);
  assert.equal(db.runs.size, 0, 'the number stays reserved while the agent is off');
  assert.equal(db.messages.filter((m) => m.direction === 'INBOUND').length, 1, 'the message still reaches the inbox');
});

// ── The cases where the agent must stay quiet ───────────────────────────────

test('STOP on a dedicated number opts the customer out and the agent does not answer', async () => {
  const replies = await customerSends('STOP');

  assert.deepEqual(replies, []);
  assert.equal(llmCalls.length, 0);
});

test('a thread a person has taken over is left alone', async () => {
  await customerSends('what are your hours?');
  db.conversations[0].humanHandoffAt = new Date();

  const replies = await customerSends('are you there?');

  assert.deepEqual(replies, []);
  assert.equal(llmCalls.length, 1, 'no second model call');
});

test('asking for a human hands the thread to a person instead of answering', async () => {
  const replies = await customerSends('human');

  assert.deepEqual(replies, []);
  assert.equal(llmCalls.length, 0);
  assert.ok(db.conversations[0].humanHandoffAt, 'the conversation is flagged for a person');
});

test('a provider failure leaves the message in the inbox without seizing the thread', async () => {
  llmReply = null;

  const replies = await customerSends('what are your hours?');

  assert.deepEqual(replies, []);
  assert.equal(db.conversations[0].humanHandoffAt, null, 'not escalated — the agent answers the next message');
});

// ── Exclusivity ─────────────────────────────────────────────────────────────

test('a dedicated number is refused for other uses, and a free number is not', async () => {
  await assert.rejects(
    () => assertNumberNotDedicated('wa_support', 'campaigns'),
    (err) => err.status === 409 && err.code === 'NUMBER_DEDICATED' && /Clinic Helper/.test(err.message) && /campaigns/.test(err.message),
  );
  await assertNumberNotDedicated('wa_main', 'campaigns');
});

test('a number already serving something else cannot be dedicated to an agent', async () => {
  db.agents.push({ id: 'ca_2', workspaceId: 'ws_A', name: 'Second', context: CONTEXT, instructions: '', strictContext: true, enabled: false, waNumberId: null });
  prisma.widget.count = async ({ where }) => (where.waNumberId === 'wa_main' ? 1 : 0);

  await assert.rejects(
    () => contextAgents.updateContextAgent('ws_A', 'ca_2', { waNumberId: 'wa_main' }),
    (err) => err.status === 409 && err.code === 'NUMBER_IN_USE' && /website widget/.test(err.message),
  );
  prisma.widget.count = async () => 0;
});

test('a number held by one agent cannot be given to another', async () => {
  db.agents.push({ id: 'ca_2', workspaceId: 'ws_A', name: 'Second', context: CONTEXT, instructions: '', strictContext: true, enabled: false, waNumberId: null });

  await assert.rejects(
    () => contextAgents.updateContextAgent('ws_A', 'ca_2', { waNumberId: 'wa_support' }),
    (err) => err.status === 409 && err.code === 'NUMBER_DEDICATED' && /Clinic Helper/.test(err.message),
  );
});

test('an agent cannot be switched on without a context and a number, and losing either switches it off', async () => {
  db.agents.push({ id: 'ca_2', workspaceId: 'ws_A', name: 'Second', context: '', instructions: '', strictContext: true, enabled: false, waNumberId: null });

  await assert.rejects(() => contextAgents.updateContextAgent('ws_A', 'ca_2', { enabled: true }), /context/i);
  await assert.rejects(
    () => contextAgents.updateContextAgent('ws_A', 'ca_2', { context: CONTEXT, enabled: true }),
    /Assign a WhatsApp number/,
  );

  const on = await contextAgents.updateContextAgent('ws_A', 'ca_2', { context: CONTEXT, waNumberId: 'wa_main', enabled: true });
  assert.equal(on.enabled, true);

  const unassigned = await contextAgents.updateContextAgent('ws_A', 'ca_2', { waNumberId: null });
  assert.equal(unassigned.enabled, false, 'unassigning the number turns the agent off');
  assert.equal(unassigned.waNumberId, null);
});

test('another workspace cannot read or change this workspace\'s agent', async () => {
  await assert.rejects(
    () => contextAgents.updateContextAgent('ws_OTHER', 'ca_1', { name: 'Hijacked' }),
    (err) => err.status === 404,
  );
  assert.equal(db.agents[0].name, 'Clinic Helper');
});
