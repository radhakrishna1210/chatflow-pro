// Two WhatsApp Form features that let a customer skip what does not apply:
//
//   "Pick several" (type 'multi'): the customer replies with several option
//   numbers or names, e.g. "1,3", "1 3", "1 and 3" or "Oyster, Shiitake".
//   The answer is stored as the chosen options joined with ", ".
//
//   "Ask only if" (field.showIf = { question: n, option }): the question is
//   asked only when question n (1-based, earlier in the form, a choice or
//   pick-several question) was answered with that option. A skipped Number
//   question is recorded as "0", so totals like {{= q2 * price}} still add up.

import { matchOption } from '../services/conversationControl.service.js';

export const MULTI_SEPARATOR = ', ';

// "1,3" / "1 3" / "1 and 3" / "Oyster, Shiitake & Milky" / "all".
// Returns { picked: [option…] } or { error } naming what was not understood.
export function parseMulti(answer, options = []) {
  const raw = String(answer ?? '').trim();
  if (!raw) return { picked: [] };
  if (/^(all|everything|all of them)$/i.test(raw)) return { picked: [...options] };

  const parts = raw
    .split(/\s*(?:,|;|&|\/|\+|\band\b)\s*/i)
    .flatMap((p) => (/^\d+(\s+\d+)+$/.test(p.trim()) ? p.trim().split(/\s+/) : [p]))
    .map((p) => p.trim())
    .filter(Boolean);

  const picked = [];
  const unknown = [];
  for (const part of parts) {
    const hit = matchOption(part, options);
    if (!hit) { unknown.push(part); continue; }
    if (!picked.includes(hit.option)) picked.push(hit.option);
  }
  if (unknown.length) return { error: unknown };
  // Keep the form's own order, not the order typed.
  return { picked: options.filter((o) => picked.includes(o)) };
}

// Was `option` chosen in a stored answer? A pick-several answer is the options
// joined with ", ", so the option must be one of its parts (options may
// themselves contain commas, hence the boundary check rather than a split).
export function isPicked(stored, option) {
  const answer = String(stored ?? '');
  const o = String(option ?? '');
  if (!answer || !o) return false;
  if (answer === o) return true;
  return answer.startsWith(o + MULTI_SEPARATOR)
    || answer.endsWith(MULTI_SEPARATOR + o)
    || answer.includes(MULTI_SEPARATOR + o + MULTI_SEPARATOR);
}

// Should fields[index] be asked, given the answers so far?
export function shouldAsk(fields, index, answers = {}) {
  const cond = fields[index]?.showIf;
  if (!cond) return true;
  const target = fields[cond.question - 1];
  if (!target || cond.question - 1 >= index) return true; // a broken rule never hides a question
  return isPicked(answers[target.key], cond.option);
}

// From `from` onwards, the next question to ask, recording skipped ones.
// Returns { cursor, answers } — cursor === fields.length means the form is done.
export function advance(fields, from, answers = {}) {
  const next = { ...answers };
  let cursor = from;
  while (cursor < fields.length && !shouldAsk(fields, cursor, next)) {
    const skipped = fields[cursor];
    if (skipped.type === 'number') next[skipped.key] = '0';
    cursor += 1;
  }
  return { cursor, answers: next };
}

// Checks a field's showIf against the questions before it. Returns a clean
// { question, option } or null.
export function normalizeShowIf(showIf, index, fields) {
  if (!showIf || typeof showIf !== 'object') return null;
  const question = Number(showIf.question);
  const option = String(showIf.option ?? '').trim();
  if (!Number.isInteger(question) || question < 1 || question > index || !option) return null;
  const target = fields[question - 1];
  if (!target || !['choice', 'multi'].includes(target.type)) return null;
  if (!target.options.includes(option)) return null;
  return { question, option };
}
