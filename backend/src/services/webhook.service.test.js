import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Inbound webhook processing against an in-memory database: campaign reply
// attribution and delivery-status precedence. The Meta send and the queues are
// faked, and the database URL points at a closed port so a query this file
// forgot to stub fails loudly instead of reaching a real database.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';

const sent = [];
mock.module('./outbound.service.js', {
  namedExports: {
    sendAutomatedReply: async (args) => { sent.push(args); return { id: `out_${sent.length}` }; },
    markNumberUnreachable: async () => {},
  },
});
mock.module('../queues/workflow.queue.js', {
  namedExports: {
    workflowQueue: {},
    enqueueWorkflowResume: async () => {},
    enqueueReplyReminder: async () => {},
    enqueueDelayedResponseCheck: async () => {},
  },
});
// The media step (download, archive, transcription) is its own unit
// (inboundMedia.service.test.js); here only its outcome matters.
let mediaOutcome = { transcript: null };
const mediaCalls = [];
mock.module('./inboundMedia.service.js', {
  namedExports: {
    processInboundMedia: async (args) => { mediaCalls.push(args); return mediaOutcome; },
  },
});
const failures = [];
mock.module('./retry.service.js', {
  namedExports: {
    handleRecipientFailure: async (campaign, recipient, reason) => { failures.push({ recipient, reason }); },
  },
});

const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../lib/prisma.js');

let db;
let triggers = [];
let seq = 0;
const id = (p) => `${p}_${++seq}`;
const clone = (v) => (v == null ? v : structuredClone(v));

function resetDb() {
  db = {
    waNumbers: [{ id: 'wa_A', workspaceId: 'ws_A', metaPhoneNumberId: 'PN_A', phoneNumber: '+10000000001' }],
    contacts: [],
    conversations: [],
    messages: [],
    recipients: [],
    campaigns: [],
    recipientQueries: [],
  };
  sent.length = 0;
  failures.length = 0;
  mediaCalls.length = 0;
  mediaOutcome = { transcript: null };
  triggers = [];
}

function applyData(target, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) target[key] = (target[key] ?? 0) + value.increment;
    else target[key] = value;
  }
  return target;
}

// Matches the subset of Prisma `where` the status handler uses on recipients.
function recipientMatches(r, where) {
  for (const [key, want] of Object.entries(where)) {
    if (want && typeof want === 'object' && Array.isArray(want.in)) {
      if (!want.in.includes(r[key])) return false;
    } else if (r[key] !== want) return false;
  }
  return true;
}

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

prisma.waNumber.findFirst = async ({ where }) => clone(db.waNumbers.find((n) => n.metaPhoneNumberId === where.metaPhoneNumberId) ?? null);
prisma.workspace.findUnique = async () => ({ id: 'ws_A', aiAgentEnabled: false, autoWelcomeEnabled: false, escalationRules: {} });
prisma.contact.findFirst = async ({ where }) => {
  const phones = (where.OR ?? []).map((o) => o.phoneNumber);
  return clone(db.contacts.find((c) => c.workspaceId === where.workspaceId && phones.includes(c.phoneNumber)) ?? null);
};
prisma.contact.findMany = async ({ where }) => clone(db.contacts.filter((c) => c.workspaceId === where.workspaceId
  && String(c.phoneNumber).includes(where.phoneNumber?.contains ?? '')));
prisma.contact.create = async ({ data }) => {
  const row = { id: id('ct'), tags: [], ...data };
  db.contacts.push(row);
  return clone(row);
};
prisma.conversation.findFirst = async ({ where }) => clone(db.conversations.find((c) => c.workspaceId === where.workspaceId
  && c.contactId === where.contactId && c.waNumberId === where.waNumberId) ?? null);
