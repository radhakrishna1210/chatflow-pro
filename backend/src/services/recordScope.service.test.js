import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { scopeFilter, teammateIds, getWorkspaceVisibility } from './recordScope.service.js';
import { createTeam, setTeamMembers, setVisibility, deleteTeam } from './teams.service.js';
import { listLeads, getLead, updateLead } from './leads.service.js';
import { listTasks } from './tasks.service.js';

let dbAvailable = false;
let workspaceId;
let admin;      // ADMIN — always sees everything
let alice;      // CLIENT, team "Sales"
let bob;        // CLIENT, team "Sales"
let carol;      // CLIENT, no team
let teamId;
let aliceLead;
let carolLead;
let unownedLead;

const asUser = (id, role = 'CLIENT') => ({ id, role });

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-scope-${stamp}` } })).id;

  const mk = async (name) => {
    const u = await prisma.user.create({ data: { name, email: `${name}-${stamp}@example.test` } });
    await prisma.workspaceMember.create({ data: { userId: u.id, workspaceId, role: name === 'admin' ? 'ADMIN' : 'CLIENT' } });
    return u.id;
  };
  admin = await mk('admin');
  alice = await mk('alice');
  bob = await mk('bob');
  carol = await mk('carol');

  const team = await createTeam(workspaceId, { name: 'Sales' });
  teamId = team.id;
  await setTeamMembers(workspaceId, teamId, [alice, bob]);

  // A counter, not a random suffix: the workspace has a unique index on
  // (workspaceId, phoneNumber) and random collides often enough to fail.
  let seq = 0;
  const contact = async (n) => (await prisma.contact.create({
    data: { workspaceId, name: n, phoneNumber: `+9160${String(stamp).slice(-7)}${seq++}` },
  })).id;

  aliceLead = (await prisma.lead.create({ data: { workspaceId, contactId: await contact('Alice Lead'), ownerUserId: alice } })).id;
  carolLead = (await prisma.lead.create({ data: { workspaceId, contactId: await contact('Carol Lead'), ownerUserId: carol } })).id;
  unownedLead = (await prisma.lead.create({ data: { workspaceId, contactId: await contact('Unowned Lead'), ownerUserId: null } })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  for (const id of [admin, alice, bob, carol]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
});

test('a fresh workspace defaults to ALL — enabling the feature changes nothing', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  assert.equal(await getWorkspaceVisibility(workspaceId), 'ALL');
  assert.deepEqual(await scopeFilter(workspaceId, asUser(carol)), {}, 'ALL must impose no filter');

  const { data } = await listLeads(workspaceId, {}, asUser(carol));
  assert.equal(data.length, 3, 'every member sees every lead under ALL');
});

test('OWN restricts to the caller, but keeps unowned records visible', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setVisibility(workspaceId, 'OWN');

  const { data } = await listLeads(workspaceId, {}, asUser(alice));
  const ids = data.map((l) => l.id);

  assert.ok(ids.includes(aliceLead), 'own lead visible');
  assert.ok(ids.includes(unownedLead), 'an unowned lead must stay visible or it silently rots');
  assert.ok(!ids.includes(carolLead), "another member's lead must be hidden");
});

test('TEAM widens visibility to teammates only', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setVisibility(workspaceId, 'TEAM');

  const peers = await teammateIds(workspaceId, alice);
  assert.deepEqual([...peers].sort(), [alice, bob].sort());

  // Bob shares a team with Alice, so he sees her lead.
  const bobsView = await listLeads(workspaceId, {}, asUser(bob));
  assert.ok(bobsView.data.map((l) => l.id).includes(aliceLead), 'a teammate sees their colleague\'s lead');
  assert.ok(!bobsView.data.map((l) => l.id).includes(carolLead), 'Carol is in no shared team');

  // Carol belongs to no team at all.
  assert.equal(await teammateIds(workspaceId, carol), null);
  const carolsView = await listLeads(workspaceId, {}, asUser(carol));
  const carolIds = carolsView.data.map((l) => l.id);
  assert.ok(carolIds.includes(carolLead));
  assert.ok(!carolIds.includes(aliceLead), 'a user in no team sees only their own work');
});

test('an admin always sees everything, whatever the mode', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  for (const mode of ['OWN', 'TEAM']) {
    await setVisibility(workspaceId, mode);
    assert.deepEqual(await scopeFilter(workspaceId, asUser(admin, 'ADMIN')), {}, `admin must be unfiltered in ${mode}`);
    const { data } = await listLeads(workspaceId, {}, asUser(admin, 'ADMIN'));
    assert.equal(data.length, 3, `admin sees all leads in ${mode}`);
  }
});

test('fetching an out-of-scope record by id returns 404, not 403', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setVisibility(workspaceId, 'OWN');

  // 403 would confirm the lead exists and let someone enumerate ids to map a
  // colleague's pipeline.
  await assert.rejects(
    () => getLead(workspaceId, carolLead, asUser(alice)),
    (e) => e.status === 404,
  );

  // The owner still reaches it.
  const own = await getLead(workspaceId, carolLead, asUser(carol));
  assert.equal(own.id, carolLead);
});

test('an out-of-scope record cannot be edited by guessing its id', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setVisibility(workspaceId, 'OWN');

  await assert.rejects(
    () => updateLead(workspaceId, carolLead, { status: 'LOST' }, asUser(alice)),
    (e) => e.status === 404,
    'hiding a record in the list is worthless if it is still writable',
  );

  const untouched = await prisma.lead.findUnique({ where: { id: carolLead }, select: { status: true } });
  assert.notEqual(untouched.status, 'LOST');
});

test('tasks scope on their assignee rather than an owner field', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setVisibility(workspaceId, 'OWN');

  await prisma.task.create({ data: { workspaceId, title: 'Alice task', assignedToUserId: alice } });
  await prisma.task.create({ data: { workspaceId, title: 'Carol task', assignedToUserId: carol } });
  await prisma.task.create({ data: { workspaceId, title: 'Unassigned task' } });

  const { data } = await listTasks(workspaceId, {}, asUser(alice));
  const titles = data.map((t2) => t2.title);

  assert.ok(titles.includes('Alice task'));
  assert.ok(titles.includes('Unassigned task'), 'an unassigned task must stay visible');
  assert.ok(!titles.includes('Carol task'));
});

test('losing a team narrows visibility immediately', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setVisibility(workspaceId, 'TEAM');

  const before = await listLeads(workspaceId, {}, asUser(bob));
  assert.ok(before.data.map((l) => l.id).includes(aliceLead));

  await setTeamMembers(workspaceId, teamId, [alice]); // bob removed

  const after = await listLeads(workspaceId, {}, asUser(bob));
  assert.ok(!after.data.map((l) => l.id).includes(aliceLead), 'removal from a team must take effect at once');

  await setTeamMembers(workspaceId, teamId, [alice, bob]);
});

test('a team cannot include someone outside the workspace', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const outsider = await prisma.user.create({ data: { name: 'Outsider', email: `outsider-${Date.now()}@example.test` } });
  try {
    await assert.rejects(
      () => setTeamMembers(workspaceId, teamId, [alice, outsider.id]),
      (e) => e.status === 400,
      'a team must not become a way to grant visibility to a non-member',
    );
  } finally {
    await prisma.user.delete({ where: { id: outsider.id } }).catch(() => {});
  }
});

test('an unknown visibility mode is refused', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(() => setVisibility(workspaceId, 'EVERYONE'), (e) => e.status === 400);
});

test('a call with no user fails closed rather than open', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const filter = await scopeFilter(workspaceId, null);
  assert.notDeepEqual(filter, {}, 'an unidentified caller must not receive an empty (unfiltered) where clause');
});

test('deleting a team widens visibility back rather than orphaning records', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setVisibility(workspaceId, 'TEAM');

  const temp = await createTeam(workspaceId, { name: 'Temporary' });
  await setTeamMembers(workspaceId, temp.id, [carol]);
  await deleteTeam(workspaceId, temp.id);

  // Carol is back to no team, so she sees only her own work — and crucially
  // her lead is still there.
  const { data } = await listLeads(workspaceId, {}, asUser(carol));
  assert.ok(data.map((l) => l.id).includes(carolLead));

  await setVisibility(workspaceId, 'ALL');
});
