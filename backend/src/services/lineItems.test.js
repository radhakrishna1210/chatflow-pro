import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLine, calculateDocument, round2 } from './lineItems.js';

test('a plain line is quantity times price', () => {
  const l = calculateLine({ quantity: 3, unitPrice: 250 });
  assert.equal(l.subtotal, 750);
  assert.equal(l.taxAmount, 0);
  assert.equal(l.total, 750);
});

test('discount comes off before tax is charged', () => {
  // 2 x 1000 = 2000, less 10% = 1800, plus 18% tax = 2124.
  const l = calculateLine({ quantity: 2, unitPrice: 1000, discountPct: 10, taxRate: 18 });
  assert.equal(l.subtotal, 1800);
  assert.equal(l.taxAmount, 324);
  assert.equal(l.total, 2124);
});

test('tax is charged on the discounted amount, never the list price', () => {
  const discounted = calculateLine({ quantity: 1, unitPrice: 100, discountPct: 50, taxRate: 10 });
  const undiscounted = calculateLine({ quantity: 1, unitPrice: 50, taxRate: 10 });
  assert.equal(discounted.taxAmount, undiscounted.taxAmount);
  assert.equal(discounted.total, undiscounted.total);
});

test('fractional quantities and prices round to whole paise', () => {
  const l = calculateLine({ quantity: 1.5, unitPrice: 33.33, taxRate: 18 });
  assert.equal(l.subtotal, 50);        // 49.995 -> 50.00
  assert.equal(l.taxAmount, 9);        // 9.00
  assert.equal(l.total, 59);
  // Nothing carries more than two decimals into storage.
  for (const v of [l.subtotal, l.taxAmount, l.total]) {
    assert.equal(round2(v), v, 'a stored money value must already be rounded');
  }
});

test('a line total always equals its own subtotal plus tax', () => {
  const cases = [
    { quantity: 7, unitPrice: 19.99, discountPct: 3, taxRate: 12 },
    { quantity: 1, unitPrice: 0.01, taxRate: 28 },
    { quantity: 999, unitPrice: 1234.56, discountPct: 17.5, taxRate: 5 },
    { quantity: 0.001, unitPrice: 1, taxRate: 18 },
  ];
  for (const c of cases) {
    const l = calculateLine(c);
    assert.equal(l.total, round2(l.subtotal + l.taxAmount), `mismatch for ${JSON.stringify(c)}`);
  }
});

test('negative and out-of-range inputs are clamped rather than trusted', () => {
  const negative = calculateLine({ quantity: -5, unitPrice: -100, discountPct: -20, taxRate: -8 });
  assert.equal(negative.subtotal, 0);
  assert.equal(negative.total, 0);
  assert.equal(negative.discountPct, 0);

  // A 500% discount must not turn a sale into a refund.
  const absurd = calculateLine({ quantity: 1, unitPrice: 100, discountPct: 500 });
  assert.equal(absurd.discountPct, 100);
  assert.equal(absurd.subtotal, 0);
  assert.ok(absurd.total >= 0, 'a line total can never go negative');
});

test('a zero-quantity line is worth nothing', () => {
  const l = calculateLine({ quantity: 0, unitPrice: 9999, taxRate: 18 });
  assert.equal(l.subtotal, 0);
  assert.equal(l.total, 0);
});

test('a document with no discount sums its lines exactly', () => {
  const lines = [
    calculateLine({ quantity: 2, unitPrice: 100, taxRate: 18 }),
    calculateLine({ quantity: 1, unitPrice: 50, taxRate: 18 }),
  ];
  const doc = calculateDocument(lines);
  assert.equal(doc.subtotal, 250);
  assert.equal(doc.taxAmount, 45);
  assert.equal(doc.total, 295);
});

test('a document discount reduces the taxable base, not just the total', () => {
  const lines = [calculateLine({ quantity: 1, unitPrice: 1000, taxRate: 10 })];
  const doc = calculateDocument(lines, { discountPct: 20 });

  assert.equal(doc.subtotal, 800);
  // Tax follows the discounted base: 10% of 800, not the original 100.
  assert.equal(doc.taxAmount, 80);
  assert.equal(doc.total, 880);
});

test('an empty document is zero, not NaN', () => {
  const doc = calculateDocument([]);
  assert.equal(doc.subtotal, 0);
  assert.equal(doc.taxAmount, 0);
  assert.equal(doc.total, 0);
});

test('document totals equal subtotal plus tax across random-ish baskets', () => {
  const baskets = [
    [{ quantity: 3, unitPrice: 12.34, taxRate: 18 }, { quantity: 1, unitPrice: 0.99, discountPct: 5, taxRate: 12 }],
    [{ quantity: 10, unitPrice: 7.77, discountPct: 33.3, taxRate: 28 }],
    [{ quantity: 1, unitPrice: 1e6, taxRate: 18 }, { quantity: 2, unitPrice: 0.05 }],
  ];
  for (const basket of baskets) {
    const lines = basket.map(calculateLine);
    for (const discountPct of [0, 7.5, 100]) {
      const doc = calculateDocument(lines, { discountPct });
      assert.equal(doc.total, round2(doc.subtotal + doc.taxAmount));
      assert.ok(doc.total >= 0);
    }
  }
});
