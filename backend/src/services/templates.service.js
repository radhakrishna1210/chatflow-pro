import { prisma } from '../lib/prisma.js';
import { createMetaTemplate, deleteMetaTemplate, getWabaTemplates, uploadTemplateMedia } from '../lib/meta.js';
import { decrypt } from '../lib/encryption.js';
import { TEMPLATE_LIBRARY, findLibraryTemplate } from '../data/templateLibrary.js';
import { normalizeTemplateComponents, detectTemplateType, toMetaComponents, preserveInternalFields } from '../lib/templateStructure.js';
import { storeAsset } from './templateImage.service.js';

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
// `status: 'DELETED'` asks for the recycle bin instead; anything else lists the
// live templates. Deleted rows are tombstones — kept so campaigns that
// reference them still resolve, and so they can be restored.
export async function listTemplates(workspaceId, waNumberId, { status = null } = {}) {
  const deletedOnly = String(status || '').toUpperCase() === 'DELETED';
  const where = {
    workspaceId,
    status: deletedOnly ? 'DELETED' : { not: 'DELETED' },
    ...(waNumberId ? { waNumberId } : {}),
  };
  const templates = await prisma.template.findMany({
    where,
    select: {
      id: true, name: true, category: true, language: true, status: true, components: true,
      // Meta's rejection reason, so a REJECTED template can say why.
      rejectedReason: true,
      waNumberId: true, metaTemplateId: true, aiGenerated: true, createdAt: true,
      previousCategory: true, categoryUpdatedAt: true,
      // For a tombstone this is when it was deleted — the status change is the
      // last write a deleted template ever gets, so it needs no own column.
      updatedAt: true,
    },
    // Newest deletions first in the bin; newest creations first otherwise.
    orderBy: deletedOnly ? { updatedAt: 'desc' } : { createdAt: 'desc' },
  });
  // Standard/catalog/carousel is not a stored column — see lib/templateStructure.js.
  return templates.map((t) => ({ ...t, templateType: detectTemplateType(t.components) }));
}

function mapStatus(metaStatus) {
  if (metaStatus === 'APPROVED') return 'APPROVED';
  if (metaStatus === 'REJECTED' || metaStatus === 'DISABLED') return 'REJECTED';
  // Meta keeps returning a template for a while after it is deleted, with this
  // status. Without a case for it, it fell through to PENDING below — which is
  // how a template deleted here came back looking like it was awaiting review.
  if (metaStatus === 'DELETED') return 'DELETED';
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
  const seenMetaIds = [];

  for (const mt of metaTemplates) {
    seenMetaIds.push(String(mt.id));
    const existing = await prisma.template.findFirst({
      where: { workspaceId, waNumberId: waNumber.id, metaTemplateId: mt.id },
    });
    const rejectedReason = mt.rejected_reason || null;
    // Meta's copy is authoritative about the approved shape, but it has never
    // seen this product's own bookkeeping — a carousel card's `_assetId`, a
    // catalog button's SKU. Taking mt.components verbatim dropped those, which
    // is what made a previously synced carousel lose its images in the editor
    // and fail its next send. Merged instead, so sync is idempotent.
    const payload = {
      name: mt.name, category: mt.category, language: mt.language,
      components: preserveInternalFields(existing?.components, mt.components ?? []),
      status: mapStatus(mt.status), metaTemplateId: mt.id,
      rejectedReason: mapStatus(mt.status) === 'REJECTED' ? rejectedReason : null,
    };
    if (existing) {
      // A template deleted here stays deleted, even though Meta still lists it.
      //
      // Deleting is a local decision and the Meta call behind it can fail (it
      // is best-effort — see deleteTemplate), so Meta returning the template is
      // not evidence the user changed their mind. Overwriting the tombstone
      // with Meta's status is what made deleted templates reappear on the next
      // sync. The content is still refreshed, so a later restore brings back
      // the current version rather than a stale one.
      const data = existing.status === 'DELETED'
        ? { ...payload, status: 'DELETED' }
        : payload;
      await prisma.template.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.template.create({ data: { workspaceId, waNumberId: waNumber.id, ...payload } });
      created++;
    }
  }

  // Anything on this number that Meta no longer returns was deleted there, so
  // mirror the deletion locally. Only rows that were sourced from Meta
  // (metaTemplateId set) are eligible — locally drafted templates that have not
  // been submitted yet must survive a sync.
  const removed = await removeTemplatesMissingFromMeta(workspaceId, waNumber.id, seenMetaIds);

  return { total: metaTemplates.length, created, updated, removed };
}

