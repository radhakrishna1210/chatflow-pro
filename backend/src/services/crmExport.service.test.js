import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseCell, toCsvValue, toCsv } from './crmExport.service.js';
import { detectColumns, previewLeadImport } from './crmImport.service.js';

// §47 — a CSV export is opened in a spreadsheet, and a spreadsheet executes
// cells that begin with certain characters. A CRM full of attacker-supplied
// names is the ideal delivery vector, so this is the security boundary.
test('formula-triggering cells are neutralised', () => {
  const attacks = [
    '=cmd|\'/c calc\'!A1',
    '+1+1',
    '-1+1',
    '@SUM(1+1)',
    '=HYPERLINK("http://evil.test","click")',
    '\t=1+1',
    '\r=1+1',
  ];
  for (const attack of attacks) {
    const out = sanitiseCell(attack);
    assert.equal(out[0], "'", `"${attack}" was not neutralised`);
    assert.equal(out.slice(1), attack, 'the original value must be preserved after the guard');
  }
});

test('ordinary values are left exactly as they are', () => {
  for (const value of ['Acme Ltd', '  spaced  ', '91700000000', 'a=b', 'x+y', '0', 'Name (Pvt) Ltd.']) {
    assert.equal(sanitiseCell(value), String(value), `"${value}" should not have been altered`);
  }
});

test('null and undefined export as empty, not as the words', () => {
  assert.equal(sanitiseCell(null), '');
  assert.equal(sanitiseCell(undefined), '');
  assert.equal(sanitiseCell(''), '');
  // The literal string "null" is a legitimate value and must survive.
  assert.equal(sanitiseCell('null'), 'null');
});

test('numbers survive without being treated as formulas', () => {
  assert.equal(sanitiseCell(1234.56), '1234.56');
  assert.equal(sanitiseCell(0), '0');
  // A negative number does begin with '-', so it is quoted defensively. That
  // is the correct trade: a mis-rendered minus sign beats code execution.
  assert.equal(sanitiseCell(-5), "'-5");
});

test('quoting follows RFC 4180 and escapes embedded quotes', () => {
  assert.equal(toCsvValue('plain'), 'plain');
  assert.equal(toCsvValue('has,comma'), '"has,comma"');
  assert.equal(toCsvValue('has"quote'), '"has""quote"');
  assert.equal(toCsvValue('has\nnewline'), '"has\nnewline"');
});

test('a sanitised value that also needs quoting gets both', () => {
  const out = toCsvValue('=1,2');
  assert.equal(out, '"\'=1,2"');
  assert.ok(out.includes("'="), 'the formula guard must survive quoting');
});

test('toCsv writes a header row and one line per record', () => {
  const rows = [{ a: 'one', b: '=BAD()' }, { a: 'two,comma', b: 'fine' }];
  const csv = toCsv(rows, [
    { label: 'Column A', value: (r) => r.a },
    { label: 'Column B', value: (r) => r.b },
  ]);
  const lines = csv.split('\r\n');

  assert.equal(lines[0], 'Column A,Column B');
  assert.equal(lines[1], "one,'=BAD()");
  assert.equal(lines[2], '"two,comma",fine');
  assert.equal(lines.length, 3);
});

test('an empty export still produces a usable header', () => {
  const csv = toCsv([], [{ label: 'Name', value: (r) => r.name }]);
  assert.equal(csv, 'Name');
});

// ─── Import ────────────────────────────────────────────────────────────────

test('column detection accepts common header spellings', () => {
  const { mapping } = detectColumns(['Full Name', 'Mobile', 'E-Mail', 'Lead Source']);
  assert.equal(mapping.name, 'Full Name');
  assert.equal(mapping.phoneNumber, 'Mobile');
  assert.equal(mapping.email, 'E-Mail');
  assert.equal(mapping.source, 'Lead Source');
});

test('unrecognised columns are reported rather than silently dropped', () => {
  const { mapping, unmapped } = detectColumns(['phone', 'Favourite Colour']);
  assert.equal(mapping.phoneNumber, 'phone');
  assert.deepEqual(unmapped, ['Favourite Colour']);
});

test('a preview reports per-row problems without writing anything', () => {
  const csv = [
    'name,phone,status',
    'Good Lead,919000000001,QUALIFIED',
    'Bad Phone,abc,NEW',
    'Dupe,919000000001,NEW',
    'No Phone,,NEW',
    'Odd Status,919000000002,BANANA',
  ].join('\n');

  const result = previewLeadImport(Buffer.from(csv));

  assert.equal(result.totalRows, 5);
  assert.equal(result.valid, 2, 'only the good row and the odd-status row are importable');
  assert.equal(result.invalid, 3);
  assert.equal(result.duplicateInFile, 1);

  const byLine = Object.fromEntries(result.preview.map((r) => [r.line, r]));
  assert.match(byLine[3].issues[0], /7–15 digits/);
  assert.match(byLine[4].issues[0], /Duplicate/);
  assert.match(byLine[5].issues[0], /Missing phone/);
  // An unknown status downgrades to NEW instead of failing the row.
  assert.equal(byLine[6].status, 'NEW');
  assert.match(byLine[6].issues[0], /Unknown status/);
});

test('a file with no phone column is refused with an explanation', () => {
  const csv = 'name,email\nSomebody,a@b.test';
  assert.throws(
    () => previewLeadImport(Buffer.from(csv)),
    (e) => e.status === 400 && /phone/i.test(e.message),
  );
});

test('an empty file is refused', () => {
  assert.throws(() => previewLeadImport(Buffer.from('name,phone')), (e) => e.status === 400);
});

test('a formula-injected name survives import preview as data', () => {
  const csv = 'name,phone\n=cmd|\'/c calc\'!A1,919000000009';
  const result = previewLeadImport(Buffer.from(csv));
  assert.equal(result.valid, 1);
  // Import stores it verbatim; the export guard is what makes it safe on the
  // way back out, so the value must not be mangled here.
  assert.match(result.preview[0].name, /^=cmd/);
});
