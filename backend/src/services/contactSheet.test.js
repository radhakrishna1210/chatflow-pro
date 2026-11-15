// A contact-and-price list kept in Google Sheets: the link is saved once and
// each import reads the sheet as it stands, through the connected Google
// account or, failing that, the sheet's view-only link.
import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetLink, rowsToCsv } from '../lib/googleSheet.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEFG';
const LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1234`;
const CSV = 'name,phone,slab,button_price,oyster_price,babycorn_price\r\nHotel Sunrise,+919876500001,1,1100,40,90\r\n,,,,,\r\n';

const db = {};
const net = {};

const response = (status, body, type = 'application/json') => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => body,
});

let service;
before(async () => {
  mock.module('../lib/prisma.js', {
    namedExports: {
      prisma: {
        workspaceIntegration: {
          findUnique: async ({ where }) => db.rows[where.workspaceId_provider.provider] ?? null,
          upsert: async ({ where, create, update }) => {
            const p = where.workspaceId_provider.provider;
            db.rows[p] = db.rows[p] ? { ...db.rows[p], ...update } : { id: `row-${p}`, ...create };
            return db.rows[p];
          },
          update: async ({ where, data }) => {
            const p = Object.keys(db.rows).find((k) => db.rows[k].id === where.id);
            db.rows[p] = { ...db.rows[p], ...data };
            return db.rows[p];
          },
          deleteMany: async ({ where }) => { delete db.rows[where.provider]; return { count: 1 }; },
        },
      },
    },
  });
  mock.module('../lib/encryption.js', {
    namedExports: { decrypt: (v) => v.replace(/^enc:/, ''), encrypt: (v) => `enc:${v}` },
  });
  mock.module('../lib/oauthProviders.js', {
    namedExports: {
      refreshAccessToken: async (id, token) => { net.refreshed.push([id, token]); if (net.refreshError) throw net.refreshError; return { access_token: 'fresh', expires_in: 3600 }; },
    },
  });
  mock.module('./contacts.service.js', {
    namedExports: {
      importContacts: async (workspaceId, buffer) => {
        db.imported.push(buffer.toString('utf8'));
        return db.importResult;
      },
    },
  });
  mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    net.calls.push({ url: String(url), auth: opts.headers?.Authorization ?? null });
    return net.handler(String(url), opts.headers?.Authorization ?? null);
  });
  service = await import('./contactSheet.service.js');
});

const google = (tokens) => ({ id: 'row-google', provider: 'google', status: 'CONNECTED', encryptedCredentials: `enc:${JSON.stringify(tokens)}` });

// A Sheets API that accepts one token.
const sheetsApi = (goodToken, rows = [['name', 'phone', 'button_price'], ['Hotel Sunrise', '+919876500001', '1,100']]) => (url, auth) => {
  if (url.startsWith('https://docs.google.com/')) return response(200, '<!DOCTYPE html><html>Sign in</html>', 'text/html');
  if (auth !== `Bearer ${goodToken}`) return response(401, { error: { message: 'Invalid Credentials' } });
  if (url.includes('?fields=')) return response(200, { sheets: [{ properties: { sheetId: 0, title: 'Slab Prices' } }, { properties: { sheetId: 1234, title: "Today's Contacts" } }] });
  return response(200, { values: rows });
};

beforeEach(() => {
  Object.assign(db, {
    rows: {}, imported: [],
    importResult: { imported: 0, updated: 1, invalid: 0, duplicates: 1, totalRows: 2, attributeKeys: ['slab', 'button_price'], contacts: [{ id: 'c1' }] },
  });
  Object.assign(net, { calls: [], refreshed: [], refreshError: null, handler: () => response(200, CSV, 'text/csv') });
});

// ── The link ───────────────────────────────────────────────────────────────

test('a sheet link gives the spreadsheet and the tab', () => {
  assert.deepEqual(parseSheetLink(LINK), { spreadsheetId: ID, gid: '1234' });
  assert.deepEqual(parseSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=7&usp=sharing`), { spreadsheetId: ID, gid: '7' });
  assert.deepEqual(parseSheetLink(`  https://docs.google.com/spreadsheets/d/${ID}  `), { spreadsheetId: ID, gid: null });
});

test('anything that is not a Google Sheets link is refused', () => {
  for (const bad of [
    '', 'not a link', `http://docs.google.com/spreadsheets/d/${ID}/edit`,
    `https://evil.example/spreadsheets/d/${ID}/edit`, `https://docs.google.com.evil.example/spreadsheets/d/${ID}`,
    'https://docs.google.com/document/d/abc/edit', 'https://docs.google.com/spreadsheets/d/short/edit',
    `https://docs.google.com/spreadsheets/d/${ID}@evil.example/edit`,
  ]) {
    assert.throws(() => parseSheetLink(bad), { status: 400 }, bad);
  }
});

test('rows become CSV, quoting what needs it and padding short rows', () => {
  assert.equal(rowsToCsv([['name', 'phone', 'note'], ['A, B', '+91', 'say "hi"'], ['C']]),
    'name,phone,note\r\n"A, B",+91,"say ""hi"""\r\nC,,');
  assert.equal(rowsToCsv([]), '');
});

// ── Saving ─────────────────────────────────────────────────────────────────

test('the link is saved once and remembered; an empty link forgets it', async () => {
  assert.deepEqual(await service.getContactSheet('ws1'),
    { url: null, googleConnected: false, lastImportedAt: null, lastResult: null, lastError: null });

  const saved = await service.saveContactSheet('ws1', LINK);
  assert.equal(saved.url, LINK);
  assert.deepEqual(db.rows['contact-sheet'].config, { url: LINK, spreadsheetId: ID, gid: '1234' });

  await assert.rejects(service.saveContactSheet('ws1', 'https://example.com/sheet'), { status: 400 });
  assert.equal(db.rows['contact-sheet'].config.url, LINK, 'a bad link does not replace the saved one');

  assert.equal((await service.saveContactSheet('ws1', '')).url, null);
});

