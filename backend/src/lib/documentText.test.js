import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { assertZipWithinLimits } from './documentText.js';

// Minimal ZIP writer: deflated entries, a central directory and its end record.
// `declare` overrides the size the central directory claims, to model a liar.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, declare } of entries) {
    const nameBuf = Buffer.from(name);
    const packed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(declare ?? data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(declare ?? data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('a normal small archive passes', () => {
  assert.doesNotThrow(() => assertZipWithinLimits(zip([
    { name: 'word/document.xml', data: Buffer.from('<w:document>hello</w:document>') },
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
  ])));
});

test('an archive that inflates past the limit is refused', () => {
  const bomb = zip([{ name: 'word/document.xml', data: Buffer.alloc(2 * 1024 * 1024) }]);
  assert.ok(bomb.length < 10 * 1024, 'the test bomb compresses well');
  assert.throws(() => assertZipWithinLimits(bomb, { maxTotal: 1024 * 1024 }), (err) => err.status === 400 && /size limit/.test(err.message));
});

test('lying about the uncompressed size does not get a bomb through', () => {
  const liar = zip([{ name: 'a.xml', data: Buffer.alloc(2 * 1024 * 1024), declare: 100 }]);
  assert.throws(() => assertZipWithinLimits(liar, { maxTotal: 1024 * 1024 }), /size limit/);
});

test('too many entries is refused', () => {
  const many = zip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, data: Buffer.from('x') })));
  assert.throws(() => assertZipWithinLimits(many, { maxEntries: 3 }), /size limit/);
});

test('something that is not a ZIP is refused as invalid', () => {
  assert.throws(() => assertZipWithinLimits(Buffer.from('PK not really a zip file at all, just text')), /not a valid/);
});
