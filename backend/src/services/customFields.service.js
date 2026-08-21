import { prisma } from '../lib/prisma.js';
import { assertAddonCapacity, addonAllowance } from './addons.service.js';

// Custom fields and custom events — the two add-ons that were sold while
// nothing implemented them.
//
// Both are metered against what the workspace has actually paid for
// (services/addons.service.js#assertAddonCapacity), which is the half that was
// missing: purchases activated a row and granted no capability at all.

const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT'];

// A stable machine name derived from the label, used as the key inside
// Contact.customFields. Derived once at creation and never regenerated, so
// renaming a field's label cannot orphan the values already stored under it.
function toKey(label) {
  const key = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!key) {
    const e = new Error('That label has no letters or numbers to make a field name from.');
    e.status = 400;
    throw e;
  }
  return key;
}

// ─── Field definitions ───────────────────────────────────────────────────────

export async function listCustomFields(workspaceId) {
  const [fields, allowed] = await Promise.all([
    prisma.workspaceCustomField.findMany({
      where: { workspaceId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    addonAllowance(workspaceId, 'customFields'),
  ]);
  // The allowance rides along so the screen can say "3 of 5 used" and disable
  // the button with a reason, rather than letting the user fill in a form that
  // is going to be refused.
  return { fields, allowed, used: fields.length, types: FIELD_TYPES };
}

export async function createCustomField(workspaceId, { label, type = 'TEXT', options = null } = {}) {
  const trimmed = String(label || '').trim();
  if (!trimmed) { const e = new Error('A field label is required'); e.status = 400; throw e; }
  if (!FIELD_TYPES.includes(type)) {
    const e = new Error(`Field type must be one of ${FIELD_TYPES.join(', ')}`); e.status = 400; throw e;
  }
  if (type === 'SELECT' && (!Array.isArray(options) || options.length === 0)) {
    const e = new Error('A dropdown field needs at least one option'); e.status = 400; throw e;
  }

  const used = await prisma.workspaceCustomField.count({ where: { workspaceId } });
  await assertAddonCapacity(workspaceId, 'customFields', used);

  const key = toKey(trimmed);
  const clash = await prisma.workspaceCustomField.findUnique({
    where: { workspaceId_key: { workspaceId, key } },
  });
  if (clash) { const e = new Error(`A field called "${clash.label}" already exists`); e.status = 409; throw e; }

  return prisma.workspaceCustomField.create({
    data: {
      workspaceId, key, label: trimmed.slice(0, 60), type,
      options: type === 'SELECT' ? options.map((o) => String(o).slice(0, 60)).slice(0, 40) : null,
      sortOrder: used,
    },
  });
}

export async function updateCustomField(workspaceId, id, { label, options } = {}) {
  const field = await prisma.workspaceCustomField.findFirst({ where: { id, workspaceId } });
  if (!field) { const e = new Error('Field not found'); e.status = 404; throw e; }

  // The key is deliberately not editable — see toKey. Only presentation is.
  const data = {};
  if (typeof label === 'string' && label.trim()) data.label = label.trim().slice(0, 60);
  if (field.type === 'SELECT' && Array.isArray(options)) {
    data.options = options.map((o) => String(o).slice(0, 60)).slice(0, 40);
  }
  return prisma.workspaceCustomField.update({ where: { id }, data });
}

export async function deleteCustomField(workspaceId, id) {
  const field = await prisma.workspaceCustomField.findFirst({ where: { id, workspaceId } });
  if (!field) { const e = new Error('Field not found'); e.status = 404; throw e; }
  await prisma.workspaceCustomField.delete({ where: { id } });
  // Stored values are deliberately left on the contacts. Deleting a definition
  // is usually a mistake being corrected, and silently rewriting every contact
  // row to drop the data is not recoverable; an orphaned key is simply ignored
  // by validateCustomFields below.
  return { ok: true, key: field.key };
}

// ─── Values on a contact ─────────────────────────────────────────────────────

// Checks a { key: value } object against the workspace's definitions and
// returns what should be stored. Unknown keys are refused rather than silently
// dropped, so a typo in an integration surfaces instead of losing data.
export async function validateCustomFields(workspaceId, values) {
  if (values == null) return undefined;
  if (typeof values !== 'object' || Array.isArray(values)) {
    const e = new Error('customFields must be an object of field values'); e.status = 400; throw e;
  }

  const defs = await prisma.workspaceCustomField.findMany({ where: { workspaceId } });
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out = {};

  for (const [key, raw] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) {
      const e = new Error(`"${key}" is not a custom field on this workspace`);
      e.status = 400;
      throw e;
    }
    if (raw === null || raw === '') continue; // clearing a value

    if (def.type === 'NUMBER') {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        const e = new Error(`${def.label} must be a number`); e.status = 400; throw e;
      }
      out[key] = n;
    } else if (def.type === 'DATE') {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        const e = new Error(`${def.label} must be a date`); e.status = 400; throw e;
      }
      out[key] = d.toISOString().slice(0, 10);
    } else if (def.type === 'SELECT') {
      const allowed = Array.isArray(def.options) ? def.options : [];
      if (!allowed.includes(String(raw))) {
        const e = new Error(`${def.label} must be one of: ${allowed.join(', ')}`); e.status = 400; throw e;
      }
      out[key] = String(raw);
    } else {
      out[key] = String(raw).slice(0, 500);
    }
  }
  return out;
}

