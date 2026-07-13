import { prisma } from '../lib/prisma.js';
import { createMetaTemplate, deleteMetaTemplate, getWabaTemplates } from '../lib/meta.js';
import { decrypt } from '../lib/encryption.js';
import { TEMPLATE_LIBRARY, findLibraryTemplate } from '../data/templateLibrary.js';

// Resolve which WhatsApp number a template operation targets. Templates are
// private per number, so:
//  - if waNumberId is given, verify it belongs to the workspace and use it;
//  - if omitted and the workspace has exactly one number, use that;
//  - if omitted and there are multiple numbers, that's ambiguous → 400.
async function resolveWaNumber(workspaceId, waNumberId, { required = true } = {}) {
  if (waNumberId) {
    const n = await prisma.waNumber.findFirst({ where: { id: waNumberId, workspaceId } });
    if (!n) { const e = new Error('WhatsApp number not found in this workspace'); e.status = 404; throw e; }
    return n;
  }
  const numbers = await prisma.waNumber.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
  if (numbers.length === 0) {
    if (!required) return null;
    const e = new Error('Connect a WhatsApp number first.'); e.status = 400; throw e;
  }
  if (numbers.length === 1) return numbers[0];
  const e = new Error('This workspace has multiple numbers — specify waNumberId.'); e.status = 400; throw e;
}

