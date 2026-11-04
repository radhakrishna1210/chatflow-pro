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
// Headers that carry the contact's phone number. Sheets exported from other
// tools say "Mobile Number", "WhatsApp" or "PHONE"; only reading a few exact
// spellings dropped every row of such a sheet without counting it anywhere.
const PHONE_COLUMNS = [
  'phone', 'phonenumber', 'phone_number', 'phone_no', 'mobile', 'mobile_number', 'mobile_no',
  'mobilenumber', 'whatsapp', 'whatsapp_number', 'whatsapp_no', 'contact_number',
];

const BUILT_IN_COLUMNS = new Set([
  'name', ...PHONE_COLUMNS, 'email', 'tags',
]);

// Reads the built-in fields of one parsed row whatever the header's case or
// punctuation ("Phone Number", " PHONE ", "phone_number" all match).
export function builtInFields(row) {
  const byKey = new Map();
  for (const [header, value] of Object.entries(row || {})) {
    const key = toAttributeKey(header);
    if (!byKey.has(key) || !String(byKey.get(key) ?? '').trim()) byKey.set(key, value);
  }
  const pick = (keys) => {
    for (const key of keys) {
      const value = byKey.get(key);
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return '';
  };
  return {
    phone: pick(PHONE_COLUMNS),
    name: pick(['name']),
    email: pick(['email']),
    tags: pick(['tags']),
  };
}

// The delimiter a sheet uses, judged from its header line. Excel in many
// locales saves "CSV" with semicolons, and tab-separated exports are common;
// parsing those as comma-separated turned each row into one column, so the
// import found no phone column and quietly imported nothing.
export function detectDelimiter(text) {
  const firstLine = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch] += 1;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ',';
}

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