// ─── Custom events ───────────────────────────────────────────────────────────

export async function listCustomEvents(workspaceId) {
  const [events, allowed] = await Promise.all([
    prisma.workspaceCustomEvent.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }),
    addonAllowance(workspaceId, 'customEvents'),
  ]);
  return { events, allowed, used: events.length };
}

export async function createCustomEvent(workspaceId, { label, description } = {}) {
  const trimmed = String(label || '').trim();
  if (!trimmed) { const e = new Error('An event name is required'); e.status = 400; throw e; }

  const used = await prisma.workspaceCustomEvent.count({ where: { workspaceId } });
  await assertAddonCapacity(workspaceId, 'customEvents', used);

  const key = toKey(trimmed);
  const clash = await prisma.workspaceCustomEvent.findUnique({
    where: { workspaceId_key: { workspaceId, key } },
  });
  if (clash) { const e = new Error(`An event called "${clash.label}" already exists`); e.status = 409; throw e; }

  return prisma.workspaceCustomEvent.create({
    data: {
      workspaceId, key, label: trimmed.slice(0, 60),
      description: description ? String(description).slice(0, 200) : null,
    },
  });
}

export async function deleteCustomEvent(workspaceId, id) {
  const event = await prisma.workspaceCustomEvent.findFirst({ where: { id, workspaceId } });
  if (!event) { const e = new Error('Event not found'); e.status = 404; throw e; }
  await prisma.workspaceCustomEvent.delete({ where: { id } });
  return { ok: true };
}

// Records an occurrence and fans it out to the workspace's webhook. This is the
// whole point of the add-on: "track external triggers and coordinate custom
// actions via webhook".
export async function recordCustomEvent(workspaceId, key, payload = {}) {
  const event = await prisma.workspaceCustomEvent.findUnique({
    where: { workspaceId_key: { workspaceId, key: String(key || '').trim() } },
  });
  if (!event) {
    const e = new Error(`"${key}" is not a registered event. Define it under Settings first.`);
    e.status = 404;
    e.expose = true;
    throw e;
  }

  await prisma.workspaceCustomEvent.update({
    where: { id: event.id },
    data: { seenCount: { increment: 1 }, lastSeenAt: new Date() },
  }).catch(() => {});

  const { emitWebhook } = await import('./outgoingWebhook.service.js');
  emitWebhook(workspaceId, 'custom.event', { key: event.key, label: event.label, payload });

  return { ok: true, key: event.key, delivered: 'queued' };
}
