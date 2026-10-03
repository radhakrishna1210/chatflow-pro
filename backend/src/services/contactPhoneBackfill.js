import { toE164 } from '../lib/phone.js';

// Planning half of scripts/backfill-contact-phones.js, kept pure so it can be
// tested without a database.
//
// Contacts written before numbers were normalised hold "9876543210",
// "09876543210", "+91 98765 43210" and so on. Rewriting each to E.164 is safe
// unless two rows of the same workspace collapse onto one number: those are
// the same person stored twice, and which row survives (conversations, lead,
// opt-out state hang off each) is a decision for a person, not a script. So a
// collapsing group is reported and none of its rows is touched.

/**
 * @param {{ id: string, phoneNumber: string, name?: string }[]} contacts one workspace's contacts
 * @param {string} country the workspace's default phone country
 * @returns {{
 *   updates: { id: string, from: string, to: string }[],
 *   collisions: { phoneNumber: string, contacts: object[] }[],
 *   invalid: object[],
 * }}
 */
export function planPhoneBackfill(contacts, country) {
  const groups = new Map();
  const invalid = [];
  for (const c of contacts) {
    // Instagram-only contacts carry an "ig:" stand-in, not a phone number.
    if (String(c.phoneNumber).startsWith('ig:')) continue;
    const e164 = toE164(c.phoneNumber, { country });
    if (!e164) { invalid.push(c); continue; }
    if (!groups.has(e164)) groups.set(e164, []);
    groups.get(e164).push(c);
  }

  const updates = [];
  const collisions = [];
  for (const [phoneNumber, rows] of groups) {
    if (rows.length > 1) { collisions.push({ phoneNumber, contacts: rows }); continue; }
    const [row] = rows;
    if (row.phoneNumber !== phoneNumber) updates.push({ id: row.id, from: row.phoneNumber, to: phoneNumber });
  }
  return { updates, collisions, invalid };
}