// Deletes local templates absent from Meta. Rows referenced by a campaign can't
// be hard-deleted (the FK is restrict, and campaign history must stay intact),
// so those are tombstoned as DELETED instead — either way they stop appearing.
async function removeTemplatesMissingFromMeta(workspaceId, waNumberId, seenMetaIds) {
  const stale = await prisma.template.findMany({
    where: {
      workspaceId,
      waNumberId,
      metaTemplateId: { not: null, notIn: seenMetaIds },
      status: { not: 'DELETED' },
    },
    select: { id: true },
  });
  if (stale.length === 0) return 0;

  // Tombstoned, not removed, for the same reason deleteTemplate tombstones: a
  // template that vanished from Meta is exactly the case someone may want to
  // restore, and a deleted row cannot be restored.
  await prisma.template.updateMany({
    where: { id: { in: stale.map((t) => t.id) } },
    data: { status: 'DELETED' },
  });
  return stale.length;
}

// Uploads a header image/video/document sample and returns the handle the
// template must carry. Done as its own step (rather than inside createTemplate)
// so the builder can show a preview and validate the file before the user
// commits to submitting the template to Meta.
export async function uploadHeaderMedia(workspaceId, { buffer, mimeType, fileName, waNumberId, prompt = null, source = 'upload', existingAssetId = null }) {
  if (!buffer?.length) { const e = new Error('No file was uploaded'); e.status = 400; throw e; }
  const waNumber = await resolveWaNumber(workspaceId, waNumberId);
  const accessToken = decrypt(waNumber.encryptedAccessToken);
  const { handle, format } = await uploadTemplateMedia({ buffer, mimeType, fileName, accessToken });

  // The handle Meta just returned is review-only and cannot be sent, so an
  // IMAGE header also keeps its bytes — that copy is what every later campaign
  // send re-uploads as real media. Videos and PDFs are review-only headers in
  // this product and aren't re-sent, so they aren't stored.
  let assetId = existingAssetId;
  if (format === 'IMAGE' && !assetId) {
    const asset = await storeAsset(workspaceId, { buffer, mimeType, prompt, source });
    assetId = asset.id;
  }

  return { handle, format, assetId, fileName: fileName || null, sizeBytes: buffer.length };
}

export async function createTemplate(workspaceId, { name, category, language, components, waNumberId, headerAssetId }) {
  if (!name || !category || !language || !Array.isArray(components) || components.length === 0) {
    const e = new Error('name, category, language and components are required'); e.status = 400; throw e;
  }
  // Meta rejects the whole template over one bad button or a card that does not
  // match its siblings, and reports it hours later as an opaque review failure
  // — so the whole structure is validated against the category up front.
  const safeComponents = normalizeTemplateComponents(category, components);

  const waNumber = await resolveWaNumber(workspaceId, waNumberId);
  const wabaId = waNumber.wabaId;
  const accessToken = decrypt(waNumber.encryptedAccessToken);

  let metaResult;
  try {
    metaResult = await createMetaTemplate(wabaId, { name, category, language, components: toMetaComponents(safeComponents) }, accessToken);
  } catch (err) {
    const m = err.response?.data?.error;
    const reason = m ? `${m.message}${m.error_user_msg ? ' — ' + m.error_user_msg : ''} (code ${m.code}${m.error_subcode ? '/' + m.error_subcode : ''})` : err.message;
    const e = new Error(`Meta rejected the template: ${reason}`);
    e.status = err.response?.status || 400;
    throw e;
  }

  // Only bind an asset this workspace actually owns — the id arrives from the
  // client alongside the components.
  let assetId = null;
  if (headerAssetId) {
    const owned = await prisma.templateAsset.findFirst({
      where: { id: headerAssetId, workspaceId },
      select: { id: true },
    });
    assetId = owned?.id ?? null;
  }

  return prisma.template.create({
    data: {
      workspaceId, waNumberId: waNumber.id, name, category, language,
      components: safeComponents, metaTemplateId: metaResult?.id, status: 'PENDING',
      headerAssetId: assetId,
    },
  });
}

export async function getTemplate(workspaceId, id) {
  const template = await prisma.template.findFirst({ where: { id, workspaceId } });
  if (!template) { const err = new Error('Template not found'); err.status = 404; throw err; }
  return { ...template, templateType: detectTemplateType(template.components) };
}

