// Campaign worker lifecycle against the real database: who may continue a
// RUNNING campaign, what a Meta failure costs, and what happens to retries of
// a campaign that has already been settled. Meta, the access-token decryption
// and the queues are faked; nothing leaves the machine.
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';

const sends = [];
let metaFails = false;
const queued = [];

let prisma; let processCampaign;
let dbAvailable = false;
let workspaceId; let templateId; let waNumberId;
const stamp = Date.now();

before(async () => {
  const realMeta = await import('../lib/meta.js');
  mock.module('../lib/meta.js', {
    namedExports: {
      ...realMeta,
      sendWhatsAppMessage: async (phoneNumberId, token, to) => {
        if (metaFails) {
          const err = new Error('Request failed with status code 401');
          err.response = { data: { error: { message: 'Invalid OAuth access token', code: 190 } } };
          throw err;
        }
        sends.push(to);
        return { messages: [{ id: `wamid.${stamp}.${sends.length}` }] };
      },
    },
  });
  mock.module('../lib/encryption.js', { namedExports: { decrypt: () => 'token', encrypt: (v) => v } });
  const fakeQueue = { add: async (name, data, opts) => { queued.push({ name, data, opts }); return { id: `j${queued.length}` }; }, getJob: async () => null, getJobs: async () => [] };
  mock.module('../queues/campaign.queue.js', { namedExports: { campaignQueue: fakeQueue } });
  mock.module('../queues/email.queue.js', { namedExports: { emailQueue: fakeQueue } });

  ({ prisma } = await import('../lib/prisma.js'));
  try { await prisma.$connect(); await prisma.$queryRaw`SELECT 1`; dbAvailable = true; } catch { return; }
  process.env.CAMPAIGN_RATE_DELAY_MS = '0';
  ({ processCampaign } = await import('./campaign.worker.js'));

  const ws = await prisma.workspace.create({ data: { name: `test-worker-${stamp}`, walletBalance: 100, costPerMessage: 1 } });
  workspaceId = ws.id;
  const plan = await prisma.plan.findFirst({ where: { messageQuota: -1 } }) ?? await prisma.plan.findFirst();
  await prisma.subscription.create({
    data: { workspaceId, planId: plan.id, status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000) },
  });
  templateId = (await prisma.template.create({
    data: { workspaceId, name: `wtpl_${stamp}`, category: 'UTILITY', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi' }] },
  })).id;
  waNumberId = (await prisma.waNumber.create({
    data: { workspaceId, phoneNumber: '+10000000001', metaPhoneNumberId: `wpn${stamp}`, wabaId: 'w', encryptedAccessToken: 'x' },
  })).id;
});

after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma?.$disconnect().catch(() => {});
});

let seq = 0;
// A campaign as launchCampaign leaves it: charged for `n` recipients at 0.16.
async function chargedCampaign(n, data = {}) {
  const campaign = await prisma.campaign.create({
    data: {
      workspaceId, name: `w${stamp}_${seq}`, templateId, waNumberId, status: 'DRAFT',
      chargedAt: new Date(), costPerMessage: 0.16, totalCost: 0.16 * n, retryConfig: { enabled: false }, ...data,
    },
  });
  for (let i = 0; i < n; i += 1) {
    seq += 1;
    const contact = await prisma.contact.create({ data: { workspaceId, name: `w${seq}`, phoneNumber: `+9155${String(stamp).slice(-6)}${String(seq).padStart(2, '0')}` } });
    await prisma.campaignRecipient.create({ data: { campaignId: campaign.id, contactId: contact.id } });
  }
  return campaign;
}

test('the job that owns a RUNNING campaign may continue it; a stray duplicate may not', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const campaign = await chargedCampaign(2, { status: 'RUNNING', queueJobId: 'owner-1' });
  sends.length = 0;
  await processCampaign({ id: 'stray-9', name: 'send-campaign', data: { campaignId: campaign.id, workspaceId } });
  assert.equal(sends.length, 0);

  // The owning job redelivered after a stall/restart finishes the campaign.
  await processCampaign({ id: 'owner-1', name: 'send-campaign', data: { campaignId: campaign.id, workspaceId } });
  assert.equal(sends.length, 2);
  const done = await prisma.campaign.findUnique({ where: { id: campaign.id } });
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.refundedAt, null, 'everything was sent, nothing to refund');
});

test('a resumed campaign (resume:true) is sent', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const campaign = await chargedCampaign(1, { status: 'RUNNING', queueJobId: 'old' });
  sends.length = 0;
  await processCampaign({ id: 'new', name: 'send-campaign', data: { campaignId: campaign.id, workspaceId, resume: true } });
  assert.equal(sends.length, 1);
});

test('Meta rejecting every send fails the recipients and refunds them in full', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await prisma.workspace.update({ where: { id: workspaceId }, data: { walletBalance: 100 } });
  const campaign = await chargedCampaign(3);
  metaFails = true;
  try {
    await processCampaign({ id: 'm1', name: 'send-campaign', data: { campaignId: campaign.id, workspaceId } });
  } finally { metaFails = false; }
  const rows = await prisma.campaignRecipient.findMany({ where: { campaignId: campaign.id } });
  assert.ok(rows.every((r) => r.status === 'FAILED' && r.billedAt === null));
  assert.match(rows[0].failReason, /access token has expired/);
  const done = await prisma.campaign.findUnique({ where: { id: campaign.id } });
  assert.equal(done.status, 'COMPLETED');
  assert.equal(Number(done.refundAmount), 0.48);
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  assert.equal(Number(ws.walletBalance), 100.48);
});

test('a retry for a campaign that already failed is closed off, not sent for free', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const campaign = await chargedCampaign(1, { status: 'FAILED', refundedAt: new Date() });
  const [recipient] = await prisma.campaignRecipient.findMany({ where: { campaignId: campaign.id } });
  await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: 'RETRYING', retryStatus: 'SCHEDULED' } });
  sends.length = 0;
  await processCampaign({ id: 'r1', name: 'retry-recipient', data: { type: 'retry', campaignId: campaign.id, workspaceId, recipientId: recipient.id, attempt: 1 } });
  assert.equal(sends.length, 0);
  const after = await prisma.campaignRecipient.findUnique({ where: { id: recipient.id } });
  assert.equal(after.status, 'FAILED');
  assert.equal(after.billingStatus, 'NOT_CHARGED');
});
