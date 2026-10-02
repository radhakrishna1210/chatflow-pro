import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Sales Inbox segment campaigns without a database: scope, custom statuses,
// the bounded preview, the number actually used, and draft cleanup.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const calls = [];
let launchFails = false;
mock.module('./campaigns.service.js', {
  namedExports: {
    createCampaign: async (ws, body) => { calls.push(['create', body]); return { id: 'camp_1' }; },
    setRecipients: async (ws, id, contactIds) => { calls.push(['recipients', contactIds]); },
    launchCampaign: async () => {
      if (launchFails) { const e = new Error('Insufficient wallet balance'); e.status = 402; throw e; }
      calls.push(['launch']);
      return { id: 'camp_1', status: 'RUNNING' };
    },
  },
});

const { prisma } = await import('../lib/prisma.js');
const { reviewSegmentAudience, launchSegmentCampaign, getSegmentCampaignAnalytics, AUDIENCE_PREVIEW_LIMIT } = await import('./crmSalesInbox.service.js');

const findManyArgs = [];
let leadRows = [];
prisma.workspace.findUnique = async () => ({ recordVisibility: 'OWN' });
prisma.lead.findMany = async (args) => { findManyArgs.push(args); return args.take ? leadRows.slice(0, args.take) : leadRows; };
const deletes = [];
prisma.campaign.deleteMany = async (args) => { deletes.push(args.where); return { count: 1 }; };
prisma.campaign.findMany = async (args) => { findManyArgs.push(args); return [{ id: 'c', totalContacts: 10, sent: 8, delivered: 6, read: 3, failed: 1, skipped: 2 }]; };

const me = { id: 'me', role: 'CLIENT' };
const lead = (i, phone = '+919800000000', optedOut = false) => ({
  id: `l${i}`, contactId: `c${i}`, status: 'NEW', customFields: null, score: 1,
  contact: { name: `n${i}`, phoneNumber: phone, email: null, optedOut }, LeadFormSubmission: [],
});

test.beforeEach(() => { findManyArgs.length = 0; calls.length = 0; deletes.length = 0; launchFails = false; leadRows = []; });

test('review is scoped, maps custom statuses to customFields and caps the preview', async () => {
  leadRows = Array.from({ length: AUDIENCE_PREVIEW_LIMIT + 5 }, (_, i) => lead(i));
  leadRows.push(lead('x', '12', false), lead('y', '+919811111111', true));

  const res = await reviewSegmentAudience('ws', { status: 'DEMO_BOOKED' }, me);
  const where = findManyArgs[0].where;
  assert.deepEqual(where.customFields, { path: ['statusKey'], equals: 'DEMO_BOOKED' });
  assert.equal(where.status, undefined);
  assert.deepEqual(where.AND, [{ OR: [{ ownerUserId: 'me' }, { ownerUserId: null }] }]);

  assert.equal(res.leads.length, AUDIENCE_PREVIEW_LIMIT);
  assert.equal(res.truncated, true);
  assert.equal(res.matchingCount, AUDIENCE_PREVIEW_LIMIT + 7);
  assert.equal(res.eligibleCount, AUDIENCE_PREVIEW_LIMIT + 5);
  assert.deepEqual(res.exclusions, { optedOutCount: 1, invalidPhoneCount: 1 });
});

test('launch uses the chosen number and only eligible contacts', async () => {
  leadRows = [lead(1), lead(2, '12'), lead(3, '+919822222222', true)];
  await launchSegmentCampaign('ws', { templateId: 't', waNumberId: 'wa_2', status: 'NEW' }, me);
  const create = calls.find(([k]) => k === 'create')[1];
  assert.equal(create.numberId, 'wa_2');
  assert.match(create.goal, /^CRM Segment Campaign/);
  assert.deepEqual(calls.find(([k]) => k === 'recipients')[1], ['c1']);
  assert.equal(deletes.length, 0);
});

test('a failed launch removes the uncharged draft and rethrows', async () => {
  leadRows = [lead(1)];
  launchFails = true;
  await assert.rejects(launchSegmentCampaign('ws', { templateId: 't', waNumberId: 'wa' }, me), (e) => e.status === 402);
  assert.deepEqual(deletes, [{ id: 'camp_1', workspaceId: 'ws', status: 'DRAFT', chargedAt: null }]);
});

test('analytics cover segment campaigns only and report skips as skips', async () => {
  const res = await getSegmentCampaignAnalytics('ws');
  assert.deepEqual(findManyArgs[0].where, { workspaceId: 'ws', goal: { startsWith: 'CRM Segment Campaign' } });
  assert.equal(res.campaigns[0].skipped, 2);
  assert.equal(res.campaigns[0].optedOut, undefined);
  assert.equal(res.summary.totalSkipped, 2);
});
