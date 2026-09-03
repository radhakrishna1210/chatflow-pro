// Line-item arithmetic. Every money figure stored against a deal or quote is
// produced here from quantity, unit price, discount and tax rate.
//
// The client never supplies a subtotal, tax amount or total: a browser that can
// post its own totals can post any total it likes, and a quote is a commercial
// document. This module is pure so the rounding rules can be unit tested.

// Money is rounded to 2 decimals at each step rather than only at the end.
// Carrying full float precision through and rounding once lets a 3-line quote
// disagree with the sum of its own printed lines, which is the kind of error
// customers notice.
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const clampPct = (v) => Math.min(Math.max(Number(v) || 0, 0), 100);
const nonNegative = (v) => Math.max(Number(v) || 0, 0);

/**
 * One line's money.
 *   gross     = quantity x unitPrice
 *   subtotal  = gross less the line discount
 *   taxAmount = subtotal x taxRate
 *   total     = subtotal + taxAmount
 *
 * Tax is charged on the discounted amount, not the list price.
 */
export function calculateLine({ quantity = 1, unitPrice = 0, discountPct = 0, taxRate = 0 }) {
  const qty = nonNegative(quantity);
  const price = nonNegative(unitPrice);
  const discount = clampPct(discountPct);
  const tax = clampPct(taxRate);

  const gross = round2(qty * price);
  const subtotal = round2(gross * (1 - discount / 100));
  const taxAmount = round2(subtotal * (tax / 100));
  const total = round2(subtotal + taxAmount);

  return { quantity: qty, unitPrice: price, discountPct: discount, taxRate: tax, subtotal, taxAmount, total };
}

/**
 * Roll a set of calculated lines into a document total, applying an optional
 * discount across the whole document.
 *
 * A document-level discount reduces the taxable base, so tax is recomputed
 * proportionally rather than carried over from the lines — otherwise a 10%
 * quote discount would leave the customer paying tax on money they were not
 * charged.
 */
export function calculateDocument(lines, { discountPct = 0 } = {}) {
  const discount = clampPct(discountPct);

  const lineSubtotal = round2(lines.reduce((s, l) => s + Number(l.subtotal || 0), 0));
  const lineTax = round2(lines.reduce((s, l) => s + Number(l.taxAmount || 0), 0));

  if (discount === 0) {
    return {
      subtotal: lineSubtotal,
      taxAmount: lineTax,
      total: round2(lineSubtotal + lineTax),
      discountPct: 0,
    };
  }

  const factor = 1 - discount / 100;
  const subtotal = round2(lineSubtotal * factor);
  const taxAmount = round2(lineTax * factor);

  return { subtotal, taxAmount, total: round2(subtotal + taxAmount), discountPct: discount };
}
