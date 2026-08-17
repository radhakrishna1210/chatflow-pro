import { prisma } from '../lib/prisma.js';

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
 * convenience — a caller posting straight to the API would otherwise be able to
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
        // Only web URLs — a javascript: or data: value stored here would be
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
      if (digits.length < 7 || digits.length > 15) fail('must contain 7–15 digits');
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
export async function validateCustomFields(workspaceId, entity, incoming, existing = {}) {
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
