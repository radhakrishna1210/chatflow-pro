import test from 'node:test';
import assert from 'node:assert/strict';
import { toE164Digits, callingCodeOf } from './phone.js';

test('callingCodeOf reads 1-, 2- and 3-digit country codes', () => {
  assert.equal(callingCodeOf('+91 98765 43210'), '91');
  assert.equal(callingCodeOf('+1 212 555 1234'), '1');
  assert.equal(callingCodeOf('+44 7700 900123'), '44');
  assert.equal(callingCodeOf('+971 50 123 4567'), '971');
  assert.equal(callingCodeOf('123'), null);
});

test('national numbers get the sender\'s country code', () => {
  assert.equal(toE164Digits('9876543210', '+919000000000'), '919876543210');
  assert.equal(toE164Digits('098765 43210', '+919000000000'), '919876543210');
  assert.equal(toE164Digits('(212) 555-1234', '+12025550100'), '12125551234');
  // UAE: 9-digit national numbers, written with a trunk 0.
  assert.equal(toE164Digits('050 123 4567', '+971501112222'), '971501234567');
});

test('India is the default when the sender is unknown', () => {
  assert.equal(toE164Digits('9876543210'), '919876543210');
  assert.equal(toE164Digits('09876543210', null), '919876543210');
});

test('international numbers are left alone', () => {
  assert.equal(toE164Digits('+91 98765 43210', '+12025550100'), '919876543210');
  assert.equal(toE164Digits('919876543210', '+919000000000'), '919876543210');
  assert.equal(toE164Digits('0044 7700 900123', '+919000000000'), '447700900123');
  assert.equal(toE164Digits('+1 212 555 1234'), '12125551234');
  // Already carries the US code, no "+": 11 digits is not a national US number.
  assert.equal(toE164Digits('12125551234', '+12025550100'), '12125551234');
  assert.equal(toE164Digits(''), '');
});
