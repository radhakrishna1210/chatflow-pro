
import { assertAddonCapacity, addonAllowance } from './addons.service.js';

// Custom fields and custom events ΓÇö the two add-ons that were sold while
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

// ΓöÇΓöÇΓöÇ Field definitions ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

  // The key is deliberately not editable ΓÇö see toKey. Only presentation is.
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

// ΓöÇΓöÇΓöÇ Values on a contact ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

// ΓöÇΓöÇΓöÇ Custom events ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

﻿import { prisma } from '../lib/prisma.js';

export const CUSTOM_FIELD_ENTITIES = ['lead', 'deal'];

export const CUSTOM_FIELD_TYPES = [
  'TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN',
  'DROPDOWN', 'MULTISELECT', 'URL', 'EMAIL', 'PHONE', 'USER',
];

const CHOICE_TYPES = ['DROPDOWN', 'MULTISELECT'];

// Machine key derived from the label once, at creation. Kept stable
// afterwards: renaming a label must never orphan the values already stored
// under the old key.
export function slugifyKey(label) {
  return String(label || '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates one value against its definition. Returns the value coerced to the
 * shape that will be stored, or throws with a message naming the field.
 *
 * Everything here runs on the server because the UI's field types are only a
 * convenience ΓÇö a caller posting straight to the API would otherwise be able to
 * put anything at all into a "dropdown".
 */
export function coerceValue(def, raw) {
  const fail = (msg) => { const e = new Error(`${def.label}: ${msg}`); e.status = 400; throw e; };

  const empty = raw === null || raw === undefined || raw === '' ||
    (Array.isArray(raw) && raw.length === 0);

  if (empty) {
    if (def.required) fail('this field is required');
    return null;
  }

  switch (def.type) {
    case 'NUMBER':
    case 'CURRENCY': {
      const n = Number(raw);
      if (!Number.isFinite(n)) fail('must be a number');
      return n;
    }

    case 'BOOLEAN': {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'false') return raw === 'true';
      fail('must be true or false');
      break;
    }

    case 'DATE': {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) fail('must be a valid date');
      return d.toISOString().slice(0, 10);
    }

    case 'EMAIL': {
      const s = String(raw).trim();
      if (!EMAIL_RE.test(s)) fail('must be a valid email address');
      return s;
    }

    case 'URL': {
      const s = String(raw).trim();
      try {
        const u = new URL(s);
        // Only web URLs ΓÇö a javascript: or data: value stored here would be
        // rendered as a link on the record page.
        if (!['http:', 'https:'].includes(u.protocol)) fail('must be an http or https URL');
        return u.toString();
      } catch {
        fail('must be a valid URL');
      }
      break;
    }

    case 'PHONE': {
      const digits = String(raw).replace(/[^\d]/g, '');
      if (digits.length < 7 || digits.length > 15) fail('must contain 7ΓÇô15 digits');
      return String(raw).trim();
    }

    case 'DROPDOWN': {
      const options = Array.isArray(def.options) ? def.options : [];
      const s = String(raw);
      if (!options.includes(s)) fail(`"${s}" is not one of the allowed options`);
      return s;
    }

    case 'MULTISELECT': {
      const options = Array.isArray(def.options) ? def.options : [];
      const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const bad = values.filter((v) => !options.includes(v));
      if (bad.length) fail(`${bad.join(', ')} ${bad.length === 1 ? 'is not an allowed option' : 'are not allowed options'}`);
      return [...new Set(values)];
    }

    case 'USER':
      // Membership is checked by the caller, which has the workspace id.
      return String(raw);

    case 'TEXTAREA': {
      const s = String(raw);
      if (s.length > 5000) fail('must be 5000 characters or fewer');
      return s;
    }

    case 'TEXT':
    default: {
      const s = String(raw);
      if (s.length > 500) fail('must be 500 characters or fewer');
      return s;
    }
  }
  return null;
}

export async function listDefinitions(workspaceId, entity, { includeInactive = false } = {}) {
  if (entity && !CUSTOM_FIELD_ENTITIES.includes(entity)) {
    const e = new Error(`entity must be one of: ${CUSTOM_FIELD_ENTITIES.join(', ')}`); e.status = 400; throw e;
  }
  const data = await prisma.customFieldDefinition.findMany({
    where: { workspaceId, ...(entity ? { entity } : {}), ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ entity: 'asc' }, { sortOrder: 'asc' }],
  });
  return { data, total: data.length };
}

/**
 * Validates a `customFields` payload for one record against the workspace's
 * definitions, and merges it over whatever is already stored.
 *
 * Unknown keys are rejected rather than silently kept: a typo would otherwise
 * sit invisibly in the JSON forever, and a caller could use the column as
 * unbounded storage.
 */
