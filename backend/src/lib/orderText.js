// Small pure helpers for owner-approved orders (services/formOrder.service.js):
// how an order is written out in a message, how a button names its order, how
// the owner's revised quantities are read, and the cutoff clock.

// "How many 10 kg boxes of White Button Mushroom?" → "10 kg boxes of White
// Button Mushroom". Questions are written for asking; a summary line reads
// better without the asking.
export const shortLabel = (label) =>
  String(label ?? '').trim().replace(/^how many\s+/i, '').replace(/\?+$/, '').trim();

const quantity = (value) => {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// 12 → "12", 2.5 → "2.5"
export const showNumber = (n) => String(Math.round(Number(n) * 100) / 100);

// ₹ amounts with Indian digit grouping: 5950 → "5,950".
export const rupees = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const numberFields = (fields) => (Array.isArray(fields) ? fields : []).filter((f) => f?.type === 'number');

/** One line per item actually ordered: "• 10 kg boxes of White Button Mushroom: 5". */
export function itemLines(fields, answers) {
  return numberFields(fields)
    .filter((f) => quantity(answers?.[f.key]) > 0)
    .map((f) => `• ${shortLabel(f.label)}: ${showNumber(quantity(answers[f.key]))}`);
}

/** The typed answers (address, name, …): "Delivery address for this order: Baner". */
export function detailLines(fields, answers) {
  return (Array.isArray(fields) ? fields : [])
    .filter((f) => ['text', 'email', 'phone'].includes(f?.type))
    .map((f) => [f, String(answers?.[f.key] ?? '').trim()])
    .filter(([, value]) => value)
    .map(([f, value]) => `${shortLabel(f.label)}: ${value}`);
}

/**
 * The owner's revised quantities, one per quantity question in the form's
 * order: "3, 0, 5", "3 0 5" or "3,0,5". Null unless there is exactly one
 * non-negative number per question.
 */
export function parseQuantities(text, count) {
  const parts = String(text ?? '').trim().split(/[\s,;/]+/).filter(Boolean);
  if (count < 1 || parts.length !== count) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  return parts.map(Number);
}

// A button's id: which order, and what to do with it.
export const actionId = (orderId, action) => `ord:${orderId}:${action}`;

export function parseAction(payload) {
  const match = /^ord:([A-Za-z0-9_-]+):([a-z]+)$/.exec(String(payload ?? ''));
  return match ? { orderId: match[1], action: match[2] } : null;
}

const digits = (value) => String(value ?? '').replace(/\D/g, '');

/** Same WhatsApp number, however each was written ("+91 92263…", "9192263…"). */
export function samePhone(a, b) {
  const x = digits(a);
  const y = digits(b);
  return x.length >= 7 && x === y;
}

export const isCutoffTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ''));

/**
 * Is it past the day's cutoff ("HH:MM") in the given timezone? Orders are
 * closed from the cutoff until midnight there. No cutoff, or a clock that
 * cannot be read, never closes orders.
 */
export function pastCutoff(cutoff, timezone, now = new Date()) {
  if (!isCutoffTime(cutoff)) return false;
  try {
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now);
    // "24:05" is how some runtimes write just after midnight.
    return local.replace(/^24/, '00') >= cutoff;
  } catch {
    return false;
  }
}
