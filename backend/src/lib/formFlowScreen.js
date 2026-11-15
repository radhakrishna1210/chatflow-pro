// A WhatsApp Form shown as one screen (a "WhatsApp Flow") instead of one
// question per message: the customer ticks what they want, fills in the
// fields that appear, and taps Submit.
//
// Two halves, kept together so they cannot drift apart:
//
//   buildFlowJson(form)              the form's questions → Meta's Flow JSON
//   answersFromFlowReply(fields, d)  the submitted screen → the same
//                                    { fieldKey: answer } the chat version saves
//
// How questions map to the screen:
//
//   text                    a multi-line box
//   number / email / phone  a single-line input of that kind
//   choice                  radio buttons
//   pick several            tick boxes (a checkbox group)
//   pick several whose options have "Ask only if" questions
//                           one tick box per option, and the dependent
//                           questions appear under an option when it is ticked
//   choice with "Ask only if" questions
//                           radio buttons, dependents appear under the chosen one
//
// Input names are positional (f1, f2 … and f1_o2 for option 2 of question 1),
// never the question keys: Meta restricts names to letters, digits and
// underscores, and a positional name survives a relabelled question.

import { createHash } from 'node:crypto';
import { shouldAsk, MULTI_SEPARATOR } from './formFlow.js';

export const FLOW_JSON_VERSION = '6.0';
export const FLOW_SCREEN_ID = 'FORM';

// Meta's published limits. Longer text is moved into a text block above the
// input (which has no such limit) or clipped, rather than failing the upload.
const LIMITS = {
  screenTitle: 30,
  subheading: 80,
  inputLabel: 20,
  groupLabel: 30,
  optionTitle: 30,
  tickBoxLabel: 120,
  components: 50,
};

const GENERIC_LABEL = {
  number: 'Quantity',
  email: 'Email',
  phone: 'Phone number',
  text: 'Your answer',
  choice: 'Choose one',
  multi: 'Choose',
};

const clip = (value, max) => {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
};

const fieldName = (index) => `f${index + 1}`;
const optionName = (index, option) => `${fieldName(index)}_o${option + 1}`;
const optionId = (option) => `o${option + 1}`;

const isOptionType = (field) => field?.type === 'choice' || field?.type === 'multi';

// The question (0-based) an "Ask only if" rule points at, or -1 when the rule
// is missing or broken. A broken rule never hides a question (see shouldAsk).
function targetOf(fields, index) {
  const cond = fields[index]?.showIf;
  if (!cond) return -1;
  const target = Number(cond.question) - 1;
  if (!Number.isInteger(target) || target < 0 || target >= index) return -1;
  if (!isOptionType(fields[target]) || !fields[target].options.includes(cond.option)) return -1;
  return target;
}

// Indexes of the questions shown only when `option` of question `index` is picked.
function dependentsOf(fields, index, option) {
  const out = [];
  for (let i = index + 1; i < fields.length; i += 1) {
    if (targetOf(fields, i) === index && fields[i].showIf.option === option) out.push(i);
  }
  return out;
}

const hasDependents = (fields, index) =>
  fields.some((_, i) => i > index && targetOf(fields, i) === index);

// A pick-several question is drawn as separate tick boxes (rather than one
// checkbox group) when other questions depend on its options.
export const usesTickBoxes = (fields, index) =>
  fields[index]?.type === 'multi' && hasDependents(fields, index);

function unsupported(message) {
  const e = new Error(message);
  e.status = 400;
  e.code = 'FLOW_UNSUPPORTED';
  return e;
}

// The label a single input carries, plus a text block above it when the
// question is too long to be the label itself.
function labelled(field, max = LIMITS.inputLabel) {
  const label = String(field.label || '').trim();
  if (label.length <= max) return { label: label || GENERIC_LABEL[field.type] || 'Your answer', lead: [] };
  return { label: GENERIC_LABEL[field.type] || 'Your answer', lead: [{ type: 'TextBody', text: label }] };
}

function optionSource(field) {
  return field.options.map((option, j) => ({ id: optionId(j), title: clip(option, LIMITS.optionTitle) }));
}

