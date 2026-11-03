// Contact attributes: per-contact values that arrive as extra columns in a
// contact CSV (price, city, order_id, …) and can fill a campaign template's
// variables.
//
// They are deliberately separate from Contact.customFields. Custom fields are
// a paid add-on with typed, pre-declared definitions; attributes are whatever
// the uploaded sheet carried, stored as text, so a sheet with a "price" column
// works without any setup.

// Columns the importer already maps onto Contact itself. Compared after
// normalising, so "Phone Number", "phone_number" and "PHONE" all match.
const BUILT_IN_COLUMNS = new Set([
  'name', 'phone', 'phonenumber', 'phone_number', 'mobile', 'email', 'tags',
]);

export const MAX_ATTRIBUTES = 30;
const MAX_VALUE_LENGTH = 500;

// "Price (₹)" → "price", "Order ID" → "order_id". Stable, so the same sheet
// uploaded twice lands on the same keys and a campaign mapped to "price" keeps
// working after a re-import.
export function toAttributeKey(header) {
  return String(header ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export const isBuiltInColumn = (header) => BUILT_IN_COLUMNS.has(toAttributeKey(header));

// The extra columns of one CSV row as { key: value }. Empty cells are left out
// so a blank cell never overwrites a value an earlier import stored.
export function attributesFromRow(row) {
  const out = {};
  for (const [header, raw] of Object.entries(row || {})) {
    if (isBuiltInColumn(header)) continue;
    const key = toAttributeKey(header);
    if (!key) continue;
    const value = String(raw ?? '').trim();
    if (!value) continue;
    if (Object.keys(out).length >= MAX_ATTRIBUTES && !(key in out)) continue;
    out[key] = value.slice(0, MAX_VALUE_LENGTH);
  }
  return out;
}

// Validates a { key: value } patch from the API (contact create/edit).
// A null or empty value removes the key.
export function normalizeAttributePatch(values) {
  if (values == null) return undefined;
  if (typeof values !== 'object' || Array.isArray(values)) {
    const e = new Error('attributes must be an object of values'); e.status = 400; throw e;
  }
  const set = {};
  const remove = [];
  for (const [rawKey, raw] of Object.entries(values)) {
    const key = toAttributeKey(rawKey);
    if (!key) continue;
    if (raw === null || String(raw).trim() === '') { remove.push(key); continue; }
    set[key] = String(raw).trim().slice(0, MAX_VALUE_LENGTH);
  }
  return { set, remove };
}

export function mergeAttributes(existing, { set = {}, remove = [] } = {}) {
  const next = { ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}), ...set };
  for (const key of remove) delete next[key];
  if (Object.keys(next).length > MAX_ATTRIBUTES) {
    const e = new Error(`A contact can hold at most ${MAX_ATTRIBUTES} extra columns`); e.status = 400; throw e;
  }
  return next;
}
