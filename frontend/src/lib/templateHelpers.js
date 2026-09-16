// Small pure helpers shared by anything that lists, edits or previews a
// template — the normal Templates page and the Authentication module's own
// template list/editor both read the same Template records and need the same
// derived bits, so this is the one place they're computed.

export const getBodyText = (components) => {
  if (!Array.isArray(components)) return '';
  const body = components.find(c => c.type === 'BODY' || c.type === 'body');
  return body?.text ?? '';
};

export const statusLabel = s => {
  if (!s) return 'Pending';
  const m = { APPROVED: 'Approved', PENDING: 'Pending', REJECTED: 'Rejected' };
  return m[s.toUpperCase()] ?? s;
};

// Reads the type back off a saved template — the backend derives it the same
// way rather than storing it, so there is nothing to read from a column.
export const detectTemplateType = (components) => {
  const list = Array.isArray(components) ? components : [];
  if (list.some(c => (c?.type || '').toUpperCase() === 'CAROUSEL')) return 'CAROUSEL';
  const buttons = list.find(c => (c?.type || '').toUpperCase() === 'BUTTONS')?.buttons;
  if (Array.isArray(buttons) && buttons.some(b => (b?.type || '').toUpperCase() === 'CATALOG')) return 'CATALOG';
  return 'STANDARD';
};