// Components for one question. `names` collects every input name so the
// Submit button can send them all back.
function componentsFor(fields, index, names, depth = 0) {
  const field = fields[index];
  const name = fieldName(index);
  const required = field.required !== false;

  const nested = (option) => {
    const deps = dependentsOf(fields, index, option);
    if (deps.length === 0) return [];
    if (depth > 0) {
      throw unsupported('A form screen supports one level of "Ask only if". '
        + `"${fields[deps[0]].label}" depends on a question that itself depends on another.`);
    }
    return deps.flatMap((i) => componentsFor(fields, i, names, depth + 1));
  };

  if (field.type === 'multi' && usesTickBoxes(fields, index)) {
    const out = [{ type: 'TextSubheading', text: clip(field.label, LIMITS.subheading) }];
    field.options.forEach((option, j) => {
      const tick = optionName(index, j);
      names.push(tick);
      out.push({ type: 'OptIn', name: tick, label: clip(option, LIMITS.tickBoxLabel), required: false });
      const then = nested(option);
      if (then.length) out.push({ type: 'If', condition: `\${form.${tick}}`, then });
    });
    return out;
  }

  if (field.type === 'multi') {
    const { label, lead } = labelled(field, LIMITS.groupLabel);
    names.push(name);
    return [...lead, { type: 'CheckboxGroup', name, label, required, 'data-source': optionSource(field) }];
  }

  if (field.type === 'choice') {
    const { label, lead } = labelled(field, LIMITS.groupLabel);
    names.push(name);
    const out = [...lead, { type: 'RadioButtonsGroup', name, label, required, 'data-source': optionSource(field) }];
    field.options.forEach((option, j) => {
      const then = nested(option);
      if (then.length) out.push({ type: 'If', condition: `\${form.${name}} == '${optionId(j)}'`, then });
    });
    return out;
  }

  const { label, lead } = labelled(field);
  names.push(name);
  if (field.type === 'text') return [...lead, { type: 'TextArea', name, label, required }];
  return [...lead, { type: 'TextInput', name, label, 'input-type': field.type, required }];
}

const countComponents = (list) =>
  list.reduce((n, c) => n + 1 + (Array.isArray(c.then) ? countComponents(c.then) : 0), 0);

/**
 * Meta Flow JSON for a form: a single screen ending in a Submit button.
 * Throws (status 400, code FLOW_UNSUPPORTED) when the form cannot be shown as
 * one screen, with a message fit to show the person editing the form.
 */
export function buildFlowJson(form) {
  const fields = Array.isArray(form?.schema) ? form.schema : [];
  if (fields.length === 0) throw unsupported('Add at least one question before turning on the form screen.');

  const names = [];
  const children = [];
  fields.forEach((_, index) => {
    // Dependent questions are drawn under the option they depend on.
    if (targetOf(fields, index) !== -1) return;
    children.push(...componentsFor(fields, index, names));
  });

  children.push({
    type: 'Footer',
    label: 'Submit',
    'on-click-action': {
      name: 'complete',
      payload: Object.fromEntries(names.map((n) => [n, `\${form.${n}}`])),
    },
  });

  const total = countComponents(children);
  if (total > LIMITS.components) {
    throw unsupported(`This form needs ${total} items on the screen and WhatsApp allows ${LIMITS.components}. `
      + 'Remove some questions or options to use the form screen.');
  }

  return {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: FLOW_SCREEN_ID,
      title: clip(form.name, LIMITS.screenTitle) || 'Form',
      terminal: true,
      success: true,
      layout: { type: 'SingleColumnLayout', children },
    }],
  };
}

// Identifies the screen a form's questions produce. A published screen whose
// fingerprint no longer matches the form is out of date and must not be sent:
// its inputs would be read against the wrong questions.
export function flowFingerprint(form) {
  return createHash('sha256').update(JSON.stringify(buildFlowJson(form))).digest('hex').slice(0, 32);
}

const isTicked = (value) => value === true || value === 'true';
const text = (value) => (value === null || value === undefined ? '' : String(value).trim());
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/**
 * What a submitted screen sent back, as the answers the chat version of the
 * form would have saved: { fieldKey: answer }. A question that was not shown
 * is skipped, and a skipped Number question recorded as "0", exactly as in
 * lib/formFlow.js `advance` — so totals in the closing message still add up.
 *
 * `problems` lists the labels of questions that were shown and required but
 * came back empty or malformed.
 */
export function answersFromFlowReply(fields, data) {
  const list = Array.isArray(fields) ? fields : [];
  const sent = data && typeof data === 'object' ? data : {};
  const answers = {};
  const problems = [];

  list.forEach((field, index) => {
    if (!shouldAsk(list, index, answers)) {
      if (field.type === 'number') answers[field.key] = '0';
      return;
    }

    const name = fieldName(index);
    let value;
    if (field.type === 'multi') {
      const chosen = Array.isArray(sent[name]) ? sent[name].map(String) : [];
      const picked = usesTickBoxes(list, index)
        ? field.options.filter((_, j) => isTicked(sent[optionName(index, j)]))
        : field.options.filter((_, j) => chosen.includes(optionId(j)));
      value = picked.join(MULTI_SEPARATOR);
    } else if (field.type === 'choice') {
      const match = /^o(\d+)$/.exec(text(sent[name]));
      value = match ? field.options[Number(match[1]) - 1] ?? '' : '';
    } else {
      value = text(sent[name]);
    }

    if (!value) {
      if (field.required !== false) problems.push(field.label);
      else if (field.type === 'number') answers[field.key] = '0';
      return;
    }
    if (field.type === 'number' && !NUMBER_RE.test(value)) { problems.push(field.label); return; }
    answers[field.key] = value;
  });

  return { answers, problems };
}
