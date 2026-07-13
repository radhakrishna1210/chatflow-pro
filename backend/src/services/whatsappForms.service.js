// WhatsApp Forms service
import { prisma } from '../lib/prisma.js';

export async function listForms(workspaceId) {
  return prisma.whatsappForm.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}

export async function createForm(workspaceId, { name, fields = 1 }) {
  return prisma.whatsappForm.create({ data: { workspaceId, name, fields } });
}

export async function updateForm(workspaceId, formId, updates) {
  const form = await prisma.whatsappForm.findFirst({ where: { id: formId, workspaceId } });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }
  return prisma.whatsappForm.update({ where: { id: formId }, data: updates });
}

export async function deleteForm(workspaceId, formId) {
  const form = await prisma.whatsappForm.findFirst({ where: { id: formId, workspaceId } });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }
  await prisma.whatsappForm.delete({ where: { id: formId } });
}
