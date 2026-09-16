import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import {
  updateSection,
} from './crmCustomization.service.js';
import {
  createLead,
  getLead,
  updateLead,
  listLeads,
} from './leads.service.js';
import {
  createDeal,
  updateDealStage,
  getDeal,
} from './deals.service.js';
import {
  createActivity,
} from './activities.service.js';
import {
  createTicket,
} from './tickets.service.js';

let dbAvailable = false;
let workspaceId;
let userId;
let contactId;

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }

  const stamp = Date.now();
  const ws = await prisma.workspace.create({
    data: { name: 'test-bugfixes-' + stamp },
  });
  workspaceId = ws.id;

  const user = await prisma.user.create({
    data: {
      email: 'test-' + stamp + '@example.com',
      passwordHash: 'dummy',
      name: 'Test Agent',
    },
  });
  userId = user.id;

  await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId,
      role: 'ADMIN',
    },
  });

  const contact = await prisma.contact.create({
    data: {
      workspaceId,
      name: 'Bug Fixes Contact',
      phoneNumber: '+9198' + stamp.toString().slice(-8),
      email: 'contact-' + stamp + '@example.com',
    },
  });
  contactId = contact.id;
});

test.after(async () => {
  if (!dbAvailable || !workspaceId) return;
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
});

test('Bug 1: Lead Lifecycle supports custom stage keys in creation, listing, and updates', async (t) => {
  if (!dbAvailable) return t.skip('db unavailable');

  const stamp = Date.now();
  const lead = await createLead(workspaceId, {
    name: 'Lifecycle Lead',
    phoneNumber: '+9191' + stamp.toString().slice(-8),
    email: 'lifecycle-' + stamp + '@example.com',
    status: 'NURTURING',
  });

  assert.equal(lead.status, 'NURTURING');

  const fetched = await getLead(workspaceId, lead.id);
  assert.equal(fetched.status, 'NURTURING');

  const updated = await updateLead(workspaceId, lead.id, { status: 'CUSTOM_STAGE_X' });
  assert.equal(updated.status, 'CUSTOM_STAGE_X');

  const listed = await listLeads(workspaceId, { status: 'CUSTOM_STAGE_X' });
  assert.ok(listed.data.some((l) => l.id === lead.id));
});

test('Bug 2: Prospecting criteria evaluate qualification score and enforce validation', async (t) => {
  if (!dbAvailable) return t.skip('db unavailable');

  await updateSection(workspaceId, 'prospecting_criteria', {
    minBudget: 5000,
    currency: 'USD',
    companySizeMin: 10,
    requirePhone: true,
    requireEmail: true,
    requireCompany: false,
    targetIndustries: ['Technology & SaaS'],
    checklist: [
      { id: 'crit_1', question: 'Pain points identified?', required: true, weight: 50 },
      { id: 'crit_2', question: 'Budget confirmed?', required: false, weight: 50 },
    ],
  });

  const stamp = Date.now();
  const lead = await createLead(workspaceId, {
    name: 'Qualified Prospect',
    phoneNumber: '+9192' + stamp.toString().slice(-8),
    email: 'qualified@example.com',
    budget: 10000,
    companySize: 25,
    industry: 'Technology & SaaS',
    checklistAnswers: { crit_1: true, crit_2: true },
  });

  const qual = lead.customFields?.qualification;
  assert.ok(qual, 'qualification must be populated');
  assert.equal(qual.status, 'QUALIFIED');
  assert.equal(qual.score, 100);
  assert.equal(qual.criteriaChecks?.budget, true);
  assert.equal(qual.criteriaChecks?.companySize, true);

  const disqualifiedLead = await updateLead(workspaceId, lead.id, {
    prospecting: {
      budget: 1000,
      companySize: 2,
      industry: 'Other',
      answers: { crit_1: false },
    },
  });

  const updatedQual = disqualifiedLead.customFields?.qualification;
  assert.equal(updatedQual.status, 'DISQUALIFIED');
  assert.equal(updatedQual.criteriaChecks?.budget, false);
  assert.equal(updatedQual.criteriaChecks?.companySize, false);
});

test('Bug 3: Automatic Deal Mode generates follow-up tasks upon stage transition', async (t) => {
  if (!dbAvailable) return t.skip('db unavailable');

  await updateSection(workspaceId, 'deal_mode', {
    mode: 'AUTOMATIC',
    autoTaskConfig: {
      followUpDueDays: 3,
      defaultPriority: 'HIGH',
      stageTaskTemplates: {
        PROPOSAL: 'Present commercial proposal and confirm decision timeframe',
      },
    },
  });

  const deal = await createDeal(workspaceId, {
    title: 'Auto Task Deal',
    contactId,
    ownerUserId: userId,
    stage: 'QUALIFICATION',
  });

  await updateDealStage(workspaceId, deal.id, 'PROPOSAL', userId);

  const tasks = await prisma.task.findMany({
    where: { workspaceId, dealId: deal.id },
  });

  assert.ok(tasks.length >= 1, 'Auto-generated task should exist');
  assert.match(tasks[0].title, /Present commercial proposal/);
  assert.match(tasks[0].description, /Priority: HIGH/);
  assert.equal(tasks[0].assignedToUserId, userId);
});

