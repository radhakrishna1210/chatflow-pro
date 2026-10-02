import test from 'node:test';
import assert from 'node:assert/strict';

// Owner and team ids on leads, deals, tickets and conversations come straight
// from the client. The FK only proves the row exists somewhere, so a removed
// member, or a team from another workspace, used to be accepted — and the
// record's include then returned that user's name/email or that team's name.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { prisma } = await import('../lib/prisma.js');
const { assertRecordReferences, assertWorkspaceMember } = await import('./crmReferences.js');
const { updateTicket } = await import('./tickets.service.js');
const { bulkAssignLeads } = await import('./leads.service.js');
const { assignConversation } = await import('./conversations.service.js');

const members = new Set(['ws:member']);
const teams = new Set(['ws:team_ws']);
const writes = [];

prisma.workspaceMember.findUnique = async ({ where }) => {
  const { userId, workspaceId } = where.userId_workspaceId;
  return members.has(`${workspaceId}:${userId}`) ? { userId } : null;
};
prisma.team.findFirst = async ({ where }) => (teams.has(`${where.workspaceId}:${where.id}`) ? { id: where.id } : null);
prisma.workspace.findUnique = async () => ({ recordVisibility: 'ALL' });
prisma.crmTicket.findFirst = async () => ({ id: 'tk', priority: 'NORMAL', createdAt: new Date(), status: 'OPEN' });
prisma.crmTicket.update = async (args) => { writes.push(['ticket', args.data]); return { id: 'tk', ...args.data }; };
prisma.lead.updateMany = async (args) => { writes.push(['lead', args.data]); return { count: 1 }; };
prisma.conversation.findFirst = async () => ({ id: 'cv' });
prisma.conversation.update = async (args) => { writes.push(['conversation', args.data]); return { id: 'cv', ...args.data }; };

test.beforeEach(() => { writes.length = 0; });

test('members and own teams pass; null and absent ids are allowed (clearing an owner)', async () => {
  await assertRecordReferences('ws', { ownerUserId: 'member', teamId: 'team_ws' });
  await assertRecordReferences('ws', { ownerUserId: null, teamId: undefined });
  await assertRecordReferences('ws', {});
});

test('a non-member owner is refused with 404', async () => {
  await assert.rejects(assertRecordReferences('ws', { ownerUserId: 'outsider' }), (e) => e.status === 404 && /Owner/.test(e.message));
  await assert.rejects(assertWorkspaceMember('ws', 'outsider', 'Assignee'), (e) => e.status === 404 && /Assignee/.test(e.message));
});

test('a team from another workspace is refused', async () => {
  await assert.rejects(assertRecordReferences('ws', { teamId: 'team_other' }), (e) => e.status === 404 && /Team/.test(e.message));
});

test('updateTicket rejects a foreign team or non-member owner before writing', async () => {
  await assert.rejects(updateTicket('ws', 'tk', { teamId: 'team_other' }, { id: 'member', role: 'CLIENT' }));
  await assert.rejects(updateTicket('ws', 'tk', { ownerUserId: 'outsider' }, { id: 'member', role: 'CLIENT' }));
  assert.equal(writes.length, 0);
  await updateTicket('ws', 'tk', { teamId: 'team_ws', ownerUserId: 'member' }, { id: 'member', role: 'CLIENT' });
  assert.equal(writes.length, 1);
});

test('bulk lead assignment and conversation assignment refuse non-members', async () => {
  await assert.rejects(bulkAssignLeads('ws', ['l1'], 'outsider', { id: 'member', role: 'CLIENT' }), (e) => e.status === 404);
  await assert.rejects(assignConversation('ws', 'cv', 'outsider'), (e) => e.status === 404);
  assert.equal(writes.length, 0);
  await bulkAssignLeads('ws', ['l1'], null, { id: 'member', role: 'CLIENT' });
  await assignConversation('ws', 'cv', 'member');
  assert.equal(writes.length, 2);
});
