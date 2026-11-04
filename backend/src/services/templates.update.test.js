import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { encrypt } from '../lib/encryption.js';
import { updateTemplate } from './templates.service.js';

// Editing a template must go through Meta: a local-only edit of an approved
// template left it APPROVED with content Meta never reviewed, and every send
// then went out (or failed) as something other than what the user saw.

let dbAvailable = false;
let workspaceId;
let waNumberId;
const stamp = Date.now();
const BODY = [{ type: 'BODY', text: 'Your order is ready.' }];

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const ws = await prisma.workspace.create({ data: { name: `tpl-update-${stamp}` } });
  workspaceId = ws.id;
  const n = await prisma.waNumber.create({
    data: { workspaceId, phoneNumber: '+919000000002', metaPhoneNumberId: `tpl-pnid-${stamp}`, wabaId: `tpl-waba-${stamp}`, encryptedAccessToken: encrypt('not-a-real-token') },
  });
  waNumberId = n.id;
});

test.after(async () => {
  if (!dbAvailable || !workspaceId) return;
  await prisma.template.deleteMany({ where: { workspaceId } }).catch(() => {});
  await prisma.waNumber.deleteMany({ where: { workspaceId } }).catch(() => {});
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
});

const make = (status, extra = {}) => prisma.template.create({
  data: { workspaceId, waNumberId, name: `t_${status.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`, category: 'UTILITY', language: 'en', components: BODY, status, metaTemplateId: `mt-${Math.random()}`, ...extra },
});

test("an approved template's name cannot be changed in place", async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const tpl = await make('APPROVED');
  await assert.rejects(() => updateTemplate(workspaceId, tpl.id, { name: `${tpl.name}_x` }), (e) => e.status === 409);
  const row = await prisma.template.findUnique({ where: { id: tpl.id } });
  assert.equal(row.name, tpl.name);
  assert.equal(row.status, 'APPROVED');
});

test("an approved template's category cannot be changed in place", async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const tpl = await make('APPROVED');
  await assert.rejects(() => updateTemplate(workspaceId, tpl.id, { category: 'MARKETING' }), (e) => e.status === 409);
});

test('a deleted template must be restored before it is edited', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const tpl = await make('DELETED');
  await assert.rejects(() => updateTemplate(workspaceId, tpl.id, { components: [{ type: 'BODY', text: 'Changed' }] }), (e) => e.status === 409);
});

test('saving without changes touches nothing', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const tpl = await make('APPROVED');
  const out = await updateTemplate(workspaceId, tpl.id, { name: tpl.name, language: 'en' });
  assert.equal(out.status, 'APPROVED');
});

test('when Meta refuses an edit, the stored template is left exactly as it was', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const tpl = await make('REJECTED', { rejectedReason: 'INVALID_FORMAT' });
  // The token is fake, so Meta (or the network) refuses the edit call.
  await assert.rejects(() => updateTemplate(workspaceId, tpl.id, { components: [{ type: 'BODY', text: 'Your order is on its way.' }] }));
  const row = await prisma.template.findUnique({ where: { id: tpl.id } });
  assert.equal(row.status, 'REJECTED');
  assert.equal(row.rejectedReason, 'INVALID_FORMAT');
  assert.deepEqual(row.components, BODY);
});
