import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.js';
import { createDiskDriver } from './disk.js';
import { createS3Driver } from './s3.js';

// The one place the app keeps file bytes it has to read back later: inbound
// and outbound WhatsApp media, and template header images (when an object
// store is configured — see templateImage.service.js#storeAsset).
//
// Two drivers behind one interface:
//
//   put(key, buffer, { contentType })   -> { key, size }
//   get(key)                            -> { stream, size, contentType } | null
//   getBuffer(key)                      -> Buffer | null
//   head(key)                           -> { size, contentType } | null
//   delete(key)
//   signedUrl(key, { expiresIn, contentType, filename }) -> string | null
//
//   s3   — any S3-compatible bucket (AWS S3, Cloudflare R2, Supabase Storage,
//          MinIO). Selected by S3_BUCKET (or STORAGE_DRIVER=s3).
//   disk — <STORAGE_DISK_ROOT or backend/uploads>/<key>. The default, and the
//          development fallback. Lost on every Render deploy.
//
// Keys never depend on the driver, so moving from disk to a bucket is a copy
// (scripts/migrate-uploads-to-object-storage.js) with no database rewrite.

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_DISK_ROOT = path.join(BACKEND_DIR, 'uploads');

const truthy = (v) => ['1', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase());

/**
 * Reads the storage settings out of an env-like object. Pure, for the tests.
 */
export function storageConfigFrom(source) {
  const requested = String(source.STORAGE_DRIVER || '').trim().toLowerCase();
  const driver = requested || (source.S3_BUCKET ? 's3' : 'disk');
  if (driver !== 's3' && driver !== 'disk') {
    throw new Error(`STORAGE_DRIVER must be "s3" or "disk", not "${requested}".`);
  }
  if (driver === 'disk') {
    return { driver, root: source.STORAGE_DISK_ROOT ? path.resolve(source.STORAGE_DISK_ROOT) : DEFAULT_DISK_ROOT };
  }
  const missing = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !source[k]);
  if (missing.length) {
    throw new Error(`Object storage is selected but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set.`);
  }
  return {
    driver,
    bucket: source.S3_BUCKET,
    region: source.S3_REGION || (source.S3_ENDPOINT ? 'auto' : 'us-east-1'),
    endpoint: source.S3_ENDPOINT || null,
    accessKeyId: source.S3_ACCESS_KEY_ID,
    secretAccessKey: source.S3_SECRET_ACCESS_KEY,
    sessionToken: source.S3_SESSION_TOKEN || null,
    forcePathStyle: truthy(source.S3_FORCE_PATH_STYLE),
    prefix: source.S3_PREFIX ? `${String(source.S3_PREFIX).replace(/^\/+|\/+$/g, '')}/` : '',
  };
}

export function createStorage(config, deps) {
  return config.driver === 's3' ? createS3Driver(config, deps) : createDiskDriver(config);
}

let current = null;

export function getStorage() {
  if (!current) current = createStorage(storageConfigFrom(env));
  return current;
}

// Tests swap in an in-memory or temp-dir driver.
export function setStorage(driver) {
  current = driver;
}

// Forwarders, so callers can `import { storage }` without caring when the
// driver is built.
export const storage = {
  put: (...a) => getStorage().put(...a),
  get: (...a) => getStorage().get(...a),
  getBuffer: (...a) => getStorage().getBuffer(...a),
  head: (...a) => getStorage().head(...a),
  delete: (...a) => getStorage().delete(...a),
  signedUrl: (...a) => getStorage().signedUrl(...a),
  get driver() { return getStorage().driver; },
  get objectStore() { return getStorage().objectStore; },
  describe: () => getStorage().describe(),
};

// Key layout. Everything is under the workspace so a bucket listing (or a
// lifecycle rule) can be scoped to one.
const safe = (part) => String(part).replace(/[^A-Za-z0-9._-]/g, '_');
export const keys = {
  messageMedia: (workspaceId, messageId) => `workspaces/${safe(workspaceId)}/messages/${safe(messageId)}`,
  templateAsset: (workspaceId, id) => `workspaces/${safe(workspaceId)}/template-assets/${safe(id)}`,
};

/**
 * The boot-time warning for the one configuration that loses data: the disk
 * driver on a host whose disk does not survive a deploy. Returns the message,
 * or null when there is nothing to say.
 */
export function ephemeralDiskWarning(source = process.env) {
  let cfg;
  try {
    cfg = storageConfigFrom(source);
  } catch (err) {
    return `[Storage] Misconfigured: ${err.message}`;
  }
  if (cfg.driver !== 'disk' || source.NODE_ENV !== 'production') return null;
  const onRender = truthy(source.RENDER) || Boolean(source.RENDER_SERVICE_ID);
  if (!onRender) return null;
  return [
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    '[Storage] WARNING: uploads are on Render\'s local disk, which is WIPED on every deploy',
    `[Storage] and restart (${cfg.root}). Archived WhatsApp media will be lost; the inbox`,
    '[Storage] falls back to re-fetching from Meta, which only works for ~30 days.',
    '[Storage] Set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (and S3_ENDPOINT /',
    '[Storage] S3_REGION for R2, Supabase or MinIO). See DEPLOY.md section 4.',
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
  ].join('\n');
}
