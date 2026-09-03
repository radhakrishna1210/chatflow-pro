import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { createLeadFromReply, findAttributableCampaign } from './campaignLeads.service.js';

let dbAvailable = false;
let workspaceId;
let templateId;
let seq = 0;

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const makeContact = async (name) => prisma.contact.create({
  data: { workspaceId, name, phoneNumber: `+9180${String(Date.now()).slice(-7)}${seq++}` },
});

const makeCampaign = async (name) => prisma.campaign.create({
  data: { workspaceId, name, templateId, status: 'COMPLETED' },
});

const received = (campaignId, contactId, sentAt, status = 'DELIVERED') =>
  prisma.campaignRecipient.create({ data: { campaignId, contactId, status, sentAt } });

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({
    data: { name: `test-cl-${stamp}`, autoLeadFromReply: true },
  })).id;
  templateId = (await prisma.template.create({
    data: { workspaceId, name: `tpl_${stamp}`, category: 'MARKETING', language: 'en', components: [] },
  })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('a reply to a recent campaign creates an attributed, scored lead', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await makeContact('Replier');
  const campaign = await makeCampaign('Diwali Offer');
  await received(campaign.id, contact.id, daysAgo(2));

  const result = await createLeadFromReply(workspaceId, contact.id);

  assert.equal(result.created, true);
  assert.equal(result.source, 'Campaign: Diwali Offer');
  assert.equal(result.campaignId, campaign.id);

  const lead = await prisma.lead.findUnique({ where: { id: result.leadId } });
  // CONTACTED, not NEW — they have engaged, and NEW would understate it.
  assert.equal(lead.status, 'CONTACTED');
  assert.ok(lead.scoreComputedAt instanceof Date, 'a new lead should arrive already scored');
  assert.ok(Array.isArray(lead.scoreFactors), 'the score breakdown should be stored with it');
});

test('the most recent campaign wins attribution', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await makeContact('Multi');
  const older = await makeCampaign('Old Blast');
  const newer = await makeCampaign('New Blast');
  await received(older.id, contact.id, daysAgo(10));
  await received(newer.id, contact.id, daysAgo(1));

  const attribution = await findAttributableCampaign(workspaceId, contact.id);
  assert.equal(attribution.campaignName, 'New Blast');
});

test('a campaign that never reached the contact cannot claim the reply', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await makeContact('Failed Send');
  const campaign = await makeCampaign('Never Arrived');
  // FAILED and SKIPPED mean the message never landed, so a reply cannot be a
  // response to it.
  await received(campaign.id, contact.id, daysAgo(1), 'FAILED');

  assert.equal(await findAttributableCampaign(workspaceId, contact.id), null);

  const result = await createLeadFromReply(workspaceId, contact.id);
  assert.equal(result.created, false);
  assert.match(result.reason, /No campaign/);
});

test('a reply long after the campaign is not attributed to it', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await makeContact('Late');
  const campaign = await makeCampaign('Ancient Blast');
  await received(campaign.id, contact.id, daysAgo(45)); // outside the 30-day window

  assert.equal(await findAttributableCampaign(workspaceId, contact.id), null);
});

test('an opted-out contact is never turned into a lead', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await makeContact('Opted Out');
  await prisma.contact.update({ where: { id: contact.id }, data: { optedOut: true } });
  const campaign = await makeCampaign('Ignored Offer');
  await received(campaign.id, contact.id, daysAgo(1));

  const result = await createLeadFromReply(workspaceId, contact.id);
  assert.equal(result.created, false);
  assert.match(result.reason, /opted out/i);
  assert.equal(await prisma.lead.findUnique({ where: { contactId: contact.id } }), null);
});

test('an existing lead is not duplicated', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await makeContact('Already');
  const campaign = await makeCampaign('Second Touch');
  await received(campaign.id, contact.id, daysAgo(1));

  const first = await createLeadFromReply(workspaceId, contact.id);
  assert.equal(first.created, true);

  const second = await createLeadFromReply(workspaceId, contact.id);
  assert.equal(second.created, false);
  assert.match(second.reason, /Already a lead/);
  assert.equal(second.leadId, first.leadId);

  assert.equal(await prisma.lead.count({ where: { contactId: contact.id } }), 1);
});

test('nothing happens when the workspace has not opted in', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const other = await prisma.workspace.create({ data: { name: `test-cl-off-${Date.now()}` } });
  try {
    // Default is false, so an existing workspace does not suddenly start
    // manufacturing leads from its inbound traffic.
    assert.equal(other.autoLeadFromReply, false);

    const tpl = await prisma.template.create({
      data: { workspaceId: other.id, name: `t_${Date.now()}`, category: 'MARKETING', language: 'en', components: [] },
    });
    const contact = await prisma.contact.create({
      data: { workspaceId: other.id, name: 'Off', phoneNumber: `+9181${String(Date.now()).slice(-8)}` },
    });
    const campaign = await prisma.campaign.create({
      data: { workspaceId: other.id, name: 'Off Blast', templateId: tpl.id, status: 'COMPLETED' },
    });
    await prisma.campaignRecipient.create({
      data: { campaignId: campaign.id, contactId: contact.id, status: 'DELIVERED', sentAt: daysAgo(1) },
    });

    const result = await createLeadFromReply(other.id, contact.id);
    assert.equal(result.created, false);
    assert.match(result.reason, /Disabled/);
    assert.equal(await prisma.lead.count({ where: { workspaceId: other.id } }), 0);
  } finally {
    await prisma.workspace.delete({ where: { id: other.id } }).catch(() => {});
  }
});

test('another workspace\'s campaign cannot be attributed', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const foreign = await prisma.workspace.create({ data: { name: `test-cl-foreign-${Date.now()}` } });
  try {
    const contact = await makeContact('Cross');
    const tpl = await prisma.template.create({
      data: { workspaceId: foreign.id, name: `t_${Date.now()}`, category: 'MARKETING', language: 'en', components: [] },
    });
    const foreignCampaign = await prisma.campaign.create({
      data: { workspaceId: foreign.id, name: 'Foreign Blast', templateId: tpl.id, status: 'COMPLETED' },
    });
    await prisma.campaignRecipient.create({
      data: { campaignId: foreignCampaign.id, contactId: contact.id, status: 'DELIVERED', sentAt: daysAgo(1) },
    });

    // The recipient row exists, but the campaign belongs elsewhere.
    assert.equal(await findAttributableCampaign(workspaceId, contact.id), null);
  } finally {
    await prisma.workspace.delete({ where: { id: foreign.id } }).catch(() => {});
  }
});

test('a contact who received nothing produces no lead', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await makeContact('Organic');
  const result = await createLeadFromReply(workspaceId, contact.id);
  assert.equal(result.created, false);
  assert.match(result.reason, /No campaign/);
});
