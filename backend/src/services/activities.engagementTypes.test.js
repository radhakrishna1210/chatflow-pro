import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { createActivity, listActivities } from './activities.service.js';

// Engagements tabs: Video Calls and Visits are both MEETING rows. They used to
// filter and count identically (every meeting on both tabs), and the list
// invented a team ("Enterprise Growth Team") and a source ("INSTAGRAM").

let dbAvailable = false;
let ws; let user;
const stamp = Date.now();

test.before(async () => {
  try { await prisma.$queryRaw`SELECT 1`; dbAvailable = true; } catch { return; }
  ws = (await prisma.workspace.create({ data: { name: `engtypes-${stamp}` } })).id;
  user = (await prisma.user.create({ data: { name: 'Eng Types', email: `engtypes-${stamp}@example.test` } })).id;
  await prisma.workspaceMember.create({ data: { workspaceId: ws, userId: user, role: 'ADMIN' } });
  await createActivity(ws, { type: 'MEETING', engagementType: 'Visit', status: 'Scheduled', notes: 'site visit', content: 'site visit' }, user);
  await createActivity(ws, { type: 'MEETING', engagementType: 'Video Call', notes: 'zoom', content: 'zoom' }, user);
  // a legacy meeting with no structured type counts as a video call
  await prisma.crmActivity.create({ data: { workspaceId: ws, type: 'MEETING', content: 'old meeting', createdByUserId: user } });
});

test.after(async () => {
  if (!dbAvailable) return;
  await prisma.crmActivity.deleteMany({ where: { workspaceId: ws } });
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: ws } });
  await prisma.workspace.delete({ where: { id: ws } }).catch(() => {});
  await prisma.user.delete({ where: { id: user } }).catch(() => {});
});

test('Visits and Video Calls tabs return different rows and counts', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const visits = await listActivities(ws, { type: 'VISITS' });
  const calls = await listActivities(ws, { type: 'VIDEO_CALL' });
  assert.deepEqual(visits.data.map((a) => a.content), ['site visit']);
  assert.deepEqual(calls.data.map((a) => a.content).sort(), ['old meeting', 'zoom']);
  assert.equal(visits.counts.VISITS, 1);
  assert.equal(visits.counts.VIDEO_CALL, 2);
  assert.equal(visits.data[0].engagementType, 'Visit');
  assert.equal(visits.data[0].engagementStatus, 'Scheduled');
});

test('the list does not invent a team, source or contact name', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const all = await listActivities(ws, {});
  for (const a of all.data) {
    assert.equal(a.teamName, null);
    assert.equal(a.leadSource, null);
    assert.equal(a.leadName, null);
  }
});
