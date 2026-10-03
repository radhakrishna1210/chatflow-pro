import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// CF-048: the contacts export used to stop at 50,000 rows. It now walks the
// table in chunks and streams each line, so nothing is capped and nothing is
// held whole.

const TOTAL = 2345;
const rows = Array.from({ length: TOTAL }, (_, i) => ({
  id: `c${String(TOTAL - i).padStart(5, '0')}`, name: `Name ${i}`, phoneNumber: `+9190000${i}`,
  tags: [], segments: [], optedOut: false, customFields: { tier: i % 2 ? 'gold' : '' },
  createdAt: new Date(0), updatedAt: new Date(0),
}));
const queries = [];
const prisma = {
  workspaceCustomField: { findMany: async () => [{ key: 'tier', label: 'Tier' }] },
  contact: {
    findMany: async (args) => {
      queries.push(args);
      let start = 0;
      if (args.cursor) start = rows.findIndex((r) => r.id === args.cursor.id) + (args.skip ?? 0);
      return rows.slice(start, start + args.take);
    },
    count: async () => TOTAL,
  },
};
mock.module('../lib/prisma.js', { namedExports: { prisma } });
mock.module('./subscription.service.js', { namedExports: { assertWithinLimit: async () => {} } });
mock.module('./optout.service.js', { namedExports: { setContactOptOut: async () => {} } });

const { exportContactsCsv } = await import('./contacts.service.js');

test('every contact is exported, in bounded queries, line by line', async () => {
  const lines = [];
  const out = await exportContactsCsv('ws_1', {}, { writeLine: (line) => { lines.push(line); } });
  assert.equal(out.count, TOTAL);
  assert.equal(out.truncated, false);
  assert.equal(out.csv, null, 'streamed, not collected');
  assert.equal(lines.length, TOTAL + 1, 'header plus every row');
  assert.match(lines[0], /"Tier"/, 'custom fields are still columns');
  assert.ok(queries.length >= 3 && queries.every((q) => q.take <= 1000));
});

test('without a writer the CSV is returned whole, as before', async () => {
  const out = await exportContactsCsv('ws_1');
  assert.equal(out.csv.split('\r\n').length, TOTAL + 1);
});
