import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Prisma is mocked, so this needs no database.

const rows = Array.from({ length: 2500 }, (_, i) => ({
  id: `r${String(i).padStart(5, '0')}`,
  status: i % 2 ? 'DELIVERED' : 'FAILED',
  failReason: i === 0 ? '=HYPERLINK("http://x")' : null,
  retryCount: 0,
  billedAmount: i % 2 ? 1.09 : null,
  contact: { name: `Name "${i}"`, phoneNumber: `+9190000${String(i).padStart(5, '0')}` },
}));
const queries = [];

mock.module(new URL('../lib/prisma.js', import.meta.url).href, {
  namedExports: {
    prisma: {
      campaign: { findFirst: async ({ where }) => (where.workspaceId === 'w1' ? { id: where.id, name: 'Diwali Sale!' } : null) },
      campaignRecipient: {
        findMany: async ({ where, take }) => {
          queries.push({ where, take });
          return rows.filter((r) => !where.id || r.id > where.id.gt).slice(0, take);
        },
      },
    },
  },
});

const { campaignRecipientsCsv, csvCell, getExportableCampaign, exportFilename } = await import('./campaignExport.service.js');

test('every recipient is exported, in bounded pages', async () => {
  let csv = '';
  for await (const chunk of campaignRecipientsCsv('c1')) csv += chunk;
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2501, 'header + one line per recipient');
  assert.ok(queries.every((q) => q.take <= 1000));
  assert.equal(queries.length, 3);
});

test('cells are quoted, quotes escaped, formulas neutralised, phone numbers left intact', () => {
  assert.equal(csvCell('Name "1"'), '"Name ""1"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+919000000001'), '"+919000000001"');
  assert.equal(csvCell(null), '""');
});

test('another workspace’s campaign is a 404', async () => {
  await assert.rejects(getExportableCampaign('w2', 'c1'), (e) => e.status === 404);
});

test('the filename is safe', () => {
  assert.equal(exportFilename({ id: 'c1', name: 'Diwali Sale! / "50%"' }), 'campaign-Diwali-Sale-50.csv');
});
