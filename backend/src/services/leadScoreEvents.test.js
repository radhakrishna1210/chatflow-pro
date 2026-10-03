import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The `score_above` CRM trigger (WF-EV-3).
//
// computeLeadCategory is the one place a lead's score is rewritten, so it now
// raises lead_score_changed itself. Before, the inbound reply path
// (captureReplyAsLead -> computeLeadCategory) rescored silently and the
// debounced rescore a minute later saw no change, so score_above never fired
// from customer activity; and a CSV import's follow-up emitted
// lead_score_changed(previous 0) for every imported lead.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const events = [];
mock.module('./crmEvents.service.js', {
  namedExports: {
    emitCrmEvent: (ws, event, payload) => events.push({ event, ...payload }),
    emitCrmEvents: (ws, event, payloads) => payloads.forEach((p) => events.push({ event, ...p })),
  },
});
let fresh = 75;
mock.module('./leadScoring.service.js', {
  namedExports: { computeLeadScore: async () => ({ score: fresh, factors: [], computedAt: new Date() }) },
});
mock.module('./leadDistribution.service.js', {
  namedExports: { evaluateAndAssignLead: async () => ({ assigned: false }) },
});

const { prisma } = await import('../lib/prisma.js');
const { createLeadFromReply } = await import('./campaignLeads.service.js');
const { refreshLeadScoringForContact, processImportFollowUp } = await import('./crmMaintenance.service.js');

const WS = 'ws_s';
let lead;
const reset = (score) => {
  events.length = 0;
  fresh = 75;
  lead = { id: 'lead_1', workspaceId: WS, contactId: 'ct', score, category: 'WARM', source: null, ownerUserId: 'u1', LeadFormSubmission: [], contact: { optedOut: false } };
};
prisma.lead.findFirst = async () => (lead ? structuredClone(lead) : null);
prisma.lead.findUnique = async () => ({ id: lead.id });
prisma.lead.update = async ({ data }) => { Object.assign(lead, data); return structuredClone(lead); };
prisma.message.findFirst = async () => ({ sentAt: new Date() });
prisma.message.count = async () => 3;
prisma.conversation.findFirst = async () => ({ id: 'conv' });
prisma.workspace.findUnique = async () => ({ autoLeadFromReply: true });
prisma.contact.findFirst = async () => ({ id: 'ct', optedOut: false, phoneNumber: '+919800000000', email: null, tags: [] });
const flush = () => new Promise((r) => setTimeout(r, 50));
const scoreAboveFires = (e, t) => e.event === 'lead_score_changed' && e.score >= t && (e.previousScore ?? 0) < t;
const scoreEvents = () => events.filter((e) => e.event === 'lead_score_changed');

test('the debounced rescore alone raises the crossing', async () => {
  reset(40);
  await refreshLeadScoringForContact(WS, 'ct');
  assert.equal(scoreEvents().length, 1);
  assert.ok(scoreAboveFires(events.find((e) => e.event === 'lead_score_changed'), 70));
});

test('with auto-lead-from-reply on, the reply path\'s rescore raises the crossing exactly once', async () => {
  reset(40);
  await createLeadFromReply(WS, 'ct'); // inbound: captureReplyAsLead on an existing lead
  await flush(); // its fire-and-forget computeLeadCategory lands
  await refreshLeadScoringForContact(WS, 'ct'); // the debounced crm-maintenance job 60 s later
  assert.equal(lead.score, 75);
  assert.equal(scoreEvents().length, 1, 'one crossing, raised where the score changed');
  assert.deepEqual(
    { score: scoreEvents()[0].score, previousScore: scoreEvents()[0].previousScore },
    { score: 75, previousScore: 40 },
  );
  assert.ok(scoreAboveFires(scoreEvents()[0], 70));
});

test('an unchanged score raises nothing', async () => {
  reset(75);
  await refreshLeadScoringForContact(WS, 'ct');
  assert.equal(scoreEvents().length, 0);
});

test('a CSV import follow-up scores its leads without firing score_above for each', async () => {
  reset(0); // createManyAndReturn writes no score -> @default(0)
  const out = await processImportFollowUp(WS, ['lead_1'], { distribute: false });
  assert.equal(out.scored, 1);
  assert.equal(lead.score, 75, 'the score is still written');
  assert.equal(scoreEvents().length, 0);
});

test('a lead that disappeared is skipped, not an error', async () => {
  reset(0);
  lead = null;
  assert.equal(await refreshLeadScoringForContact(WS, 'ct'), null);
});