// ── Importing ──────────────────────────────────────────────────────────────

test('without a Google connection the sheet is read through its view-only link', async () => {
  await service.saveContactSheet('ws1', LINK);
  const result = await service.importContactSheet('ws1');

  assert.deepEqual(net.calls, [{ url: `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=1234`, auth: null }]);
  assert.deepEqual(db.imported, [CSV], 'the same import as an uploaded CSV');
  assert.equal(result.via, 'link');
  assert.equal(result.contacts.length, 1);

  const state = await service.getContactSheet('ws1');
  assert.ok(state.lastImportedAt);
  assert.deepEqual(state.lastResult, { imported: 0, updated: 1, invalid: 0, contacts: 1, attributeKeys: ['slab', 'button_price'], via: 'link' });
  assert.equal(state.lastError, null);
});

test('with Google connected a private sheet is read through the account, by tab', async () => {
  db.rows.google = google({ access_token: 'good', refresh_token: 'r1' });
  net.handler = sheetsApi('good');
  await service.saveContactSheet('ws1', LINK);
  const result = await service.importContactSheet('ws1');

  assert.equal(result.via, 'account');
  assert.equal(net.calls.length, 2);
  assert.equal(net.calls[0].url, `https://sheets.googleapis.com/v4/spreadsheets/${ID}?fields=sheets.properties(sheetId,title)`);
  // The tab from the link's gid, quoted (and its apostrophe doubled) as a range.
  assert.equal(net.calls[1].url, `https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent("'Today''s Contacts'")}?valueRenderOption=FORMATTED_VALUE`);
  assert.deepEqual(db.imported, ['name,phone,button_price\r\nHotel Sunrise,+919876500001,"1,100"']);
  assert.deepEqual(net.refreshed, []);
  assert.equal((await service.getContactSheet('ws1')).googleConnected, true);
});

test('an expired Google token is refreshed once and the new one kept', async () => {
  db.rows.google = google({ access_token: 'stale', refresh_token: 'r1', scope: 's' });
  net.handler = sheetsApi('fresh');
  await service.saveContactSheet('ws1', LINK);
  const result = await service.importContactSheet('ws1');

  assert.equal(result.via, 'account');
  assert.deepEqual(net.refreshed, [['google', 'r1']]);
  assert.deepEqual(JSON.parse(db.rows.google.encryptedCredentials.replace(/^enc:/, '')),
    { access_token: 'fresh', refresh_token: 'r1', scope: 's', expires_in: 3600 });
});

test('when the account cannot open the sheet, the view-only link is tried', async () => {
  db.rows.google = google({ access_token: 'good', refresh_token: 'r1' });
  net.handler = (url) => (url.startsWith('https://sheets.googleapis.com/')
    ? response(403, { error: { message: 'The caller does not have permission' } })
    : response(200, CSV, 'text/csv'));
  await service.saveContactSheet('ws1', LINK);
  assert.equal((await service.importContactSheet('ws1')).via, 'link');
});

test('a private sheet nobody can read is explained, and nothing is imported', async () => {
  net.handler = () => response(200, '<!DOCTYPE html><html>Sign in</html>', 'text/html');
  await service.saveContactSheet('ws1', LINK);
  await assert.rejects(service.importContactSheet('ws1'),
    { status: 400, message: /This sheet is private\. Connect Google under Integrations, or set the sheet's sharing to "Anyone with the link can view"\./ });
  assert.deepEqual(db.imported, []);
  assert.match((await service.getContactSheet('ws1')).lastError, /private/);

  // Connected, but the sheet is not shared with that account either.
  db.rows.google = google({ access_token: 'good' });
  net.handler = (url) => (url.startsWith('https://sheets.googleapis.com/')
    ? response(403, { error: { message: 'The caller does not have permission' } })
    : response(200, '<html>Sign in</html>', 'text/html'));
  await assert.rejects(service.importContactSheet('ws1'),
    /connected Google account cannot open this sheet \(The caller does not have permission\)\. Share the sheet with that account/);

  net.handler = () => response(404, 'Not found', 'text/html');
  db.rows.google = undefined;
  await assert.rejects(service.importContactSheet('ws1'), /Google could not find that sheet/);
});

test('an empty tab, a tab with no phone numbers, and no saved link are each explained', async () => {
  await assert.rejects(service.importContactSheet('ws1'), { status: 400, message: 'Save your Google Sheet link first.' });

  await service.saveContactSheet('ws1', LINK);
  net.handler = () => response(200, '\r\n', 'text/csv');
  await assert.rejects(service.importContactSheet('ws1'), /That tab is empty/);

  net.handler = () => response(200, 'slab,price\r\n1,1100\r\n', 'text/csv');
  db.importResult = { imported: 0, updated: 0, invalid: 0, duplicates: 0, totalRows: 1, attributeKeys: [], contacts: [] };
  await assert.rejects(service.importContactSheet('ws1'), /No phone numbers were found/);
  assert.match((await service.getContactSheet('ws1')).lastError, /No phone numbers/);
});

test('importing again reads the sheet again: tomorrow\'s prices replace today\'s', async () => {
  await service.saveContactSheet('ws1', LINK);
  await service.importContactSheet('ws1');
  const tomorrow = CSV.replace('1100,40,90', '1150,42,95');
  net.handler = () => response(200, tomorrow, 'text/csv');
  await service.importContactSheet('ws1');
  assert.deepEqual(db.imported, [CSV, tomorrow]);
  assert.equal(net.calls.length, 2);
});
