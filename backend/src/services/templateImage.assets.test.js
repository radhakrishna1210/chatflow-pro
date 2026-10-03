import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// CF-110: stored template media is resolved only inside the SENDING workspace,
// at send time, on every path (they all build through buildTemplateSendPayload).
// A template saved before the save-time check — or whose asset was deleted —
// must fail its send instead of uploading another tenant's picture.

const assets = new Map([
  ['asset_a1', { id: 'asset_a1', workspaceId: 'ws_a', mimeType: 'image/png', bytes: Buffer.from('a1') }],
  ['asset_a2', { id: 'asset_a2', workspaceId: 'ws_a', mimeType: 'image/png', bytes: Buffer.from('a2') }],
  ['asset_b1', { id: 'asset_b1', workspaceId: 'ws_b', mimeType: 'image/png', bytes: Buffer.from('b1') }],
]);
const uploads = [];
const cacheWrites = [];

const prisma = {
  templateAsset: {
    findFirst: async ({ where }) => {
      const a = assets.get(where.id);
      return a && a.workspaceId === where.workspaceId ? a : null;
    },
    findUnique: async ({ where }) => assets.get(where.id) ?? null,
    findMany: async ({ where }) => [...assets.values()]
      .filter((a) => where.id.in.includes(a.id) && a.workspaceId === where.workspaceId),
    update: async ({ where, data }) => { cacheWrites.push({ id: where.id, ...data }); return {}; },
  },
  template: { update: async () => ({}) },
};
mock.module('../lib/prisma.js', { namedExports: { prisma } });
mock.module('../lib/meta.js', {
  namedExports: {
    uploadPhoneMedia: async ({ fileName }) => { uploads.push(fileName); return `media_${fileName}`; },
  },
});

const { resolveTemplateAsset, assertCardAssetsOwned, carouselComponent, headerImageComponent } = await import('./templateImage.service.js');
const { buildTemplateSendPayload } = await import('./templatePayload.service.js');

const card = (assetId) => ({
  components: [
    { type: 'HEADER', format: 'IMAGE', ...(assetId ? { _assetId: assetId } : {}) },
    { type: 'BODY', text: 'Card' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }] },
  ],
});
const carouselTemplate = (workspaceId, ...assetIds) => ({
  id: 'tpl_1',
  workspaceId,
  name: 'promo',
  language: 'en',
  components: [
    { type: 'BODY', text: 'Look' },
    { type: 'CAROUSEL', cards: assetIds.map(card) },
  ],
});
const headerTemplate = (workspaceId, headerAssetId) => ({
  id: 'tpl_2',
  workspaceId,
  name: 'hello',
  language: 'en',
  headerAssetId,
  components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi' }],
});

const send = { phoneNumberId: 'PN', accessToken: 'tok', resolve: () => 'x', log: false };
const quietly = async (fn) => {
  const warn = console.warn;
  const lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  try { return { result: await fn(), lines }; } catch (err) { return { err, lines }; } finally { console.warn = warn; }
};

test('resolveTemplateAsset returns an asset the sending workspace owns', async () => {
  assert.equal((await resolveTemplateAsset('ws_a', 'asset_a1')).id, 'asset_a1');
});

test('resolveTemplateAsset refuses another workspace\'s asset with a clear error and a security log', async () => {
  const { err, lines } = await quietly(() => resolveTemplateAsset('ws_a', 'asset_b1', { label: 'card 1' }));
  assert.equal(err.status, 422);
  assert.equal(err.code, 'TEMPLATE_MEDIA_UNAVAILABLE');
  assert.match(err.message, /not available in this workspace/);
  assert.ok(lines.some((l) => /another workspace/.test(l) && /asset_b1/.test(l)));
});

test('resolveTemplateAsset refuses a deleted asset', async () => {
  const { err, lines } = await quietly(() => resolveTemplateAsset('ws_a', 'asset_gone'));
  assert.equal(err.code, 'TEMPLATE_MEDIA_UNAVAILABLE');
  assert.equal(lines.length, 0, 'a plain miss is not logged as cross-tenant');
});

test('a carousel saved with a foreign card asset fails at send without uploading anything', async () => {
  uploads.length = 0;
  cacheWrites.length = 0;
  const { err } = await quietly(() => carouselComponent(carouselTemplate('ws_a', 'asset_a1', 'asset_b1'), send));
  assert.equal(err?.code, 'TEMPLATE_MEDIA_UNAVAILABLE');
  assert.match(err.message, /card 2/);
  assert.ok(!uploads.includes('header_asset_b1'), 'victim bytes never uploaded');
  assert.ok(!cacheWrites.some((w) => w.id === 'asset_b1'), 'victim media cache never overwritten');
});

test('a carousel whose assets are all owned sends', async () => {
  const out = await carouselComponent(carouselTemplate('ws_a', 'asset_a1', 'asset_a2'), send);
  assert.equal(out.cards.length, 2);
});

test('an image header pointing at a foreign asset fails at send', async () => {
  uploads.length = 0;
  const { err } = await quietly(() => headerImageComponent(headerTemplate('ws_a', 'asset_b1'), send));
  assert.equal(err?.code, 'TEMPLATE_MEDIA_UNAVAILABLE');
  assert.equal(uploads.length, 0);
});

test('assets are resolved in the sending workspace, not the template\'s', async () => {
  // A template row carrying ws_b assets cannot be sent by ws_a even if the
  // template itself were loaded unscoped.
  const { err } = await quietly(() => buildTemplateSendPayload(carouselTemplate('ws_b', 'asset_b1'), { ...send, workspaceId: 'ws_a' }));
  assert.equal(err?.code, 'TEMPLATE_WORKSPACE_MISMATCH');
  const { err: err2 } = await quietly(() => headerImageComponent(headerTemplate('ws_b', 'asset_b1'), { ...send, workspaceId: 'ws_a' }));
  assert.equal(err2?.code, 'TEMPLATE_MEDIA_UNAVAILABLE');
});

test('buildTemplateSendPayload checks every carousel card at send', async () => {
  const { err } = await quietly(() => buildTemplateSendPayload(carouselTemplate('ws_a', 'asset_b1'), { ...send, workspaceId: 'ws_a' }));
  assert.equal(err?.code, 'TEMPLATE_MEDIA_UNAVAILABLE');
  const ok = await buildTemplateSendPayload(carouselTemplate('ws_a', 'asset_a1'), { ...send, workspaceId: 'ws_a' });
  assert.ok(ok.components.some((c) => c.type === 'carousel'));
});

test('assertCardAssetsOwned refuses a foreign card asset at save and names the card', async () => {
  await assert.doesNotReject(() => assertCardAssetsOwned('ws_a', carouselTemplate('ws_a', 'asset_a1', 'asset_a2').components));
  await assert.rejects(
    () => assertCardAssetsOwned('ws_a', carouselTemplate('ws_a', 'asset_a1', null, 'asset_b1').components),
    (e) => e.status === 400 && e.code === 'TEMPLATE_MEDIA_UNAVAILABLE' && /card 3/.test(e.message),
  );
  await assert.doesNotReject(() => assertCardAssetsOwned('ws_a', [{ type: 'BODY', text: 'no carousel' }]));
});
