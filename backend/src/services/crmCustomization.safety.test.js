import test from 'node:test';
import assert from 'node:assert/strict';

// Customize Your Business without a database: payloads are validated per
// section, and removing a stage/status that records still use is refused on
// save and on reset instead of deleting rows out from under them.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { prisma } = await import('../lib/prisma.js');
const { updateSection, resetSection, checkSafeDeletion } = await import('./crmCustomization.service.js');
const { parseSectionPayload } = await import('../validators/crmCustomization.schemas.js');

const stageRows = () => [
  { id: 's1', key: 'QUALIFICATION', label: 'Qualification', probability: 10, sortOrder: 0, isActive: true },
  { id: 's2', key: 'PILOT', label: 'Pilot', probability: 40, sortOrder: 1, isActive: true },
  { id: 's3', key: 'CLOSED_WON', label: 'Won', probability: 100, sortOrder: 2, isActive: true },
  { id: 's4', key: 'CLOSED_LOST', label: 'Lost', probability: 0, sortOrder: 3, isActive: true },
];
let stages;
let dealsByStage;
let leadsByStatusKey;
const writes = [];

prisma.pipelineStage.findMany = async () => stages;
prisma.pipelineStage.count = async () => stages.length;
prisma.pipelineStage.createMany = async () => ({ count: 0 });
prisma.pipelineStage.findFirst = async ({ where }) => stages.find((s) => s.key === where.key) ?? null;
prisma.pipelineStage.update = async (args) => { writes.push(['update', args.where.id]); return {}; };
prisma.pipelineStage.create = async (args) => { writes.push(['create', args.data.key]); return {}; };
prisma.pipelineStage.delete = async (args) => { writes.push(['delete', args.where.id]); return {}; };
prisma.pipelineStage.deleteMany = async () => { writes.push(['deleteMany']); return { count: 0 }; };
prisma.pipelineStage.updateMany = async () => ({ count: 0 });
prisma.$transaction = async (ops) => (Array.isArray(ops) ? Promise.all(ops) : ops(prisma));
prisma.deal.count = async ({ where }) => {
  const key = where.OR.find((c) => c.customFields)?.customFields.equals;
  return dealsByStage[key] || 0;
};
prisma.lead.count = async ({ where }) => {
  const key = where.OR?.find((c) => c.customFields)?.customFields.equals;
  return leadsByStatusKey[key] || 0;
};
prisma.savedView.findFirst = async () => null;
prisma.savedView.create = async (args) => { writes.push(['save']); return { filters: args.data.filters }; };
prisma.savedView.deleteMany = async () => { writes.push(['reset']); return { count: 1 }; };

test.beforeEach(() => { stages = stageRows(); dealsByStage = {}; leadsByStatusKey = {}; writes.length = 0; });

const dealSetup = (keys) => ({ stages: keys.map((key, i) => ({ key, label: key, probability: 50, sortOrder: i, isActive: true })) });

test('section payloads are validated', () => {
  assert.throws(() => parseSectionPayload('deal_setup', { stages: [{ key: 'bad key!' }] }), (e) => e.status === 400 && /Stage keys/.test(e.message));
  assert.throws(() => parseSectionPayload('deal_setup', 'not an object'), (e) => e.status === 400);
  assert.throws(() => parseSectionPayload('deal_mode', { mode: 'SOMETIMES' }), (e) => e.status === 400);
  assert.throws(() => parseSectionPayload('lead_tags', { tags: [{ name: 'x'.repeat(500) }] }), (e) => e.status === 400);
  assert.throws(() => parseSectionPayload('lead_tags', { tags: [], junk: 'x'.repeat(70_000) }), (e) => e.status === 400 && /too large/.test(e.message));
  const kept = parseSectionPayload('lead_tags', { tags: [{ id: 't', name: 'VIP', color: '#fff', uiOnly: 1 }] });
  assert.equal(kept.tags[0].uiOnly, 1, 'presentational fields the UI adds survive');
});

test('removing a deal stage that holds deals is refused before anything is written', async () => {
  dealsByStage.PILOT = 3;
  await assert.rejects(updateSection('ws', 'deal_setup', dealSetup(['QUALIFICATION', 'CLOSED_WON', 'CLOSED_LOST'])), (e) => e.status === 409 && /3 deal/.test(e.message));
  assert.deepEqual(writes, []);
});

test('an empty stage is deleted through the pipeline-stage service', async () => {
  await updateSection('ws', 'deal_setup', dealSetup(['QUALIFICATION', 'CLOSED_WON', 'CLOSED_LOST']));
  assert.ok(writes.some(([k, id]) => k === 'delete' && id === 's2'));
});

test('dropping the terminal stages from the list never deletes them', async () => {
  await updateSection('ws', 'deal_setup', dealSetup(['QUALIFICATION', 'PILOT']));
  assert.ok(!writes.some(([k]) => k === 'delete'));
});

test('reset refuses while a custom stage still holds deals', async () => {
  dealsByStage.PILOT = 1;
  await assert.rejects(resetSection('ws', 'deal_setup'), (e) => e.status === 409);
  assert.ok(!writes.some(([k]) => k === 'deleteMany' || k === 'reset'));
});

test('custom lifecycle keys in use are no longer reported safe to delete', async () => {
  leadsByStatusKey.DEMO_BOOKED = 2;
  const res = await checkSafeDeletion('ws', 'lead_lifecycle', 'DEMO_BOOKED');
  assert.equal(res.safe, false);
  assert.equal(res.count, 2);
});
