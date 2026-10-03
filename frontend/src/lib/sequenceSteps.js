// Sequence-builder step logic with no React in it, so it can be unit-tested
// with `node --test` and imported by SequencesView.jsx alike.
//
// The server enforces what can be saved (sequenceEngine.service.js
// validateSteps); this file is about what will actually reach people.
// WhatsApp only accepts free-form text within 24 hours of the customer's last
// message. A sequence measures its waits from enrolment, so a MESSAGE step
// that comes after a day of waiting — or that is sent to someone who has never
// written in — cannot be delivered. A TEMPLATE step (an approved template) can.

export const WINDOW_MINUTES = 24 * 60;
// Warned from 23h: the window is counted from the customer's last message,
// which is always some time before enrolment.
export const WINDOW_WARN_MINUTES = 23 * 60;

// A new Wait step defaults to 23 hours. 1440 minutes (exactly a day) put the
// follow-up just outside the window, so the message after it was never sent.
export const DEFAULT_WAIT_MINUTES = 23 * 60;

export const blankStep = (kind) => ({
  MESSAGE: { kind: 'MESSAGE', body: '' },
  TEMPLATE: { kind: 'TEMPLATE', templateId: '', params: [] },
  WAIT: { kind: 'WAIT', minutes: DEFAULT_WAIT_MINUTES },
  TASK: { kind: 'TASK', title: '', dueInDays: 1 },
  UPDATE_FIELD: { kind: 'UPDATE_FIELD', status: 'CONTACTED' },
  EXIT: { kind: 'EXIT', reason: 'Sequence complete' },
}[kind] ?? { kind });

export function formatMinutes(minutes) {
  const m = Number(minutes) || 0;
  if (m > 0 && m % 1440 === 0) return `${m / 1440} day${m / 1440 === 1 ? '' : 's'}`;
  if (m > 0 && m % 60 === 0) return `${m / 60} hour${m / 60 === 1 ? '' : 's'}`;
  return `${m} minute${m === 1 ? '' : 's'}`;
}

// The highest {{n}} placeholder across a template's components: how many
// parameters a send needs.
export function templateParamCount(template) {
  const components = Array.isArray(template?.components) ? template.components : [];
  let max = 0;
  for (const c of components) {
    for (const m of String(c?.text ?? '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]));
  }
  return max;
}

export const isApproved = (template) => String(template?.status ?? '').toUpperCase() === 'APPROVED';

/**
 * Problems with a cadence that saving would not catch. One entry per step at
 * most: { index, level: 'warn'|'error', message }.
 *
 * @param {Array} steps
 * @param {{ templates?: Array }} options  the workspace's templates, if loaded
 */
export function stepWarnings(steps = [], { templates = null } = {}) {
  const byId = new Map((templates ?? []).map((t) => [t.id, t]));
  const out = [];
  let waited = 0;
  let sentBefore = false;

  steps.forEach((step, index) => {
    if (step?.kind === 'WAIT') {
      waited += Math.max(0, Number(step.minutes) || 0);
      return;
    }

    if (step?.kind === 'MESSAGE') {
      if (waited >= WINDOW_WARN_MINUTES) {
        out.push({
          index,
          level: 'warn',
          message: `This message comes ${formatMinutes(waited)} after enrolment. WhatsApp only accepts free-form text within 24 hours of the contact's last message, so it will usually be skipped. Use a "Send template" step here.`,
        });
      } else if (!sentBefore) {
        out.push({
          index,
          level: 'warn',
          message: 'A free-form message only reaches contacts who have written to you in the last 24 hours. Contacts who have never chatted (imported, added by hand) will be skipped — start with a "Send template" step to reach them.',
        });
      }
      sentBefore = true;
      return;
    }

    if (step?.kind === 'TEMPLATE') {
      sentBefore = true;
      if (!step.templateId) {
        out.push({ index, level: 'error', message: 'Choose a template.' });
        return;
      }
      if (templates) {
        const template = byId.get(step.templateId);
        if (!template) {
          out.push({ index, level: 'error', message: 'This template no longer exists. Choose another one.' });
        } else if (!isApproved(template)) {
          out.push({
            index,
            level: 'warn',
            message: `"${template.name}" is ${String(template.status).toLowerCase()}. Only templates Meta has approved can be sent; the sequence cannot be published until it is.`,
          });
        }
      }
    }
  });

  return out;
}

export function describeStep(step) {
  switch (step?.kind) {
    case 'MESSAGE': return step.body?.slice(0, 90) || 'No message text';
    case 'TEMPLATE': return step.templateName ? `Template "${step.templateName}"` : (step.templateId ? 'Approved template' : 'No template chosen');
    case 'WAIT': return formatMinutes(step.minutes);
    case 'TASK': return `${step.title}${step.dueInDays ? ` · due in ${step.dueInDays}d` : ''}`;
    case 'UPDATE_FIELD': return `Set status to ${String(step.status || '').toLowerCase().replace(/_/g, ' ')}`;
    default: return step?.reason || 'Ends the sequence';
  }
}
