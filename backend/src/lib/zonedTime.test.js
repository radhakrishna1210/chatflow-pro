import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedDayKey, zonedMidnight, zonedDayWindow, validTimeZone, weekdayOfKey } from './zonedTime.js';

test('a late-night UTC instant belongs to the next day in India', () => {
  // 20:00 UTC on 1 Oct is 01:30 IST on 2 Oct.
  const at = new Date('2026-10-01T20:00:00Z');
  assert.equal(zonedDayKey(at, 'Asia/Kolkata'), '2026-10-02');
  assert.equal(zonedDayKey(at, 'UTC'), '2026-10-01');
  assert.equal(zonedDayKey(at, 'America/New_York'), '2026-10-01');
});

test('local midnight is computed per zone', () => {
  assert.equal(zonedMidnight('2026-10-02', 'Asia/Kolkata').toISOString(), '2026-10-01T18:30:00.000Z');
  assert.equal(zonedMidnight('2026-10-02', 'UTC').toISOString(), '2026-10-02T00:00:00.000Z');
  // New York: EDT (UTC-4) in October, EST (UTC-5) in December.
  assert.equal(zonedMidnight('2026-10-02', 'America/New_York').toISOString(), '2026-10-02T04:00:00.000Z');
  assert.equal(zonedMidnight('2026-12-02', 'America/New_York').toISOString(), '2026-12-02T05:00:00.000Z');
});

test('local midnight on a DST change day', () => {
  // Europe/London springs forward at 01:00 on 29 Mar 2026; midnight is still GMT.
  assert.equal(zonedMidnight('2026-03-29', 'Europe/London').toISOString(), '2026-03-29T00:00:00.000Z');
  assert.equal(zonedMidnight('2026-03-30', 'Europe/London').toISOString(), '2026-03-29T23:00:00.000Z');
});

test('a window is whole local days, today included', () => {
  const now = new Date('2026-10-01T20:00:00Z'); // 2 Oct in IST
  const w = zonedDayWindow(3, 'Asia/Kolkata', now);
  assert.deepEqual(w.keys, ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.equal(w.since.toISOString(), '2026-09-29T18:30:00.000Z');
  assert.equal(w.today, '2026-10-02');
});

test('an invalid zone falls back to the default', () => {
  assert.equal(validTimeZone('Not/AZone'), 'Asia/Kolkata');
  assert.equal(validTimeZone(null), 'Asia/Kolkata');
  assert.equal(validTimeZone('Europe/Berlin'), 'Europe/Berlin');
});

test('weekday of a day key', () => {
  assert.equal(weekdayOfKey('2026-10-02'), 5); // Friday
});
