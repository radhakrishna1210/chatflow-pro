import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { getAllSettings, updateSettings } from './platformSettings.service.js';

// Uses TWILIO_AUTH_TOKEN as the guinea pig: a secret with no provider-side
// validation and nothing else in the suite depending on it. Any pre-existing
// override is restored afterwards.
const KEY = 'TWILIO_AUTH_TOKEN';
let dbAvailable = false;
let original = null;

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  original = await prisma.systemSetting.findUnique({ where: { key: KEY } });
});

test.after(async () => {
  if (!dbAvailable) return;
  await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  if (original) await prisma.systemSetting.create({ data: { key: KEY, value: original.value } });
  await prisma.$disconnect().catch(() => {});
});

test('secrets are masked to a fixed prefix plus the last four characters', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  const secret = 'ABCDEFGHIJKLmnopqrst';
  await updateSettings({ [KEY]: secret });
  const all = await getAllSettings();
  assert.equal(all[KEY], '********qrst');
  assert.equal(all._sources[KEY], 'database');
  assert.ok(!JSON.stringify(all).includes('ABCD'), 'no leading characters of a secret are disclosed');
});

test('a masked value — current or stale — never overwrites the stored secret', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  const secret = 'ABCDEFGHIJKLmnopqrst';
  await updateSettings({ [KEY]: secret });
  for (const masked of ['********qrst', '********', '********zzzz', 'ABCD...qrst']) {
    const res = await updateSettings({ [KEY]: masked });
    assert.deepEqual(res.updated, [], `"${masked}" must be treated as unchanged`);
  }
  const { env } = await import('../config/env.js');
  assert.equal(env[KEY], secret);
});

test('an edit typed onto the masked preview is refused rather than saved', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  await assert.rejects(updateSettings({ [KEY]: '********qrstEXTRA' }), (e) => e.status === 400);
});

test('an empty value clears the override; unmanaged keys are ignored', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  const res = await updateSettings({ [KEY]: '', DATABASE_URL: 'postgres://evil', JWT_ACCESS_SECRET: 'x' });
  assert.deepEqual(res.cleared, [KEY]);
  assert.deepEqual(res.updated, []);
  assert.equal(await prisma.systemSetting.count({ where: { key: { in: ['DATABASE_URL', 'JWT_ACCESS_SECRET'] } } }), 0);
});
