import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// Accept either a 32-char ASCII key (used as raw utf8 bytes) or a 64-char hex
// key (decoded from hex). Both yield the 32 bytes AES-256 requires.
function deriveKey(raw) {
  if (typeof raw !== 'string') throw new Error('ENCRYPTION_KEY missing');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const buf = Buffer.from(raw, 'utf8');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (32 ASCII chars or 64 hex chars)');
  return buf;
}

const KEY = deriveKey(env.ENCRYPTION_KEY);

export function encrypt(text) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(encryptedText) {
  if (typeof encryptedText !== 'string' || !encryptedText.includes(':')) {
    throw new Error('Malformed encrypted value');
  }
  const [ivHex, dataHex] = encryptedText.split(':');
  if (!/^[0-9a-fA-F]{32}$/.test(ivHex || '') || !dataHex || !/^[0-9a-fA-F]+$/.test(dataHex)) {
    throw new Error('Malformed encrypted value');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
