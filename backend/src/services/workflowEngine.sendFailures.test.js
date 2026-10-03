import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// What a workflow run records when a send is refused, through the REAL
// outbound.service (opt-out, 24h window, metering) — only billing and Meta are
// replaced. The run used to record every refusal as "Meta rejected the send or
// 24-hour customer window is closed", and an automated send refused for credit
// told nobody in the workspace (WF-EN-3, WF-EN-4).
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

let credit = { ok: true, source: 'QUOTA' };
const noop = async () => {};
mock.module('./subscription.service.js', {
  namedExports: {
    consumeMessageCredit: async () => credit,
    releaseMessageCredit: noop,
    getActiveSubscription: noop, assertWithinLimit: noop, assertContactCapacity: noop, hasContactCapacity: noop,
    hasFeature: noop, getPlanLimits: noop, listPlans: noop, createCheckoutOrder: noop, verifyCheckoutPayment: noop,
    applyCheckoutPayment: noop, renewalCharge: () => null, scheduleSubscriptionChange: noop, retryPastDueRenewal: noop,
    renewSubscriptionNow: noop, runBillingCycleSweep: noop,
  },
});
const metaSends = [];
mock.module('../lib/meta.js', {
  namedExports: {
    sendTextMessage: async (pn, token, to, body) => { metaSends.push(body); return { messages: [{ id: `wamid.${metaSends.length}` }] }; },
    sendButtonMessage: async () => ({ messages: [{ id: 'x' }] }),
    sendListMessage: async () => ({ messages: [{ id: 'x' }] }),
    INTERACTIVE_LIMITS: { buttonCount: 3, rowCount: 10, buttonTitleChars: 20, rowTitleChars: 24 },
  },
});
mock.module('../queues/workflow.queue.js', {
  namedExports: { enqueueWorkflowResume: noop, enqueueReplyReminder: noop },
});

const { prisma } = await import('../lib/prisma.js');
const { encrypt } = await import('../lib/encryption.js');
const engine = await import('./workflowEngine.service.js');
const { __resetCreditNotices } = await import('./outbound.service.js');
const { updateManyRuns } = await import('./workflowRunStore.testutil.js');

const WS = 'ws_out';
const contact = { id: 'ct_1', name: 'Asha', phoneNumber: '+919800000000', tags: [], createdAt: new Date(0) };
let lastInboundAt = new Date();
let optedOut = false;
const notifications = [];
prisma.conversation.findUnique = async () => ({
  id: 'conv_1', waNumberId: 'wa_1', contactId: contact.id, contact, humanHandoffAt: null, channel: 'WHATSAPP', lastInboundAt,
});
prisma.conversation.update = async () => ({});
prisma.message.create = async ({ data }) => ({ id: 'm1', ...data });
prisma.waNumber.findUnique = async () => ({ id: 'wa_1', workspaceId: WS, metaPhoneNumberId: 'pn', encryptedAccessToken: encrypt('tok') });
prisma.optOut.findUnique = async () => (optedOut ? { active: true } : null);
prisma.contact.findFirst = async () => null;
prisma.template.findFirst = async () => null;
prisma.notification.findFirst = async ({ where }) => notifications
  .find((n) => n.workspaceId === where.workspaceId && n.type === where.type && n.createdAt >= where.createdAt.gte) ?? null;
prisma.notification.create = async ({ data }) => { const n = { id: `n${notifications.length + 1}`, createdAt: new Date(), ...data }; notifications.push(n); return n; };
const runs = new Map();
prisma.workflowRun.create = async ({ data }) => {
  const run = { id: `run_${runs.size + 1}`, startedAt: new Date(), variables: null, version: 0, resumeAt: null, ...structuredClone(data) };
  runs.set(run.id, run);
  return structuredClone(run);
};
prisma.workflowRun.findUnique = async ({ where }) => structuredClone(runs.get(where.id));
prisma.workflowRun.updateMany = async (args) => updateManyRuns(() => runs.values(), args);

const start = () => engine.startRun(
  { id: 'wf', name: 'x', nodes: [{ type: 'trigger', subtype: 'keyword', value: 'hi' }, { type: 'action', subtype: 'message', value: 'Hello!' }] },
  { workspaceId: WS, conversationId: 'conv_1', contactId: contact.id, triggerMessage: 'hi' },
);
const quiet = async (fn) => {
  const saved = [console.log, console.warn, console.error];
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { [console.log, console.warn, console.error] = saved; }
};
const reset = () => {
  credit = { ok: true, source: 'QUOTA' }; optedOut = false; lastInboundAt = new Date();
  notifications.length = 0; metaSends.length = 0; __resetCreditNotices();
};

test('quota exhausted: the run error names the quota and wallet, not Meta or the window', async () => {
  reset();
  credit = { ok: false, code: 'QUOTA_AND_WALLET_EXHAUSTED' };
  const run = await quiet(start);
  assert.equal(run.status, 'FAILED');
  assert.match(run.error, /quota and wallet balance are exhausted/);
  assert.doesNotMatch(run.error, /Meta rejected|24-hour/);
  assert.equal(metaSends.length, 0);
});

test('WF-EN-4: the first credit refusal raises one workspace notification; later ones are quiet', async () => {
  reset();
  credit = { ok: false, code: 'QUOTA_AND_WALLET_EXHAUSTED' };
  await quiet(start);
  await quiet(start);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].workspaceId, WS);
  assert.equal(notifications[0].title, 'Automated replies are paused: message quota and wallet are empty — top up');
  // Another process may have raised it already: the stored notice is respected.
  __resetCreditNotices();
  await quiet(start);
  assert.equal(notifications.length, 1);
});

test('an inactive subscription is named as such', async () => {
  reset();
  credit = { ok: false, code: 'SUBSCRIPTION_INACTIVE' };
  const run = await quiet(start);
  assert.match(run.error, /subscription is not active/);
  assert.match(notifications[0]?.title ?? '', /subscription is not active/);
});

test('opted-out contact: the run error says the contact opted out', async () => {
  reset();
  optedOut = true;
  const run = await quiet(start);
  assert.match(run.error, /opted out/);
  assert.equal(notifications.length, 0, 'not a billing problem');
});

test('closed window: the run error says the 24-hour window is closed and a template is needed', async () => {
  reset();
  lastInboundAt = new Date(Date.now() - 30 * 3_600_000);
  const run = await quiet(start);
  assert.match(run.error, /24-hour customer service window is closed/);
  assert.match(run.error, /template/);
});

test('a delivered send completes the run', async () => {
  reset();
  const run = await quiet(start);
  assert.equal(run.status, 'COMPLETED');
  assert.deepEqual(metaSends, ['Hello!']);
});
