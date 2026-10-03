#!/usr/bin/env node
/**
 * Copies stored files into the S3-compatible bucket (CF-165). One-off, and
 * safe to re-run: anything already in the bucket with the same size is
 * skipped, and rows are only updated if unchanged since they were read.
 *
 *   node scripts/migrate-uploads-to-object-storage.js                  dry run: counts only
 *   node scripts/migrate-uploads-to-object-storage.js --apply          copy
 *   node scripts/migrate-uploads-to-object-storage.js --apply --purge-db-bytes
 *        also clears TemplateAsset.bytes once the bucket holds the image
 *
 * Options:
 *   --from <dir>     local uploads directory (default STORAGE_DISK_ROOT, else backend/uploads)
 *   --skip-disk      do not copy local files
 *   --skip-db        do not move TemplateAsset bytes out of Postgres
 *
 * Needs the bucket settings in the environment (S3_BUCKET, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY, and S3_ENDPOINT / S3_REGION for R2, Supabase or
 * MinIO). The bucket is the target whatever STORAGE_DRIVER says, so this can
 * run before the app is switched over:
 *   1. set the S3_* variables (STORAGE_DRIVER=disk keeps the app on disk meanwhile);
 *   2. run with --apply where the old files are (the VPS backend/ directory);
 *   3. switch the app to the bucket (unset STORAGE_DRIVER), redeploy;
 *   4. run --apply once more to catch files written in between;
 *   5. optionally --purge-db-bytes to shrink Postgres.
 */
import { prisma } from '../src/lib/prisma.js';
import { storageConfigFrom, createStorage } from '../src/lib/storage/index.js';
import { createDiskDriver } from '../src/lib/storage/disk.js';
import {
  copyDiskToBucket, copyTemplateAssetsToBucket, messageContentTypeLookup,
} from '../src/lib/storage/migrate.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PURGE = args.includes('--purge-db-bytes');
const fromIdx = args.indexOf('--from');
const FROM = fromIdx >= 0 ? args[fromIdx + 1] : null;

async function main() {
  let target;
  try {
    target = createStorage(storageConfigFrom({ ...process.env, STORAGE_DRIVER: 's3' }));
  } catch (err) {
    console.error(`Cannot reach a bucket: ${err.message}`);
    process.exit(1);
  }
  const diskCfg = storageConfigFrom({ ...process.env, STORAGE_DRIVER: 'disk', ...(FROM ? { STORAGE_DISK_ROOT: FROM } : {}) });
  const source = createDiskDriver(diskCfg);

  console.log(`${APPLY ? 'Copying' : 'Dry run (pass --apply to copy)'} into ${target.describe()}`);

  if (!args.includes('--skip-disk')) {
    console.log(`\nLocal files under ${source.root}:`);
    const stats = await copyDiskToBucket({
      source, target, apply: APPLY, contentTypeFor: messageContentTypeLookup(prisma), log: console.warn,
    });
    console.log(`  ${JSON.stringify(stats)}`);
  }

  if (!args.includes('--skip-db')) {
    console.log(`\nTemplate images stored in Postgres${PURGE ? ' (purging the database copy)' : ''}:`);
    const stats = await copyTemplateAssetsToBucket({ prisma, target, apply: APPLY, purge: PURGE, log: console.warn });
    console.log(`  ${JSON.stringify(stats)}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