test('Bug 4: Lead tags are persisted on contact and filterable', async (t) => {
  if (!dbAvailable) return t.skip('db unavailable');

  const stamp = Date.now();
  const lead = await createLead(workspaceId, {
    name: 'Tagged Lead',
    phoneNumber: '+9193' + stamp.toString().slice(-8),
    email: 'tagged-' + stamp + '@example.com',
    tags: ['High Value', 'Enterprise'],
  });

  assert.deepEqual(lead.contact.tags, ['High Value', 'Enterprise']);

  const filtered = await listLeads(workspaceId, { tag: 'Enterprise' });
  assert.ok(filtered.data.some((l) => l.id === lead.id));

  const updated = await updateLead(workspaceId, lead.id, { tags: ['High Value', 'Mid-Market'] });
  assert.deepEqual(updated.contact.tags, ['High Value', 'Mid-Market']);
});

test('Bug 5: Rejects duplicate source keys in lead_sources', async (t) => {
  if (!dbAvailable) return t.skip('db unavailable');

  await assert.rejects(
    () =>
      updateSection(workspaceId, 'lead_sources', {
        sources: [
          { key: 'DUPLICATE_KEY', name: 'Source 1', isActive: true },
          { key: 'DUPLICATE_KEY', name: 'Source 2', isActive: true },
        ],
      }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Duplicate lead source/i);
      return true;
    }
  );
});

test('Bug 6: Validates lead source against configured sources and filters by source', async (t) => {
  if (!dbAvailable) return t.skip('db unavailable');

  await updateSection(workspaceId, 'lead_sources', {
    sources: [
      { key: 'ACTIVE_SOURCE', name: 'Active Source', isActive: true },
      { key: 'DISABLED_SOURCE', name: 'Disabled Source', isActive: false },
    ],
  });

  const stamp = Date.now();

  await assert.rejects(
    () =>
      createLead(workspaceId, {
        name: 'Disabled Source Lead',
        phoneNumber: '+9194' + stamp.toString().slice(-8),
        email: 'disabled-' + stamp + '@example.com',
        source: 'DISABLED_SOURCE',
      }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /disabled/i);
      return true;
    }
  );

  const validLead = await createLead(workspaceId, {
    name: 'Valid Source Lead',
    phoneNumber: '+9195' + stamp.toString().slice(-8),
    email: 'valid-' + stamp + '@example.com',
    source: 'ACTIVE_SOURCE',
  });
  assert.equal(validLead.source, 'ACTIVE_SOURCE');

  const listed = await listLeads(workspaceId, { source: 'ACTIVE_SOURCE' });
  assert.ok(listed.data.some((l) => l.id === validLead.id));
});

test('Bug 7 & 8: Call and Visit outcome triggers auto-generate follow-up tasks', async (t) => {
  if (!dbAvailable) return t.skip('db unavailable');

  await createActivity(workspaceId, {
    type: 'CALL',
    content: 'Spoke with prospect about rollout',
    contactId,
    createdById: userId,
    outcome: 'call_1',
  });

  const callTasks = await prisma.task.findMany({
    where: { workspaceId, contactId },
  });
  assert.ok(callTasks.length >= 1, 'Follow-up task for call outcome should be generated');

  await createActivity(workspaceId, {
    type: 'MEETING',
    content: 'Completed on-site demo with stakeholder',
    contactId,
    createdById: userId,
    outcome: 'vis_1',
  });

  const meetingTasks = await prisma.task.findMany({
    where: { workspaceId, contactId, title: { contains: 'Meeting Completed' } },
  });
  assert.ok(meetingTasks.length >= 1, 'Follow-up task for visit outcome should be generated');
});

test('Bug 9: DealStageHistory records custom stage keys accurately', async (t) => {
  if (!dbAvailable) return t.skip('db unavailable');

  const deal = await createDeal(workspaceId, {
    title: 'Custom Stage Deal',
    contactId,
    stage: 'CUSTOM_DEMO_STAGE',
  });

  await updateDealStage(workspaceId, deal.id, 'CUSTOM_NEGOTIATION_STAGE', userId);

  const fullDeal = await getDeal(workspaceId, deal.id);
  const histories = fullDeal.stageHistory || [];

  assert.ok(histories.length >= 1, 'Stage history should be recorded');
  const lastHistory = histories[histories.length - 1];
  assert.equal(lastHistory.fromStageKey, 'CUSTOM_DEMO_STAGE');
  assert.equal(lastHistory.toStageKey, 'CUSTOM_NEGOTIATION_STAGE');
});

test('Bug 10: Custom default Ticket stage is assigned to new tickets', async (t) => {
  if (!dbAvailable) return t.skip('db unavailable');

  await updateSection(workspaceId, 'ticket_customization', {
    stages: [
      { key: 'NEW', label: 'New', isDefault: false },
      { key: 'OPEN', label: 'Open', isDefault: false },
      { key: 'WAITING_ON_CUSTOMER', label: 'Waiting on Customer', isDefault: true },
    ],
  });

  const ticket = await createTicket(workspaceId, {
    subject: 'Custom Default Stage Ticket',
    contactId,
  });

  assert.equal(ticket.status, 'WAITING');
});