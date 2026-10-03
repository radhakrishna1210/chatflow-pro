import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Every dependency of the worker is mocked: no database, Redis or Meta.

let campaigns;
let recipients;
let calls;
let behaviour;

const pick = (row, select) => (select
  ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]))
  : row);

const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('in' in v) return v.in.includes(row[k]);
    if ('not' in v) return row[k] !== v.not;
    if ('gt' in v) return row[k] > v.gt;
    return true;
  }
  return row[k] === v;
});

const withContact = (r) => ({ ...r, contact: { id: r.contactId, phoneNumber: r.phone, name: 'Asha' } });

const prisma = {
  campaign: {
    findFirst: async ({ where }) => {
      const c = campaigns.find((x) => matches(x, where));
      return c ? { ...c } : null;
    },
    findUnique: async ({ where, select }) => {
      const c = campaigns.find((x) => x.id === where.id);
      return c ? pick(c, select) : null;
    },
    updateMany: async ({ where, data }) => {
      const hit = campaigns.filter((c) => matches(c, where));
      hit.forEach((c) => Object.assign(c, data));
      return { count: hit.length };
    },
    update: async ({ where, data }) => {
      const c = campaigns.find((x) => x.id === where.id);
      for (const [k, v] of Object.entries(data)) c[k] = v?.increment !== undefined ? (c[k] || 0) + v.increment : v;
      return c;
    },
  },
  campaignRecipient: {
    findMany: async ({ where, take, cursor, skip }) => {
      let rows = recipients.filter((r) => matches(r, where)).sort((a, b) => a.id.localeCompare(b.id));
      if (cursor) rows = rows.filter((r) => r.id > cursor.id);
      else if (skip) rows = rows.slice(skip);
      if (take) rows = rows.slice(0, take);
      return rows.map(withContact);
    },
    findUnique: async ({ where }) => {
      const r = recipients.find((x) => x.id === where.id);
      return r ? withContact(r) : null;
    },
    updateMany: async ({ where, data }) => {
      const hit = recipients.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    update: async ({ where, data }) => {
      const r = recipients.find((x) => x.id === where.id);
      Object.assign(r, data);
      return r;
    },
  },
  subscription: { findUnique: async () => ({ status: 'ACTIVE' }) },
  conversation: {
    findFirst: async () => ({ id: 'conv1' }),
    create: async () => ({ id: 'conv1' }),
  },
  message: {
    create: async () => {
      calls.messageCreate += 1;
      if (behaviour.messageCreateThrows) throw new Error('pool timeout');
      return {};
    },
  },
};

const here = (rel) => new URL(rel, import.meta.url).href;
mock.module(here('../lib/prisma.js'), { namedExports: { prisma } });
mock.module(here('../lib/redis.js'), { namedExports: { createBullConnection: () => ({}), logRedisError: () => {} } });
mock.module(here('../config/env.js'), {
  namedExports: { env: { CAMPAIGN_RATE_DELAY_MS: 0, CAMPAIGN_BATCH_SIZE: 2, CAMPAIGN_WORKER_CONCURRENCY: 1 } },
});
mock.module(here('../lib/encryption.js'), {
  namedExports: {
    decrypt: (v) => {
      if (behaviour.decryptThrows) throw new Error('bad key');
      return `plain-${v}`;
    },
  },
});
mock.module(here('../lib/meta.js'), {
  namedExports: {
    sendWhatsAppMessage: async (phoneNumberId, token, to) => {
      calls.sent.push(to);
      if (behaviour.stopAfterFirstSend) stopCampaignSends();
      if (behaviour.metaThrows) throw new Error('Meta down');
      return { messages: [{ id: `wamid.${to}` }] };
    },
  },
});
mock.module(here('../services/templatePayload.service.js'), { namedExports: { buildTemplateSendPayload: async () => ({ name: 'tpl' }) } });
mock.module(here('../lib/templateParams.js'), { namedExports: { contactVariableResolver: () => () => '' } });
mock.module(here('../services/campaignAi.service.js'), { namedExports: { campaignCtaComponent: () => null, buildCampaignContext: () => ({}) } });
mock.module(here('../services/email.service.js'), { namedExports: { queueCampaignCompletedEmail: async () => {}, queueCampaignFailedEmail: async () => {} } });
mock.module(here('../services/subscription.service.js'), {
  namedExports: {
    consumeMessageCredit: async () => { calls.consume += 1; return { ok: true, source: 'QUOTA' }; },
    releaseMessageCredit: async () => { calls.release += 1; return { released: true }; },
  },
});
mock.module(here('../services/fallback.service.js'), { namedExports: { runFallbackForRecipient: async () => null } });
mock.module(here('../services/retry.service.js'), {
  namedExports: {
    handleRecipientFailure: async (campaign, recipient, reason) => {
      calls.failures.push({ id: recipient.id, reason });
      if (behaviour.failureHandlingThrows) throw new Error('db gone');
      const r = recipients.find((x) => x.id === recipient.id);
      Object.assign(r, { status: 'RETRYING', retryStatus: 'SCHEDULED' });
    },
    checkAndCompleteCampaign: async (id) => { calls.completed.push(id); return true; },
    notifyRetrySucceeded: async () => {},
  },
});
mock.module(here('../services/campaigns.service.js'), { namedExports: { settleCampaignRefund: async (id) => { calls.settled.push(id); } } });
mock.module(here('../services/campaignBilling.service.js'), {
  namedExports: {
    claimRecipientCharge: async (c, r) => { calls.charged.push(r.id); return { billed: true }; },
    markRecipientNotCharged: async () => {},
    recordAttempt: async () => {},
  },
});
mock.module(here('../services/optout.service.js'), { namedExports: { isOptedOut: async () => false } });
mock.module(here('../services/notification.service.js'), { namedExports: { notifyWorkspace: async () => {} } });
mock.module(here('../authentication/authentication.service.js'), { namedExports: { sendAuthenticationOtp: async () => ({ metaMessageId: 'otp' }) } });

mock.module(here('../queues/campaign.queue.js'), {
  namedExports: { campaignQueue: { add: async (name, data, opts) => { calls.queued.push({ name, data, opts }); return { id: opts?.jobId }; } } },
});

const { processCampaign, stopCampaignSends } = await import('./campaign.worker.js');

const sendJob = (data = {}, id = 'job1') => ({ id, name: 'send-campaign', data: { campaignId: 'c1', workspaceId: 'w1', ...data } });
const retryJob = (recipientId, attempt = 1) => ({
  id: `retry:${recipientId}:${attempt}`, name: 'retry-recipient',
  data: { type: 'retry', campaignId: 'c1', workspaceId: 'w1', recipientId, attempt },
});

beforeEach(() => {
  campaigns = [{
    id: 'c1', workspaceId: 'w1', name: 'Diwali', status: 'DRAFT', chargedAt: new Date(), queueJobId: 'job1',
    templateId: 't1', template: { id: 't1', category: 'MARKETING', components: [] },
    waNumberId: 'n1', waNumber: { id: 'n1', metaPhoneNumberId: 'PN', encryptedAccessToken: 'tok' },
  }];
  recipients = [
    { id: 'r1', campaignId: 'c1', contactId: 'k1', phone: '+911111111111', status: 'PENDING', sentAt: null },
    { id: 'r2', campaignId: 'c1', contactId: 'k2', phone: '+912222222222', status: 'PENDING', sentAt: null },
    { id: 'r3', campaignId: 'c1', contactId: 'k3', phone: '+913333333333', status: 'PENDING', sentAt: null },
  ];
  calls = { sent: [], failures: [], completed: [], settled: [], charged: [], consume: 0, release: 0, messageCreate: 0, queued: [] };
  behaviour = {};
});

test('a launch sends every pending recipient and completes', async () => {
  await processCampaign(sendJob());
  assert.equal(calls.sent.length, 3);
  assert.ok(recipients.every((r) => r.status === 'SENT'));
  assert.deepEqual(calls.completed, ['c1']);
});

test('a prepaid campaign never meters quota or wallet per send', async () => {
  await processCampaign(sendJob());
  assert.equal(calls.consume, 0);
});

test('a bookkeeping failure after Meta accepted the message never schedules a retry', async () => {
  behaviour.messageCreateThrows = true;
  await processCampaign(sendJob());
  assert.equal(calls.sent.length, 3);
  assert.equal(calls.failures.length, 0, 'no recipient may be routed to failure handling');
  assert.equal(calls.release, 0, 'no credit is handed back for a delivered message');
  assert.deepEqual(calls.charged, ['r1', 'r2', 'r3']);
  assert.ok(recipients.every((r) => r.status === 'SENT'));
});

test('a failed Meta send goes to failure handling', async () => {
  behaviour.metaThrows = true;
  await processCampaign(sendJob());
  assert.equal(calls.failures.length, 3);
  assert.ok(recipients.every((r) => r.status === 'RETRYING'));
});

test('if failure handling itself throws, the row is handed back to PENDING, never left SENDING', async () => {
  behaviour.metaThrows = true;
  behaviour.failureHandlingThrows = true;
  await processCampaign(sendJob());
  assert.ok(recipients.every((r) => r.status === 'PENDING'));
});

test('a resume job re-enters a RUNNING campaign and sends what is left', async () => {
  campaigns[0].status = 'RUNNING';
  campaigns[0].queueJobId = 'someOtherJob';
  recipients[0].status = 'SENT';
  await processCampaign(sendJob({ resume: true }, 'resumeJob'));
  assert.deepEqual(calls.sent, ['912222222222', '913333333333']);
});

test('a redelivery of the job that owns the campaign carries on instead of returning "success"', async () => {
  campaigns[0].status = 'RUNNING';
  await processCampaign(sendJob({}, 'job1'));
  assert.equal(calls.sent.length, 3);
});

test('an unrelated second job for a RUNNING campaign is refused', async () => {
  campaigns[0].status = 'RUNNING';
  await processCampaign(sendJob({}, 'duplicate'));
  assert.equal(calls.sent.length, 0);
});

test('an unreadable access token fails the campaign and settles it instead of retrying silently', async () => {
  behaviour.decryptThrows = true;
  await processCampaign(sendJob());
  assert.equal(campaigns[0].status, 'FAILED');
  assert.deepEqual(calls.settled, ['c1']);
});

test('retry: a throw after the claim releases the recipient through failure handling', async () => {
  campaigns[0].status = 'RUNNING';
  recipients[0].status = 'RETRYING';
  recipients[0].retryStatus = 'SCHEDULED';
  behaviour.decryptThrows = true;
  await processCampaign(retryJob('r1'));
  assert.equal(calls.failures.length, 1);
  assert.notEqual(recipients[0].retryStatus, 'IN_PROGRESS');
});

test('retry: if failure handling throws too, the claim is handed back as SCHEDULED', async () => {
  campaigns[0].status = 'RUNNING';
  recipients[0].status = 'RETRYING';
  recipients[0].retryStatus = 'SCHEDULED';
  behaviour.metaThrows = true;
  behaviour.failureHandlingThrows = true;
  await processCampaign(retryJob('r1'));
  assert.equal(recipients[0].retryStatus, 'SCHEDULED');
});

test('retry: a paused (non-OTP) campaign sends nothing and leaves the row RETRYING for resume', async () => {
  campaigns[0].status = 'PAUSED';
  recipients[0].status = 'RETRYING';
  recipients[0].retryStatus = 'SCHEDULED';
  await processCampaign(retryJob('r1'));
  assert.equal(calls.sent.length, 0);
  assert.equal(recipients[0].status, 'RETRYING');
  assert.equal(recipients[0].retryStatus, 'SCHEDULED');
});

test('retry: bookkeeping failure after Meta accepted the retry does not reschedule it', async () => {
  campaigns[0].status = 'RUNNING';
  recipients[0].status = 'RETRYING';
  recipients[0].retryStatus = 'SCHEDULED';
  behaviour.messageCreateThrows = true;
  await processCampaign(retryJob('r1'));
  assert.equal(calls.failures.length, 0);
  assert.equal(recipients[0].status, 'SENT');
  assert.equal(recipients[0].retryStatus, 'SUCCESS');
});

// Last on purpose: once raised, the shutdown flag stays up for this process.
test('shutdown: the send loop stops after the recipient in flight and hands the rest to a resume job', async () => {
  campaigns[0].status = 'RUNNING';
  // A claim left by this run that never reached Meta is released too.
  recipients.push({ id: 'r0', campaignId: 'c1', contactId: 'k0', phone: '+910000000000', status: 'SENDING', sentAt: null });
  behaviour.stopAfterFirstSend = true;

  await processCampaign(sendJob({ resume: true }));

  assert.equal(calls.sent.length, 1, 'only the recipient in flight was sent');
  assert.equal(recipients.find((r) => r.id === 'r1').status, 'SENT');
  assert.deepEqual(recipients.filter((r) => r.status === 'PENDING').map((r) => r.id).sort(), ['r0', 'r2', 'r3']);
  assert.equal(calls.completed.length, 0, 'an interrupted campaign is not completed');
  assert.equal(campaigns[0].status, 'RUNNING');
  assert.equal(calls.queued.length, 1);
  assert.deepEqual(calls.queued[0].data, { campaignId: 'c1', workspaceId: 'w1', resume: true });
  assert.equal(campaigns[0].queueJobId, calls.queued[0].opts.jobId, 'the resume job is recorded so recovery does not queue another');
});

test('shutdown: a campaign that is no longer owned by this job is not re-queued', async () => {
  campaigns[0].status = 'RUNNING';
  campaigns[0].queueJobId = 'someone-else';
  await processCampaign(sendJob({ resume: true }));
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.queued.length, 0);
  assert.ok(recipients.every((r) => r.status === 'PENDING'));
});
