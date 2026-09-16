// Shared display formatters for CRM money and dates.
//
// The CRM dashboard used to hardcode "$" while the deals board rendered "₹"
// from the same underlying values, so one screen mis-stated every figure.
// Deal.currency defaults to INR server-side; formatting lives here so the two
// cannot drift apart again.

const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

export const currencySymbol = (code = 'INR') => SYMBOLS[code] ?? `${code} `;

// `dash` is what an absent amount renders as — an em dash in tables, but
// callers showing a running total usually want a zero instead.
export function fmtMoney(value, { currency = 'INR', dash = '—' } = {}) {
  if (value == null || value === '') return dash;
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  return `${currencySymbol(currency)}${n.toLocaleString('en-IN')}`;
}

// Compact form for chart axes, where a full figure would not fit.
export function fmtMoneyShort(value, { currency = 'INR' } = {}) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '';
  const sym = currencySymbol(currency);
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${sym}${(n / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `${sym}${(n / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
  if (abs >= 1e3) return `${sym}${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${sym}${n}`;
}

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// Turns an enum constant into display text: CLOSED_WON -> "Closed Won".
export const pretty = (s) =>
  String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
