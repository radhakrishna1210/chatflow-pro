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
  const data = {};
  if (updates.keyword !== undefined) data.keyword = updates.keyword;
  if (updates.responseTemplate !== undefined) data.responseTemplate = updates.responseTemplate;
  if (updates.isActive !== undefined) data.isActive = updates.isActive;
  return prisma.automationTrigger.update({ where: { id }, data });
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

export async function getBasicAutomations(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      autoOooEnabled: true,
      autoWelcomeEnabled: true,
      autoDelayedEnabled: true,
    },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return ws;
}

export async function updateBasicAutomations(workspaceId, updates) {
  const data = {};
  if (updates.autoOooEnabled !== undefined) data.autoOooEnabled = updates.autoOooEnabled;
  if (updates.autoWelcomeEnabled !== undefined) data.autoWelcomeEnabled = updates.autoWelcomeEnabled;
  if (updates.autoDelayedEnabled !== undefined) data.autoDelayedEnabled = updates.autoDelayedEnabled;
  
  return prisma.workspace.update({
    where: { id: workspaceId },
    data,
    select: {
      autoOooEnabled: true,
      autoWelcomeEnabled: true,
      autoDelayedEnabled: true,
    },
  });
}

// Voice AI Settings
export async function getVoiceSettings(workspaceId) {
  return prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      voiceAiEnabled: true,
      voiceAiName: true,
      voiceAiPrompt: true,
      voiceAiPhone: true,
    },
  });
}

export async function updateVoiceSettings(workspaceId, updates) {
  const allowed = {};
  if (updates.voiceAiEnabled !== undefined) allowed.voiceAiEnabled = updates.voiceAiEnabled;
  if (updates.voiceAiName !== undefined) allowed.voiceAiName = updates.voiceAiName;
  if (updates.voiceAiPrompt !== undefined) allowed.voiceAiPrompt = updates.voiceAiPrompt;
  if (updates.voiceAiPhone !== undefined) allowed.voiceAiPhone = updates.voiceAiPhone;
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: allowed,
    select: {
      voiceAiEnabled: true,
      voiceAiName: true,
      voiceAiPrompt: true,
      voiceAiPhone: true,
    },
  });
}
