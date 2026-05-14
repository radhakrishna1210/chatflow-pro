import { prisma } from '../lib/prisma.js';

export async function listTriggers(workspaceId) {
  return prisma.automationTrigger.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}

export async function createTrigger(workspaceId, { keyword, responseTemplate, isActive = true }) {
  return prisma.automationTrigger.create({ data: { workspaceId, keyword, responseTemplate, isActive } });
}

export async function updateTrigger(workspaceId, id, updates) {
  const trigger = await prisma.automationTrigger.findFirst({ where: { id, workspaceId } });
  if (!trigger) { const e = new Error('Trigger not found'); e.status = 404; throw e; }
  return prisma.automationTrigger.update({ where: { id }, data: updates });
}

export async function deleteTrigger(workspaceId, id) {
  const trigger = await prisma.automationTrigger.findFirst({ where: { id, workspaceId } });
  if (!trigger) { const e = new Error('Trigger not found'); e.status = 404; throw e; }
  await prisma.automationTrigger.delete({ where: { id } });
}

export async function findMatchingTrigger(workspaceId, messageBody) {
  const triggers = await prisma.automationTrigger.findMany({
    where: { workspaceId, isActive: true },
  });
  const lowerBody = messageBody.toLowerCase();
  return triggers.find((t) => lowerBody.includes(t.keyword.toLowerCase()));
}