export async function updateTemplate(workspaceId, id, updates) {
  const template = await prisma.template.findFirst({ where: { id, workspaceId } });
  if (!template) { const err = new Error('Template not found'); err.status = 404; throw err; }

  // Never allow the number binding to be mutated via update.
  delete updates.waNumberId;

  // A resubmitted template goes through the same structural checks as a new
  // one, so an edit cannot smuggle past what create would have rejected.
  if (updates.components) {
    updates.components = normalizeTemplateComponents(updates.category || template.category, updates.components);
  }

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
        components: toMetaComponents(updates.components || template.components),
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
  // Always a tombstone, never a hard delete.
  //
  // Hard-deleting a template no campaign referenced left nothing behind, so
  // there was nothing to show in the deleted list and nothing to restore — and
  // if the Meta call above failed, the next sync simply re-created it as a new
  // template. A tombstone is the record of the user's intent, which is what
  // both the recycle bin and the sync guard are built on.
  await prisma.template.update({ where: { id }, data: { status: 'DELETED' } });
}

// Brings a deleted template back.
//
// The tombstone may or may not still have a counterpart on Meta: the delete
// call is best-effort, and Meta also purges deleted templates on its own
// schedule. So this reconciles rather than assuming — adopting Meta's copy when
// there is one, and resubmitting for review when there is not. Restoring to a
// state where the template is visible but unsendable would be the worst of
// both.
export async function restoreTemplate(workspaceId, id) {
  const template = await prisma.template.findFirst({ where: { id, workspaceId } });
  if (!template) { const err = new Error('Template not found'); err.status = 404; throw err; }
  if (template.status !== 'DELETED') return template;

  const waNumber = template.waNumberId
    ? await prisma.waNumber.findFirst({ where: { id: template.waNumberId, workspaceId } })
    : await resolveWaNumber(workspaceId, null, { required: false });

  // With no number to talk to Meta through, the row can still come back — it
  // just returns as a draft the user can resubmit once a number is connected.
  if (!waNumber) {
    return prisma.template.update({ where: { id }, data: { status: 'PENDING' } });
  }

  const accessToken = decrypt(waNumber.encryptedAccessToken);

  // Match on name + language rather than the stored metaTemplateId: a template
  // deleted and recreated on Meta keeps its name but gets a new id.
  let live = null;
  try {
    const metaTemplates = await getWabaTemplates(waNumber.wabaId, accessToken);
    live = metaTemplates.find(
      (mt) => mt.name === template.name && mt.language === template.language
        && String(mt.status).toUpperCase() !== 'DELETED',
    ) ?? null;
  } catch {
    // Meta unreachable — fall through to resubmitting, which is the safe
    // direction: a duplicate submission is rejected with a clear message,
    // whereas assuming it is live would restore something that cannot send.
  }

  if (live) {
    return prisma.template.update({
      where: { id },
      data: {
        name: live.name, category: live.category, language: live.language,
        components: preserveInternalFields(template.components, live.components ?? template.components),
        status: mapStatus(live.status), metaTemplateId: live.id,
      },
    });
  }

  // Gone from Meta: resubmit the stored components through the same path a new
  // template takes, so the restored one is reviewed like any other.
  let metaResult;
  try {
    metaResult = await createMetaTemplate(
      waNumber.wabaId,
      {
        name: template.name, category: template.category, language: template.language,
        components: toMetaComponents(template.components),
      },
      accessToken,
    );
  } catch (err) {
    const m = err.response?.data?.error;
    const reason = m ? `${m.message}${m.error_user_msg ? ' — ' + m.error_user_msg : ''}` : err.message;
    const e = new Error(`Could not resubmit this template to Meta: ${reason}`);
    e.status = err.response?.status || 400;
    throw e;
  }

  return prisma.template.update({
    where: { id },
    data: { status: 'PENDING', metaTemplateId: metaResult?.id ?? template.metaTemplateId },
  });
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
  const installed = await prisma.template.findMany({ where: { workspaceId, status: { not: 'DELETED' } }, select: { name: true, status: true } });
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
  const existing = await prisma.template.findFirst({ where: { workspaceId, waNumberId: waNumber.id, name: libTemplate.name, status: { not: 'DELETED' } } });
  if (existing) { const e = new Error(`Template "${libTemplate.name}" is already installed on this number.`); e.status = 409; throw e; }

  return createTemplate(workspaceId, {
    name: libTemplate.name, category: libTemplate.category, language: libTemplate.language,
    components: libTemplate.components, waNumberId: waNumber.id,
  });
}
