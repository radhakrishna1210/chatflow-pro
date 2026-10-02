import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'crypto';

const CURRENT = 'a'.repeat(64); // hex form
const PREVIOUS = 'previous-key-32-bytes-long-ascii'; // ASCII form

let enc;

// What lib/encryption.js wrote before GCM: `<iv>:<ciphertext>`, AES-256-CBC.
function legacyEncrypt(text, key) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  return `${iv.toString('hex')}:${Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('hex')}`;
}

test.before(async () => {
  mock.module('../config/env.js', {
    namedExports: { env: { ENCRYPTION_KEY: CURRENT, ENCRYPTION_KEYS_PREVIOUS: ` ${PREVIOUS} ` } },
  });
  enc = await import('./encryption.js');
});

test('round-trips through AES-256-GCM with a versioned, key-id prefix', () => {
  const secret = 'EAAG-access-token-ünïcødé';
  const stored = enc.encrypt(secret);
  const parts = stored.split(':');
  assert.equal(parts[0], 'v2');
  assert.equal(parts[1], enc.CURRENT_KEY_ID);
  assert.equal(parts.length, 5);
  assert.equal(enc.decrypt(stored), secret);
  assert.notEqual(enc.encrypt(secret), stored, 'a fresh IV every time');
});

test('reads legacy CBC values under the current key', () => {
  const stored = legacyEncrypt('legacy-token', Buffer.from(CURRENT, 'hex'));
  assert.equal(enc.decrypt(stored), 'legacy-token');
  assert.equal(enc.needsReencryption(stored), true);
});

test('reads legacy CBC values under a previous key', () => {
  const stored = legacyEncrypt('older-token', Buffer.from(PREVIOUS, 'utf8'));
  assert.equal(enc.decrypt(stored), 'older-token');
});

test('a tampered GCM value is rejected, not silently altered', () => {
  const stored = enc.encrypt('do-not-touch');
  const parts = stored.split(':');
  const flipped = (parseInt(parts[4][0], 16) ^ 1).toString(16);
  parts[4] = flipped + parts[4].slice(1);
  assert.throws(() => enc.decrypt(parts.join(':')), (e) => e instanceof enc.DecryptError && e.status === 422);
});

test('an unknown key id or garbage raises DecryptError', () => {
  const parts = enc.encrypt('x').split(':');
  parts[1] = 'ffffffff';
  assert.throws(() => enc.decrypt(parts.join(':')), enc.DecryptError);
  assert.throws(() => enc.decrypt('nonsense'), enc.DecryptError);
  assert.throws(() => enc.decrypt(`${'0'.repeat(32)}:abcd`), enc.DecryptError);
  assert.throws(() => enc.decrypt(null), enc.DecryptError);
});

test('current-key GCM values need no re-encryption', () => {
  assert.equal(enc.needsReencryption(enc.encrypt('y')), false);
});