export async function validateCrmCustomFields(workspaceId, entity, incoming, existing = {}) {
  if (incoming === undefined) return undefined;
  if (incoming === null) return {};

  if (typeof incoming !== 'object' || Array.isArray(incoming)) {
    const e = new Error('customFields must be an object'); e.status = 400; throw e;
  }

  const { data: defs } = await listDefinitions(workspaceId, entity, { includeInactive: true });
  const byKey = new Map(defs.map((d) => [d.key, d]));

  const unknown = Object.keys(incoming).filter((k) => !byKey.has(k));
  if (unknown.length) {
    const e = new Error(`Unknown custom field(s): ${unknown.join(', ')}`); e.status = 400; throw e;
  }

  const merged = { ...(existing ?? {}) };
  const userIds = [];

  for (const [key, raw] of Object.entries(incoming)) {
    const def = byKey.get(key);
    const value = coerceValue(def, raw);
    if (def.type === 'USER' && value) userIds.push(value);
    if (value === null) delete merged[key];
    else merged[key] = value;
  }

  // A USER field must name someone in this workspace, or it becomes a way to
  // probe for user ids from other tenants.
  if (userIds.length) {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: userIds } },
      select: { userId: true },
    });
    const known = new Set(members.map((m) => m.userId));
    const missing = userIds.filter((u) => !known.has(u));
    if (missing.length) {
      const e = new Error('A user field names someone who is not a member of this workspace');
      e.status = 400;
      throw e;
    }
  }

  // Required fields must be present once the merge is complete, not merely
  // present in this particular request.
  for (const def of defs) {
    if (def.required && def.isActive && (merged[def.key] === undefined || merged[def.key] === null)) {
      const e = new Error(`${def.label}: this field is required`); e.status = 400; throw e;
    }
  }

  return merged;
}

export async function createDefinition(workspaceId, body) {
  if (!CUSTOM_FIELD_ENTITIES.includes(body.entity)) {
    const e = new Error(`entity must be one of: ${CUSTOM_FIELD_ENTITIES.join(', ')}`); e.status = 400; throw e;
  }

  const key = slugifyKey(body.key || body.label);
  if (!key) { const e = new Error('That label does not produce a usable field key'); e.status = 400; throw e; }

  if (CHOICE_TYPES.includes(body.type)) {
    const options = Array.isArray(body.options) ? body.options.map((o) => String(o).trim()).filter(Boolean) : [];
    if (options.length === 0) {
      const e = new Error(`A ${body.type.toLowerCase()} field needs at least one option`); e.status = 400; throw e;
    }
    body.options = [...new Set(options)];
  } else {
    body.options = null;
  }

  const clash = await prisma.customFieldDefinition.findFirst({
    where: { workspaceId, entity: body.entity, key }, select: { id: true },
  });
  if (clash) { const e = new Error('A field with that name already exists here'); e.status = 409; throw e; }

  const count = await prisma.customFieldDefinition.count({ where: { workspaceId, entity: body.entity } });

  return prisma.customFieldDefinition.create({
    data: {
      workspaceId, entity: body.entity, key, label: body.label, type: body.type || 'TEXT',
      options: body.options ?? undefined, helpText: body.helpText ?? null,
      required: body.required ?? false, sortOrder: count,
    },
  });
}

export async function updateDefinition(workspaceId, id, updates) {
  const def = await prisma.customFieldDefinition.findFirst({ where: { id, workspaceId } });
  if (!def) { const e = new Error('Custom field not found'); e.status = 404; throw e; }

  const data = { ...updates };
  // Neither the key nor the type can change: stored values are already shaped
  // by them, and a silent reinterpretation would corrupt existing records.
  delete data.key;
  delete data.entity;
  delete data.type;

  if (data.options !== undefined) {
    if (!CHOICE_TYPES.includes(def.type)) {
      delete data.options;
    } else {
      const options = Array.isArray(data.options) ? data.options.map((o) => String(o).trim()).filter(Boolean) : [];
      if (options.length === 0) {
        const e = new Error('A choice field needs at least one option'); e.status = 400; throw e;
      }
      data.options = [...new Set(options)];
    }
  }

  return prisma.customFieldDefinition.update({ where: { id }, data });
}

// Deactivating keeps historical values readable; deleting the definition would
// leave orphaned keys in every record's JSON with nothing to interpret them.
export async function deleteDefinition(workspaceId, id) {
  const def = await prisma.customFieldDefinition.findFirst({ where: { id, workspaceId } });
  if (!def) { const e = new Error('Custom field not found'); e.status = 404; throw e; }
  return prisma.customFieldDefinition.update({ where: { id }, data: { isActive: false } });
}
