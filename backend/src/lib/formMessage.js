// Fills in a WhatsApp Form's closing message, so it can repeat the customer's
// answers and work out an order total:
//
//   Thanks {{name}}! {{q1}} × ₹{{price}} = ₹{{= q1 * price}}
//
//   {{q1}}, {{q2}} …     the answer to question 1, 2 … (also by question key)
//   {{name}}, {{price}}  anything a workflow message can use: name, phone,
//                        email, custom fields, uploaded sheet columns
//   {{= expression}}     arithmetic on numbers and the names above. Only
//                        numbers, names, + - * / and brackets are understood;
//                        anything else makes that one expression render empty.
//
// A message without "{{" is returned untouched, so existing forms send exactly
// what they sent before.

import { renderTemplate } from '../services/workflowConditions.js';

const EXPRESSION = /\{\{\s*=([^{}]{1,300})\}\}/g;

// q1…qN plus each answer under its own key. Positional names win, since they
// are what the form builder shows.
function answerVariables(fields = [], answers = {}) {
  const vars = {};
  for (const [key, value] of Object.entries(answers || {})) vars[key] = value;
  fields.forEach((field, i) => {
    if (field?.key in (answers || {})) vars[`q${i + 1}`] = answers[field.key];
  });
  return vars;
}

// "1,250" / "₹180" / " 2 " → number; anything else → NaN.
function toNumber(value) {
  const cleaned = String(value ?? '').replace(/[₹,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)|([-+*/()]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error('bad token');
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ type: 'num', value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ type: 'name', value: m[2] });
    else tokens.push({ type: 'op', value: m[3] });
  }
  return tokens;
}

// Small recursive-descent evaluator: expr = term (+|- term)*,
// term = factor (*|/ factor)*, factor = number | name | -factor | (expr).
function evaluate(src, lookup) {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const factor = () => {
    const t = tokens[i++];
    if (!t) throw new Error('unexpected end');
    if (t.type === 'num') return t.value;
    if (t.type === 'name') {
      const n = toNumber(lookup(t.value));
      if (Number.isNaN(n)) throw new Error(`no number for ${t.value}`);
      return n;
    }
    if (t.value === '-') return -factor();
    if (t.value === '(') {
      const v = expr();
      if (tokens[i++]?.value !== ')') throw new Error('missing )');
      return v;
    }
    throw new Error('unexpected token');
  };
  const term = () => {
    let v = factor();
    while (peek()?.value === '*' || peek()?.value === '/') {
      const op = tokens[i++].value;
      const r = factor();
      if (op === '/' && r === 0) throw new Error('divide by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (peek()?.value === '+' || peek()?.value === '-') {
      const op = tokens[i++].value;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  if (tokens.length === 0) throw new Error('empty');
  const result = expr();
  if (i !== tokens.length) throw new Error('trailing input');
  if (!Number.isFinite(result)) throw new Error('not finite');
  return result;
}

// 1250 → "1,250", 12.5 → "12.5" (Indian digit grouping, at most 2 decimals).
const formatNumber = (n) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

function lookupFor(contact, variables) {
  return (name) => {
    if (name in variables) return variables[name];
    const lower = name.toLowerCase();
    if (lower in variables) return variables[lower];
    return renderTemplate(`{{${name}}}`, { contact, variables });
  };
}

// The order total: the value of the LAST {{= …}} in the closing message, which
// is where a receipt puts its "Total to pay". Null when there is no
// calculation or it cannot be worked out.
export function closingTotal(text, { contact = null, fields = [], answers = {} } = {}) {
  const expressions = [...String(text ?? '').matchAll(EXPRESSION)];
  if (expressions.length === 0) return null;
  const lookup = lookupFor(contact, answerVariables(fields, answers));
  try {
    return Math.round(evaluate(expressions[expressions.length - 1][1], lookup) * 100) / 100;
  } catch {
    return null;
  }
}

export function renderFormMessage(text, { contact = null, fields = [], answers = {} } = {}) {
  const source = String(text ?? '');
  if (!source.includes('{{')) return source;

  const variables = answerVariables(fields, answers);
  const lookup = lookupFor(contact, variables);

  const withMath = source.replace(EXPRESSION, (_, expression) => {
    try {
      return formatNumber(evaluate(expression, lookup));
    } catch (err) {
      console.warn(`[Forms] Could not work out "{{=${expression}}}": ${err.message}`);
      return '';
    }
  });

  return renderTemplate(withMath, { contact, variables });
}
