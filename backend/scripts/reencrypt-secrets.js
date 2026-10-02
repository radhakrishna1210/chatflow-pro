#!/usr/bin/env node
/**
 * Re-encrypts every stored secret under the current ENCRYPTION_KEY (AES-GCM).
 *
 * Use it after moving to GCM, and to finish a key rotation:
 *   1. Set the new key as ENCRYPTION_KEY and the old one in
 *      ENCRYPTION_KEYS_PREVIOUS; deploy.
 *   2. node scripts/reencrypt-secrets.js            (dry run: counts only)
 *      node scripts/reencrypt-secrets.js --apply    (rewrites the rows)
 *   3. Once it reports nothing left to do and no unreadable values, remove
 *      ENCRYPTION_KEYS_PREVIOUS.
 *
 * Each row is rewritten only if it still holds the value that was read, so a
 * credential changed while this runs is never overwritten with a stale one.
 * Values that cannot be decrypted with any configured key are reported and
 * left alone — those numbers/integrations have to be reconnected.
 */
import { prisma } from '../src/lib/prisma.js';
import { decrypt, encrypt, needsReencryption } from '../src/lib/encryption.js';

const APPLY = process.argv.includes('--apply');

// [model, primary-key field, encrypted column, column is nullable]
const TARGETS = [
  ['waNumber', 'id', 'encryptedAccessToken', false],
  ['numberPool', 'id', 'encryptedAccessToken', true],
  ['workspace', 'id', 'instagramAccessToken', true],
  ['workspaceIntegration', 'id', 'encryptedCredentials', true],
  ['systemSetting', 'key', 'value', false],
];

async function reencryptTable([model, pk, column, nullable]) {
  const rows = await prisma[model].findMany({
    where: nullable ? { [column]: { not: null } } : {},
    select: { [pk]: true, [column]: true },
  });
  const stats = { model, total: rows.length, current: 0, rewritten: 0, unreadable: 0, raced: 0 };

  for (const row of rows) {
    const stored = row[column];
    if (!stored || !needsReencryption(stored)) { stats.current += 1; continue; }

    let plain;
    try {
      plain = decrypt(stored);
    } catch {
      stats.unreadable += 1;
      console.warn(`  ${model} ${row[pk]}: cannot be decrypted with any configured key`);
      continue;
    }
    if (!APPLY) { stats.rewritten += 1; continue; }

    const { count } = await prisma[model].updateMany({
      where: { [pk]: row[pk], [column]: stored },
      data: { [column]: encrypt(plain) },
    });
    if (count === 1) stats.rewritten += 1; else stats.raced += 1;
  }
  return stats;
}

async function main() {
  console.log(APPLY ? 'Re-encrypting stored secrets…' : 'Dry run (pass --apply to write)…');
  for (const target of TARGETS) {
    const s = await reencryptTable(target);
    console.log(
      `${s.model}: ${s.total} value(s), ${s.current} already current, `
      + `${s.rewritten} ${APPLY ? 're-encrypted' : 'to re-encrypt'}, ${s.unreadable} unreadable`
      + `${s.raced ? `, ${s.raced} changed during the run (left as is)` : ''}`,
    );
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