prisma.conversation.create = async ({ data }) => {
  const row = { id: id('conv'), humanHandoffAt: null, unreadCount: 0, ...data };
  db.conversations.push(row);
  return clone(row);
};
prisma.conversation.update = async ({ where, data }) => clone(applyData(db.conversations.find((c) => c.id === where.id), data));
prisma.message.create = async ({ data }) => {
  if (data.metaMessageId && db.messages.some((m) => m.metaMessageId === data.metaMessageId)) {
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  }
  const row = { id: id('msg'), ...data };
  db.messages.push(row);
  return clone(row);
};
prisma.message.findUnique = async ({ where }) => {
  const m = db.messages.find((x) => x.metaMessageId === where.metaMessageId);
  return m ? { ...clone(m), conversation: { workspaceId: 'ws_A' } } : null;
};
prisma.message.update = async ({ where, data }) => clone(applyData(db.messages.find((m) => m.id === where.id), data));
prisma.message.updateMany = async ({ where, data }) => {
  const rows = db.messages.filter((m) => recipientMatches(m, where));
  rows.forEach((m) => applyData(m, data));
  return { count: rows.length };
};
prisma.campaignRecipient.findFirst = async ({ where }) => {
  db.recipientQueries.push(where);
  const quoted = where.messages?.some?.metaMessageId;
  const row = db.recipients.find((r) => r.contactId === where.contactId
    && (where.id ? r.id === where.id : true)
    && (quoted ? db.messages.some((m) => m.campaignRecipientId === r.id && m.metaMessageId === quoted) : true)
    && db.campaigns.find((c) => c.id === r.campaignId)?.workspaceId === where.campaign.workspaceId);
  return row ? { id: row.id } : null;
};
prisma.campaignRecipient.findUnique = async ({ where }) => clone(db.recipients.find((r) => r.id === where.id) ?? null);
prisma.campaignRecipient.updateMany = async ({ where, data }) => {
  const rows = db.recipients.filter((r) => recipientMatches(r, where));
  rows.forEach((r) => applyData(r, data));
  return { count: rows.length };
};
prisma.automationTrigger.findMany = async () => clone(triggers);
prisma.campaign.findUnique = async ({ where }) => clone(db.campaigns.find((c) => c.id === where.id) ?? null);
prisma.campaign.update = async ({ where, data }) => clone(applyData(db.campaigns.find((c) => c.id === where.id), data));

const { processWebhook } = await import('./webhook.service.js');

const CUSTOMER = '919800000001';

