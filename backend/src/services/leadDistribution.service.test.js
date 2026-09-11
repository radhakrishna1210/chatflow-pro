import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import {
  getDistributionRules,
  saveDistributionRules,
  evaluateAndAssignLead,
  autoDistributeBatch,
} from './leadDistribution.service.js';

let dbAvailable = false;
let workspaceId;
let user1Id;
let user2Id;
let contactId;
let leadId;

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-dist-${stamp}` } })).id;

  user1Id = (await prisma.user.create({
    data: { name: 'Rep Alice', email: `alice-${stamp}@example.test` },
  })).id;
  user2Id = (await prisma.user.create({
    data: { name: 'Rep Bob', email: `bob-${stamp}@example.test` },
  })).id;

  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId, userId: user1Id, role: 'CLIENT' },
      { workspaceId, userId: user2Id, role: 'CLIENT' },
    ],
  });

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Lead Contact', phoneNumber: `+9199${stamp.toString().slice(-8)}` },
  });
  contactId = contact.id;

  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      contactId,
      source: 'Website',
      score: 85,
      category: 'HOT',
    },
  });
  leadId = lead.id;
});

test.after(async () => {
  if (!dbAvailable) return;
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
});

test('lead distribution rules can be saved and retrieved', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const rules = [
    {
      id: 'rule-hot-website',
      name: 'Hot Website Leads',
      enabled: true,
      priority: 1,
      conditions: {
        category: 'HOT',
        source: 'Website',
      },
      assignment: {
        type: 'USER',
        userId: user1Id,
      },
    },
    {
      id: 'rule-warm-roundrobin',
      name: 'Warm Round Robin',
      enabled: true,
      priority: 2,
      conditions: {
        category: 'WARM',
      },
      assignment: {
        type: 'ROUND_ROBIN',
        poolUserIds: [user1Id, user2Id],
      },
    },
  ];

  const saved = await saveDistributionRules(workspaceId, { enabled: true, rules });
  assert.equal(saved.enabled, true);
  assert.equal(saved.rules.length, 2);

  const fetched = await getDistributionRules(workspaceId);
  assert.equal(fetched.enabled, true);
  assert.equal(fetched.rules.length, 2);
  assert.equal(fetched.rules[0].name, 'Hot Website Leads');
});

test('evaluateAndAssignLead assigns HOT website lead to specific user', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const result = await evaluateAndAssignLead(workspaceId, leadId);
  assert.equal(result.assigned, true);
  assert.equal(result.ownerUserId, user1Id);

  const updatedLead = await prisma.lead.findUnique({ where: { id: leadId } });
  assert.equal(updatedLead.ownerUserId, user1Id);
});

test('round robin rule alternates between users', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const stamp = Date.now();
  const c2 = await prisma.contact.create({
    data: { workspaceId, name: 'Warm 1', phoneNumber: `+9188${stamp.toString().slice(-8)}` },
  });
  const l2 = await prisma.lead.create({
    data: { workspaceId, contactId: c2.id, category: 'WARM', score: 50 },
  });

  const c3 = await prisma.contact.create({
    data: { workspaceId, name: 'Warm 2', phoneNumber: `+9177${stamp.toString().slice(-8)}` },
  });
  const l3 = await prisma.lead.create({
    data: { workspaceId, contactId: c3.id, category: 'WARM', score: 55 },
  });

  const res1 = await evaluateAndAssignLead(workspaceId, l2.id);
  assert.equal(res1.assigned, true);
  const firstAssigned = res1.ownerUserId;

  const res2 = await evaluateAndAssignLead(workspaceId, l3.id);
  assert.equal(res2.assigned, true);
  const secondAssigned = res2.ownerUserId;

  assert.notEqual(firstAssigned, secondAssigned);
  assert.ok([user1Id, user2Id].includes(firstAssigned));
  assert.ok([user1Id, user2Id].includes(secondAssigned));
});
