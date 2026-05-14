import { prisma } from '../lib/prisma.js';
import { createMetaTemplate, deleteMetaTemplate, getWabaTemplates } from '../lib/meta.js';
import { decrypt } from '../lib/encryption.js';
import { TEMPLATE_LIBRARY, findLibraryTemplate } from '../data/templateLibrary.js';

export async function listTemplates(workspaceId) {
  const waNumber = await prisma.waNumber.findFirst({ where: { workspaceId } });
  if (!waNumber) return [];

  return prisma.template.findMany({
    where: { workspaceId },
    select: { id: true, name: true, category: true, language: true, status: true, components: true },
    orderBy: { createdAt: 'desc' },
  });
}

// Map Meta template status → local TemplateStatus enum
function mapStatus(metaStatus) {
  if (metaStatus === 'APPROVED') return 'APPROVED';
  if (metaStatus === 'REJECTED' || metaStatus === 'DISABLED') return 'REJECTED';
  return 'PENDING';
}

export async function syncTemplatesFromMeta(workspaceId) {
  const waNumber = await prisma.waNumber.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });
  if (!waNumber) {
    const e = new Error('No WhatsApp number connected. Connect a number before syncing templates.');
    e.status = 400;
    throw e;
  }

  const wabaId      = waNumber.wabaId;
  const accessToken = decrypt(waNumber.encryptedAccessToken);

  const metaTemplates = await getWabaTemplates(wabaId, accessToken);

  let created = 0, updated = 0;

  for (const mt of metaTemplates) {
    const existing = await prisma.template.findFirst({
      where: { workspaceId, metaTemplateId: mt.id },
    });

    const payload = {
      name:           mt.name,
      category:       mt.category,
      language:       mt.language,
      components:     mt.components ?? [],
      status:         mapStatus(mt.status),
      metaTemplateId: mt.id,
    };

    if (existing) {
      await prisma.template.update({ where: { id: existing.id }, data: payload });
      updated++;
    } else {
      await prisma.template.create({ data: { workspaceId, ...payload } });
      created++;
    }
  }

  return { total: metaTemplates.length, created, updated };
}

export async function createTemplate(workspaceId, { name, category, language, components }) {
  if (!name || !category || !language || !Array.isArray(components) || components.length === 0) {
    const e = new Error('name, category, language and components are required');
    e.status = 400;
    throw e;
  }

  const waNumber = await prisma.waNumber.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });
  if (!waNumber) {
    const e = new Error('Connect a WhatsApp number before creating templates.');
    e.status = 400;
    throw e;
  }
  const wabaId      = waNumber.wabaId;
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
    data: {
      workspaceId, name, category, language, components,
      metaTemplateId: metaResult?.id,
      status: 'PENDING',
    },
  });
}

export async function getTemplate(workspaceId, id) {
  const template = await prisma.template.findFirst({ where: { id, workspaceId } });
  if (!template) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }
  return template;
}

export async function updateTemplate(workspaceId, id, updates) {
  const template = await prisma.template.findFirst({ where: { id, workspaceId } });
  if (!template) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }

  if (template.status === 'REJECTED' && (updates.components || updates.name)) {
    const waNumber = await prisma.waNumber.findFirst({
      where: { workspaceId }, orderBy: { createdAt: 'desc' },
    });
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
  if (!template) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }

  if (template.metaTemplateId) {
    const waNumber = await prisma.waNumber.findFirst({
      where: { workspaceId }, orderBy: { createdAt: 'desc' },
    });
    if (waNumber) {
      await deleteMetaTemplate(
        waNumber.wabaId,
        template.metaTemplateId,
        decrypt(waNumber.encryptedAccessToken),
      ).catch(() => null);
    }
  }

  await prisma.template.delete({ where: { id } });
}

export async function duplicateTemplate(workspaceId, id) {
  const template = await prisma.template.findFirst({ where: { id, workspaceId } });
  if (!template) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }

  return prisma.template.create({
    data: {
      workspaceId,
      name: `${template.name}_copy`,
      category: template.category,
      language: template.language,
      components: template.components,
      status: 'PENDING',
    },
  });
}

export async function listLibrary(workspaceId) {
  const waNumber = await prisma.waNumber.findFirst({ where: { workspaceId } });
  if (!waNumber) {
    const e = new Error('Connect a WhatsApp number to browse the template library.');
    e.status = 400;
    throw e;
  }

  const installed = await prisma.template.findMany({
    where: { workspaceId },
    select: { name: true, status: true },
  });
  const installedByName = new Map(installed.map((t) => [t.name, t.status]));

  return TEMPLATE_LIBRARY.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    useCase: t.useCase,
    name: t.name,
    category: t.category,
    language: t.language,
    body: t.components.find((c) => c.type === 'BODY')?.text || '',
    installedStatus: installedByName.get(t.name) || null,
  }));
}

export async function installFromLibrary(workspaceId, libraryId) {
  const libTemplate = findLibraryTemplate(libraryId);
  if (!libTemplate) {
    const e = new Error('Library template not found');
    e.status = 404;
    throw e;
  }

  const existing = await prisma.template.findFirst({
    where: { workspaceId, name: libTemplate.name },
  });
  if (existing) {
    const e = new Error(`Template "${libTemplate.name}" is already installed.`);
    e.status = 409;
    throw e;
  }

  return createTemplate(workspaceId, {
    name: libTemplate.name,
    category: libTemplate.category,
    language: libTemplate.language,
    components: libTemplate.components,
  });
}
