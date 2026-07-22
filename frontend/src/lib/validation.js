// Shared "meaningful text" validation — rejects values that are empty or
// contain only emojis/symbols/whitespace by requiring at least one Unicode
// letter. Reused across signup, campaigns, templates, and every automation
// module (workflows, AI agent, smart lists, WhatsApp forms) instead of each
// form re-implementing its own regex.
export function hasAlphaChar(value) {
  return /\p{L}/u.test(String(value || ''));
}

export function validateMeaningfulText(value, label = 'This field') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return `${label} is required`;
  if (!hasAlphaChar(trimmed)) return `${label} must contain at least one letter`;
  return null;
}
