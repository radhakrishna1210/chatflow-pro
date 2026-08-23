// Shared "meaningful text" rule — rejects values that are empty or contain
// only emojis/symbols/whitespace by requiring at least one Unicode letter.
// Single source of truth reused by validators/index.js (Zod schemas) and any
// service that validates outside the Zod layer (e.g. aiAgent.service.js)
// instead of each place re-implementing its own regex.
const HAS_ALPHA = /\p{L}/u;

export function hasMeaningfulText(value) {
  return HAS_ALPHA.test(String(value ?? ''));
}
