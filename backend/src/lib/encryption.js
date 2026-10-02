import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '../config/env.js';

// Secrets at rest (WhatsApp/Instagram access tokens, platform settings,
// integration credentials).
//
// Current format: `v2:<kid>:<iv>:<tag>:<ciphertext>` (hex), AES-256-GCM. The tag
// makes a tampered value fail to decrypt instead of decrypting to something
// else, and the key id lets old values keep working while the key is rotated:
// set the new key as ENCRYPTION_KEY, list the old one in
// ENCRYPTION_KEYS_PREVIOUS, run scripts/reencrypt-secrets.js, then drop it.
//
// Legacy format: `<iv>:<ciphertext>` (hex), AES-256-CBC with no MAC. Still
// read, under the current key and then each previous one, so values written
// before GCM keep working until they are re-encrypted.

const V2 = 'v2';
const GCM = 'aes-256-gcm';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const CBC = 'aes-256-cbc';

// A stored secret that cannot be read back: wrong key, tampered or truncated.
// Carries a status so an HTTP path answers with something actionable rather
// than a generic 500.
export class DecryptError extends Error {
  constructor(message = 'A stored credential could not be decrypted. Reconnect it to continue (for a WhatsApp number: disconnect and connect it again).') {
    super(message);
    this.name = 'DecryptError';
    this.status = 422;
    this.code = 'CREDENTIAL_UNREADABLE';
  }
}

// Accept either a 32-char ASCII key (used as raw utf8 bytes) or a 64-char hex
// key (decoded from hex). Both yield the 32 bytes AES-256 requires.
function deriveKey(raw) {
  if (typeof raw !== 'string') throw new Error('ENCRYPTION_KEY missing');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const buf = Buffer.from(raw, 'utf8');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (32 ASCII chars or 64 hex chars)');
  return buf;
}

// Derived from the key so nobody has to assign ids by hand; 8 hex chars of a
// hash says nothing useful about the key itself.
function keyId(key) {
  return createHash('sha256').update('chatflow-kid:').update(key).digest('hex').slice(0, 8);
}

function buildKeyring() {
  const current = deriveKey(env.ENCRYPTION_KEY);
  const previous = String(env.ENCRYPTION_KEYS_PREVIOUS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(deriveKey);
  const keys = [current, ...previous].map((key) => ({ id: keyId(key), key }));
  return { current: keys[0], byId: new Map(keys.map((k) => [k.id, k])), all: keys };
}

const KEYRING = buildKeyring();

export const CURRENT_KEY_ID = KEYRING.current.id;

export function encrypt(text) {
  const { id, key } = KEYRING.current;
  const iv = randomBytes(GCM_IV_LENGTH);
  const cipher = createCipheriv(GCM, key, iv, { authTagLength: GCM_TAG_LENGTH });
  cipher.setAAD(Buffer.from(`${V2}:${id}`));
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [V2, id, iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

const HEX = /^[0-9a-fA-F]*$/;

function decryptV2(parts) {
  const [, id, ivHex, tagHex, dataHex] = parts;
  if (parts.length !== 5 || ivHex.length !== GCM_IV_LENGTH * 2 || tagHex.length !== GCM_TAG_LENGTH * 2
      || !HEX.test(ivHex) || !HEX.test(tagHex) || !HEX.test(dataHex)) {
    throw new DecryptError();
  }
  const entry = KEYRING.byId.get(id);
  if (!entry) throw new DecryptError();
  try {
    const decipher = createDecipheriv(GCM, entry.key, Buffer.from(ivHex, 'hex'), { authTagLength: GCM_TAG_LENGTH });
    decipher.setAAD(Buffer.from(`${V2}:${id}`));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptError();
  }
}

function decryptLegacyCbc(ivHex, dataHex) {
  if (!/^[0-9a-fA-F]{32}$/.test(ivHex || '') || !dataHex || !/^[0-9a-fA-F]+$/.test(dataHex)) {
    throw new DecryptError();
  }
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');
  for (const { key } of KEYRING.all) {
    try {
      const decipher = createDecipheriv(CBC, key, iv);
      const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      // CBC has no MAC: a wrong key still yields valid padding about 1 time
      // in 256. Every secret stored here is text, so random bytes are not it.
      if (isPlainText(plain)) return plain.toString('utf8');
    } catch { /* try the next key */ }
  }
  throw new DecryptError();
}

function isPlainText(buf) {
  const text = buf.toString('utf8');
  // eslint-disable-next-line no-control-regex
  return Buffer.from(text, 'utf8').equals(buf) && !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text);
}

export function decrypt(encryptedText) {
  if (typeof encryptedText !== 'string' || !encryptedText.includes(':')) {
    throw new DecryptError();
  }
  const parts = encryptedText.split(':');
  if (parts[0] === V2) return decryptV2(parts);
  if (parts.length !== 2) throw new DecryptError();
  return decryptLegacyCbc(parts[0], parts[1]);
}

// True when a stored value should be rewritten: legacy CBC, or GCM under a
// key that is no longer current.
export function needsReencryption(encryptedText) {
  if (typeof encryptedText !== 'string') return false;
  const parts = encryptedText.split(':');
  return !(parts[0] === V2 && parts[1] === CURRENT_KEY_ID);
}
