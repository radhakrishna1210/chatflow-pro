import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { runFallbackForRecipient } from './fallback.service.js';

const campaign = (workspaceId) => ({ id: 'c1', workspaceId, fallbackConfig: { smsEnabled: true, smsFrom: '+15550000000', emailEnabled: true } });

test('no SMS/email fallback to a contact flagged opted out', async () => {
  const out = await runFallbackForRecipient(campaign('ws-none'), { id: 'r1' }, { id: 'k1', phoneNumber: '+919800000000', optedOut: true });
  assert.equal(out.skipped, 'opted_out');
  assert.equal(out.attempts.length, 0);
});

test('no SMS/email fallback to a number on the opt-out list', async (t) => {
  try { await prisma.$connect(); } catch { return t.skip('database unavailable'); }
  const ws = await prisma.workspace.create({ data: { name: `fallback-test-${Date.now()}` } });
  try {
    await prisma.optOut.create({ data: { workspaceId: ws.id, phoneNumber: '919800000001', rawPhone: '+919800000001', active: true } });
    const out = await runFallbackForRecipient(campaign(ws.id), { id: 'r2' }, { id: 'k2', phoneNumber: '+91 98000 00001' });
    assert.equal(out.skipped, 'opted_out');
  } finally {
    await prisma.optOut.deleteMany({ where: { workspaceId: ws.id } }).catch(() => {});
    await prisma.workspace.delete({ where: { id: ws.id } }).catch(() => {});
  }
});