// List templates. When waNumberId is provided, only that number's templates are
// returned (per-number privacy). Without it, returns all workspace templates
// (used by pickers that group by number themselves).
export async function listTemplates(workspaceId, waNumberId) {
  const where = { workspaceId, ...(waNumberId ? { waNumberId } : {}) };
  return prisma.template.findMany({
    where,
    select: { id: true, name: true, category: true, language: true, status: true, components: true, waNumberId: true, metaTemplateId: true, aiGenerated: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

function mapStatus(metaStatus) {
  if (metaStatus === 'APPROVED') return 'APPROVED';
  if (metaStatus === 'REJECTED' || metaStatus === 'DISABLED') return 'REJECTED';
  return 'PENDING';
}

// Sync templates for a SPECIFIC number's WABA. Each synced template is tagged
// with that number's id, so numbers on different WABAs never conflate.
export async function syncTemplatesFromMeta(workspaceId, waNumberId) {
  const waNumber = await resolveWaNumber(workspaceId, waNumberId);
  const wabaId = waNumber.wabaId;
  const accessToken = decrypt(waNumber.encryptedAccessToken);

  const metaTemplates = await getWabaTemplates(wabaId, accessToken);
  let created = 0, updated = 0;

  for (const mt of metaTemplates) {
    const existing = await prisma.template.findFirst({
      where: { workspaceId, waNumberId: waNumber.id, metaTemplateId: mt.id },
    });
    const payload = {
      name: mt.name, category: mt.category, language: mt.language,
      components: mt.components ?? [], status: mapStatus(mt.status), metaTemplateId: mt.id,
    };
    if (existing) {
      await prisma.template.update({ where: { id: existing.id }, data: payload });
      updated++;
    } else {
      await prisma.template.create({ data: { workspaceId, waNumberId: waNumber.id, ...payload } });
      created++;
    }
  }
  return { total: metaTemplates.length, created, updated };
}

export async function createTemplate(workspaceId, { name, category, language, components, waNumberId }) {
  if (!name || !category || !language || !Array.isArray(components) || components.length === 0) {
    const e = new Error('name, category, language and components are required'); e.status = 400; throw e;
  }
  const waNumber = await resolveWaNumber(workspaceId, waNumberId);
  const wabaId = waNumber.wabaId;
  const accessToken = decrypt(waNumber.encryptedAccessToken);

  let metaResult;
  try {
    metaResult = await createMetaTemplate(wabaId, { name, category, language, components }, accessToken);
  } catch (err) {
    const m = err.response?.data?.error;
    const reason = m ? `${m.message}${m.error_user_msg ? ' — ' + m.error_user_msg : ''} (code ${m.code}${m.error_subcode ? '/' + m.error_subcode : ''})` : err.message;
    const e = new Error(`Meta rejected the template: ${reason}`);
    e.status = err.response?.status || 400;
    throw e;
  }

  return prisma.template.create({
    data: { workspaceId, waNumberId: waNumber.id, name, category, language, components, metaTemplateId: metaResult?.id, status: 'PENDING' },
  });
}

export async function getTemplate(workspaceId, id) {
  const template = await prisma.template.findFirst({ where: { id, workspaceId } });
  if (!template) { const err = new Error('Template not found'); err.status = 404; throw err; }
  return template;
}

export async function updateTemplate(workspaceId, id, updates) {
  const template = await prisma.template.findFirst({ where: { id, workspaceId } });
  if (!template) { const err = new Error('Template not found'); err.status = 404; throw err; }

  // Never allow the number binding to be mutated via update.
  delete updates.waNumberId;

  if (template.status === 'REJECTED' && (updates.components || updates.name)) {
    // Resubmit against THIS template's own number, not "the newest number".
    const waNumber = template.waNumberId
      ? await prisma.waNumber.findFirst({ where: { id: template.waNumberId, workspaceId } })
      : await resolveWaNumber(workspaceId, null, { required: false });
    if (waNumber) {
      await createMetaTemplate(waNumber.wabaId, {
        name: updates.name || template.name,
        category: updates.category || template.category,
        language: updates.language || template.language,
        components: updates.components || template.components,
      }, decrypt(waNumber.encryptedAccessToken)).catch(() => null);
    }
    updates.status = 'PENDING';
  }
  return prisma.template.update({ where: { id }, data: updates });
}

export async function deleteTemplate(workspaceId, id) {
  const template = await prisma.template.findFirst({ where: { id, workspaceId } });
  if (!template) { const err = new Error('Template not found'); err.status = 404; throw err; }

  if (template.metaTemplateId) {
    // Delete from THIS template's own number's WABA.
    const waNumber = template.waNumberId
      ? await prisma.waNumber.findFirst({ where: { id: template.waNumberId, workspaceId } })
      : await resolveWaNumber(workspaceId, null, { required: false });
    if (waNumber) {
      await deleteMetaTemplate(waNumber.wabaId, template.metaTemplateId, decrypt(waNumber.encryptedAccessToken)).catch(() => null);
    }
  }
  await prisma.template.delete({ where: { id } });
}

export async function duplicateTemplate(workspaceId, id) {
  const template = await prisma.template.findFirst({ where: { id, workspaceId } });
  if (!template) { const err = new Error('Template not found'); err.status = 404; throw err; }

  return prisma.template.create({
    data: {
      workspaceId, waNumberId: template.waNumberId,
      name: `${template.name}_copy`, category: template.category, language: template.language,
      components: template.components, status: 'PENDING',
    },
  });
}

export async function listLibrary(workspaceId) {
  const installed = await prisma.template.findMany({ where: { workspaceId }, select: { name: true, status: true } });
  const installedByName = new Map(installed.map((t) => [t.name, t.status]));
  return TEMPLATE_LIBRARY.map((t) => ({
    id: t.id, title: t.title, description: t.description, useCase: t.useCase,
    name: t.name, category: t.category, language: t.language,
    body: t.components.find((c) => c.type === 'BODY')?.text || '',
    installedStatus: installedByName.get(t.name) || null,
  }));
}

export async function installFromLibrary(workspaceId, libraryId, waNumberId) {
  const libTemplate = findLibraryTemplate(libraryId);
  if (!libTemplate) { const e = new Error('Library template not found'); e.status = 404; throw e; }

  const waNumber = await resolveWaNumber(workspaceId, waNumberId);
  const existing = await prisma.template.findFirst({ where: { workspaceId, waNumberId: waNumber.id, name: libTemplate.name } });
  if (existing) { const e = new Error(`Template "${libTemplate.name}" is already installed on this number.`); e.status = 409; throw e; }

  return createTemplate(workspaceId, {
    name: libTemplate.name, category: libTemplate.category, language: libTemplate.language,
    components: libTemplate.components, waNumberId: waNumber.id,
  });
}
