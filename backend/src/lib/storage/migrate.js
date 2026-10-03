import { keys } from './index.js';

// The work behind scripts/migrate-uploads-to-object-storage.js, kept apart
// from the CLI so it can be tested against a temp directory and a fake bucket.
//
// Both passes are idempotent: an object already in the bucket with the same
// size is not uploaded again, and a row is only updated if it still looks the
// way it did when read. Re-running after an interruption picks up where the
// last run stopped.

const MESSAGE_KEY = /^workspaces\/[^/]+\/messages\/([^/]+)$/;

/**
 * Copies every file under the disk driver's root into the bucket, under the
 * same key (keys are driver-independent, so no row needs rewriting).
 *
 * @param {object} args
 * @param {object} args.source   disk driver (has list())
 * @param {object} args.target   s3 driver
 * @param {(key: string) => Promise<string|null>} [args.contentTypeFor]
 * @param {boolean} args.apply
 */
export async function copyDiskToBucket({ source, target, contentTypeFor = async () => null, apply, log = () => {} }) {
  const stats = { files: 0, present: 0, copied: 0, wouldCopy: 0, failed: 0 };
  for await (const key of source.list()) {
    stats.files += 1;
    try {
      const local = await source.head(key);
      const remote = await target.head(key);
      if (remote && local && remote.size === local.size) { stats.present += 1; continue; }
      if (!apply) { stats.wouldCopy += 1; continue; }
      const buffer = await source.getBuffer(key);
      if (!buffer) continue; // removed while running
      await target.put(key, buffer, { contentType: (await contentTypeFor(key)) || 'application/octet-stream' });
      stats.copied += 1;
    } catch (err) {
      stats.failed += 1;
      log(`  ${key}: ${err.message}`);
    }
  }
  return stats;
}

// Content type for a message media file, from its row.
export function messageContentTypeLookup(prisma) {
  return async (key) => {
    const id = key.match(MESSAGE_KEY)?.[1];
    if (!id) return null;
    const row = await prisma.message.findUnique({ where: { id }, select: { mediaMimeType: true } }).catch(() => null);
    return row?.mediaMimeType ? String(row.mediaMimeType).split(';')[0].trim() : null;
  };
}

/**
 * Moves template header images held in Postgres (TemplateAsset.bytes) into the
 * bucket and records TemplateAsset.storageKey. With `purge`, the database copy
 * is cleared once the bucket holds an object of the right size — including for
 * rows copied by an earlier run without --purge-db-bytes.
 */
export async function copyTemplateAssetsToBucket({ prisma, target, apply, purge = false, batchSize = 20, log = () => {} }) {
  const stats = { rows: 0, present: 0, copied: 0, wouldCopy: 0, purged: 0, wouldPurge: 0, raced: 0, failed: 0 };
  let cursor = null;
  for (;;) {
    // Keyed on id rather than a Prisma cursor: rows this loop updates drop out
    // of the filter, and a cursor row that no longer matches would shift the page.
    const rows = await prisma.templateAsset.findMany({
      where: {
        bytes: { not: null },
        ...(purge ? {} : { storageKey: null }),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, workspaceId: true, mimeType: true, sizeBytes: true, storageKey: true, bytes: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      stats.rows += 1;
      try {
        const buffer = Buffer.from(row.bytes);
        const key = row.storageKey || keys.templateAsset(row.workspaceId, row.id);
        const remote = await target.head(key);
        const inBucket = Boolean(remote && remote.size === buffer.length);

        if (!inBucket) {
          if (!apply) { stats.wouldCopy += 1; continue; }
          await target.put(key, buffer, { contentType: row.mimeType });
          stats.copied += 1;
        } else {
          stats.present += 1;
        }
        if (!apply) { if (purge) stats.wouldPurge += 1; continue; }

        const { count } = await prisma.templateAsset.updateMany({
          // Unchanged since it was read: same key state, bytes still present.
          where: { id: row.id, storageKey: row.storageKey, bytes: { not: null } },
          data: { storageKey: key, ...(purge ? { bytes: null } : {}) },
        });
        if (count !== 1) stats.raced += 1;
        else if (purge) stats.purged += 1;
      } catch (err) {
        stats.failed += 1;
        log(`  TemplateAsset ${row.id}: ${err.message}`);
      }
    }
    if (rows.length < batchSize) break;
  }
  return stats;
}