function inbound(message) {
  return {
    entry: [{
      id: 'waba_1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'PN_A' },
          contacts: [{ profile: { name: 'Asha' } }],
          messages: [{ from: CUSTOMER, id: `wamid.in.${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
        },
      }],
    }],
  };
}

function statusEvent(metaMessageId, status, { errors } = {}) {
  return {
    entry: [{
      id: 'waba_1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'PN_A' },
          statuses: [{ id: metaMessageId, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: CUSTOMER, ...(errors ? { errors } : {}) }],
        },
      }],
    }],
  };
}

// A contact who received one campaign message.
function seedCampaign({ recipientStatus = 'SENT', messageStatus = 'SENT' } = {}) {
  db.contacts.push({ id: 'ct_1', workspaceId: 'ws_A', name: 'Asha', phoneNumber: CUSTOMER, tags: [] });
  db.campaigns.push({ id: 'camp_1', workspaceId: 'ws_A', waNumberId: 'wa_A', delivered: 0, read: 0, failed: 0 });
  db.recipients.push({ id: 'rcp_1', campaignId: 'camp_1', contactId: 'ct_1', status: recipientStatus, retryCount: 0, deliveredAt: null, readAt: null, failedAt: null });
  db.messages.push({ id: 'msg_out', metaMessageId: 'wamid.campaign.1', direction: 'OUTBOUND', status: messageStatus, campaignRecipientId: 'rcp_1' });
}

test.beforeEach(() => resetDb());

// ── Campaign reply attribution ──────────────────────────────────────────────

test('a quoted reply to a campaign message is attributed to its recipient', async () => {
  seedCampaign();
  await processWebhook(inbound({ type: 'text', text: { body: 'tell me more' }, context: { id: 'wamid.campaign.1' } }));

  const stored = db.messages.find((m) => m.direction === 'INBOUND');
  assert.equal(stored.campaignRecipientId, 'rcp_1');
  assert.equal(db.recipientQueries[0].campaign.workspaceId, 'ws_A');
});

test('a CTA quick-reply tap is attributed through its payload', async () => {
  seedCampaign();
  await processWebhook(inbound({ type: 'button', button: { text: 'Ask anything', payload: 'cfp_campaign_ai:rcp_1' } }));

  const stored = db.messages.find((m) => m.direction === 'INBOUND');
  assert.equal(stored.campaignRecipientId, 'rcp_1');
});

test('a plain message runs no attribution query and stays unlinked', async () => {
  seedCampaign();
  await processWebhook(inbound({ type: 'text', text: { body: 'hello there' } }));

  assert.equal(db.recipientQueries.length, 0);
  assert.equal(db.messages.find((m) => m.direction === 'INBOUND').campaignRecipientId, null);
});

test('an inbound message opens the window and reopens a closed conversation', async () => {
  seedCampaign();
  db.conversations.push({ id: 'conv_1', workspaceId: 'ws_A', contactId: 'ct_1', waNumberId: 'wa_A', status: 'CLOSED', humanHandoffAt: null, unreadCount: 0 });
  await processWebhook(inbound({ type: 'text', text: { body: 'hello again' } }));

  const conv = db.conversations[0];
  assert.equal(conv.status, 'OPEN');
  assert.ok(conv.lastInboundAt instanceof Date);
  assert.equal(conv.unreadCount, 1);
});

test('a reaction is stored but is not unread, does not reopen the thread and runs no automation', async () => {
  seedCampaign();
  db.conversations.push({ id: 'conv_1', workspaceId: 'ws_A', contactId: 'ct_1', waNumberId: 'wa_A', status: 'CLOSED', humanHandoffAt: null, unreadCount: 0 });
  await processWebhook(inbound({ type: 'reaction', reaction: { message_id: 'wamid.campaign.1', emoji: '👍' } }));

  const conv = db.conversations[0];
  assert.equal(db.messages.filter((m) => m.direction === 'INBOUND').length, 1);
  assert.equal(conv.unreadCount, 0);
  assert.equal(conv.status, 'CLOSED');
  assert.equal(sent.length, 0);
});

test('a system event does not open the reply window', async () => {
  seedCampaign();
  db.conversations.push({ id: 'conv_1', workspaceId: 'ws_A', contactId: 'ct_1', waNumberId: 'wa_A', status: 'OPEN', humanHandoffAt: null, unreadCount: 0, lastInboundAt: null });
  await processWebhook(inbound({ type: 'system', system: { body: 'User changed number' } }));

  assert.equal(db.conversations[0].lastInboundAt, null);
  assert.equal(db.conversations[0].unreadCount, 0);
});

test('a contact saved in national format is matched instead of duplicated', async () => {
  db.contacts.push({ id: 'ct_nat', workspaceId: 'ws_A', name: 'Asha', phoneNumber: '09800000001', tags: [] });
  await processWebhook(inbound({ type: 'text', text: { body: 'hi' } }));

  assert.equal(db.contacts.length, 1);
  assert.equal(db.conversations[0].contactId, 'ct_nat');
});

test('an ambiguous national-format match creates a new contact rather than guessing', async () => {
  db.contacts.push({ id: 'ct_a', workspaceId: 'ws_A', name: 'A', phoneNumber: '9800000001', tags: [] });
  db.contacts.push({ id: 'ct_b', workspaceId: 'ws_A', name: 'B', phoneNumber: '09800000001', tags: [] });
  await processWebhook(inbound({ type: 'text', text: { body: 'hi' } }));

  assert.equal(db.contacts.length, 3);
});

// ── Status precedence ───────────────────────────────────────────────────────

test('a late failed status does not move a READ message backwards', async () => {
  seedCampaign({ messageStatus: 'READ', recipientStatus: 'READ' });
  await processWebhook(statusEvent('wamid.campaign.1', 'failed', { errors: [{ code: 131026, title: 'Undeliverable' }] }));

  assert.equal(db.messages.find((m) => m.id === 'msg_out').status, 'READ');
  assert.equal(failures.length, 0);
});

test('delivered then read moves forward, and a late delivered is ignored', async () => {
  seedCampaign();
  await processWebhook(statusEvent('wamid.campaign.1', 'delivered'));
  await processWebhook(statusEvent('wamid.campaign.1', 'read'));
  await processWebhook(statusEvent('wamid.campaign.1', 'delivered'));

  assert.equal(db.messages.find((m) => m.id === 'msg_out').status, 'READ');
  const recipient = db.recipients[0];
  assert.equal(recipient.status, 'READ');
  assert.equal(db.campaigns[0].delivered, 1);
  assert.equal(db.campaigns[0].read, 1);
});

test('a late delivered/read receipt does not resurrect a recipient already moved to RETRYING or FAILED', async () => {
  seedCampaign({ recipientStatus: 'RETRYING' });
  await processWebhook(statusEvent('wamid.campaign.1', 'delivered'));
  await processWebhook(statusEvent('wamid.campaign.1', 'read'));

  assert.equal(db.recipients[0].status, 'RETRYING');
  assert.equal(db.campaigns[0].delivered, 0);
  assert.equal(db.campaigns[0].read, 0);

  resetDb();
  seedCampaign({ recipientStatus: 'FAILED' });
  await processWebhook(statusEvent('wamid.campaign.1', 'read'));
  assert.equal(db.recipients[0].status, 'FAILED');
  assert.equal(db.campaigns[0].read, 0);
});

test('a failed status on a SENT message is recorded and handed to retry handling', async () => {
  seedCampaign();
  await processWebhook(statusEvent('wamid.campaign.1', 'failed', { errors: [{ code: 131026, title: 'Undeliverable' }] }));

  assert.equal(db.messages.find((m) => m.id === 'msg_out').status, 'FAILED');
  assert.equal(failures.length, 1);
});

// ── Live updates ────────────────────────────────────────────────────────────

const { subscribeRealtime } = await import('../lib/realtimeBus.js');

test('an inbound message and a delivery receipt are pushed to the workspace\'s open screens', async () => {
  const events = [];
  const off = subscribeRealtime((e) => events.push(e));
  try {
    seedCampaign();
    db.conversations.push({ id: 'conv_1', workspaceId: 'ws_A', contactId: 'ct_1', waNumberId: 'wa_A', status: 'OPEN', humanHandoffAt: null, unreadCount: 0 });
    await processWebhook(inbound({ type: 'text', text: { body: 'hello' } }));
    await processWebhook(statusEvent('wamid.campaign.1', 'delivered'));
    // A redelivered receipt changes nothing, so it announces nothing.
    await processWebhook(statusEvent('wamid.campaign.1', 'delivered'));
  } finally {
    off();
  }

  const created = events.filter((e) => e.type === 'message.created' && e.data.direction === 'INBOUND');
  assert.equal(created.length, 1);
  assert.equal(created[0].ws, 'ws_A');
  assert.equal(created[0].data.conversationId, 'conv_1');

  const statuses = events.filter((e) => e.type === 'message.status');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].ws, 'ws_A');
  assert.deepEqual({ messageId: statuses[0].data.messageId, status: statuses[0].data.status }, { messageId: 'msg_out', status: 'DELIVERED' });
  // Ids and statuses only — never the message text.
  assert.doesNotMatch(JSON.stringify(events), /hello/);
});

// ── Voice notes (CF-224) ────────────────────────────────────────────────────

const VOICE = { type: 'audio', audio: { id: 'media_1', mime_type: 'audio/ogg; codecs=opus', voice: true } };

test('a transcribed voice note is answered by the keyword trigger its words match', async () => {
  triggers = [{ id: 'tr_1', keyword: 'PRICE', responseTemplate: 'Our prices start at 499.', isActive: true, createdAt: new Date() }];
  mediaOutcome = { transcript: 'what is the price of the blue one' };
  await processWebhook(inbound(VOICE));

  assert.equal(mediaCalls.length, 1);
  assert.equal(mediaCalls[0].parsed.type, 'AUDIO');
  assert.equal(mediaCalls[0].messageId, db.messages.find((m) => m.direction === 'INBOUND').id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, 'Our prices start at 499.');
});

test('an untranscribed voice note is not matched against keyword triggers', async () => {
  // "[voice message]" is our placeholder, not the customer's words.
  triggers = [{ id: 'tr_1', keyword: 'VOICE', responseTemplate: 'should not send', isActive: true, createdAt: new Date() }];
  mediaOutcome = { transcript: null, reason: 'not_configured' };
  await processWebhook(inbound(VOICE));

  assert.equal(mediaCalls.length, 1);
  assert.equal(sent.length, 0);
  const stored = db.messages.find((m) => m.direction === 'INBOUND');
  assert.equal(stored.type, 'AUDIO');
  assert.equal(stored.body, '[voice message]');
});

test('a text message does not touch the media step', async () => {
  await processWebhook(inbound({ type: 'text', text: { body: 'hello' } }));
  assert.equal(mediaCalls.length, 0);
});
