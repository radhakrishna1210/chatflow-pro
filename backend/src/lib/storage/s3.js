import { Readable } from 'node:stream';
import { signRequest, presignUrl, encodeKeyPath, sha256Hex, EMPTY_SHA256 } from './sigv4.js';

// S3-compatible object storage driver: AWS S3, Cloudflare R2, Supabase
// Storage (its S3 endpoint), MinIO. Plain fetch + SigV4 (./sigv4.js).
//
// Addressing:
//   - S3_ENDPOINT set (R2, Supabase, MinIO): path-style,
//       <endpoint>/<bucket>/<key>  — the endpoint may carry a path prefix, as
//       Supabase's does (/storage/v1/s3), and it is signed as part of the path.
//   - no endpoint (AWS): virtual-hosted, https://<bucket>.s3.<region>.amazonaws.com/<key>,
//     or path-style on s3.<region>.amazonaws.com when S3_FORCE_PATH_STYLE=true.

const REQUEST_TIMEOUT_MS = 60_000;

export function storageError(message, { status = 502, code = 'STORAGE_ERROR' } = {}) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function parseErrorCode(xml) {
  return String(xml || '').match(/<Code>([^<]+)<\/Code>/)?.[1] ?? null;
}

/**
 * @param {object} cfg
 * @param {string} cfg.bucket
 * @param {string} cfg.region          'auto' for R2; the project region for Supabase
 * @param {string} [cfg.endpoint]
 * @param {string} cfg.accessKeyId
 * @param {string} cfg.secretAccessKey
 * @param {string} [cfg.sessionToken]
 * @param {boolean} [cfg.forcePathStyle]
 * @param {string} [cfg.prefix]        prepended to every key, e.g. "prod/"
 * @param {object} [deps] { fetch, now } — injectable for tests
 */
export function createS3Driver(cfg, { fetch: fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const { bucket, accessKeyId, secretAccessKey } = cfg;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3 storage needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
  }
  const region = cfg.region || 'us-east-1';
  const creds = { accessKeyId, secretAccessKey, sessionToken: cfg.sessionToken || undefined };
  const prefix = String(cfg.prefix || '').replace(/^\/+/, '');

  let protocol;
  let host;
  let basePath;
  if (cfg.endpoint) {
    const u = new URL(cfg.endpoint);
    protocol = u.protocol;
    host = u.host;
    basePath = `${u.pathname.replace(/\/+$/, '')}/${encodeKeyPath(bucket)}`;
  } else if (cfg.forcePathStyle) {
    protocol = 'https:';
    host = `s3.${region}.amazonaws.com`;
    basePath = `/${encodeKeyPath(bucket)}`;
  } else {
    protocol = 'https:';
    host = `${bucket}.s3.${region}.amazonaws.com`;
    basePath = '';
  }

  const fullKey = (key) => {
    const k = String(key || '');
    if (!k || k.startsWith('/') || k.split('/').some((s) => s === '..' || s === '')) {
      throw storageError(`Invalid storage key: ${JSON.stringify(key)}`, { status: 400, code: 'INVALID_KEY' });
    }
    return `${prefix}${k}`;
  };
  const pathFor = (key) => `${basePath}/${encodeKeyPath(fullKey(key))}`;

  async function send(method, key, { body = null, headers = {}, payloadHash = EMPTY_SHA256 } = {}) {
    const path = pathFor(key);
    const { headers: signed } = signRequest(
      { method, path, headers: { host, ...headers }, payloadHash },
      creds,
      { region, service: 's3', date: now() },
    );
    // fetch derives Host from the URL itself and refuses to have it set.
    delete signed.host;
    let res;
    try {
      res = await fetchImpl(`${protocol}//${host}${path}`, {
        method,
        headers: signed,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw storageError(`Object storage unreachable (${method} ${fullKey(key)}): ${err.message}`);
    }
    return res;
  }

  async function fail(res, what) {
    const text = await res.text().catch(() => '');
    const code = parseErrorCode(text);
    throw storageError(`Object storage refused ${what}: HTTP ${res.status}${code ? ` ${code}` : ''}`, {
      status: res.status === 404 ? 404 : 502,
      code: code || 'STORAGE_ERROR',
    });
  }

  async function put(key, body, { contentType = 'application/octet-stream', cacheControl } = {}) {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const res = await send('PUT', key, {
      body: data,
      payloadHash: sha256Hex(data),
      headers: {
        // Content-Length is left to fetch, which derives it from the buffer.
        'content-type': contentType || 'application/octet-stream',
        ...(cacheControl ? { 'cache-control': cacheControl } : {}),
      },
    });
    if (!res.ok) await fail(res, `the upload of ${key}`);
    await res.arrayBuffer().catch(() => {}); // drain the body so the socket is reused; nothing to report
    return { key, size: data.length, contentType };
  }

  async function head(key) {
    const res = await send('HEAD', key);
    if (res.status === 404) return null;
    if (!res.ok) await fail(res, `HEAD ${key}`);
    return {
      size: Number(res.headers.get('content-length')) || 0,
      contentType: res.headers.get('content-type'),
    };
  }

  async function get(key) {
    const res = await send('GET', key);
    if (res.status === 404) { await res.arrayBuffer().catch(() => {}); return null; }
    if (!res.ok) await fail(res, `the download of ${key}`);
    return {
      stream: res.body ? Readable.fromWeb(res.body) : Readable.from([]),
      size: Number(res.headers.get('content-length')) || null,
      contentType: res.headers.get('content-type'),
    };
  }

  async function getBuffer(key) {
    const res = await send('GET', key);
    if (res.status === 404) { await res.arrayBuffer().catch(() => {}); return null; }
    if (!res.ok) await fail(res, `the download of ${key}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async function remove(key) {
    const res = await send('DELETE', key);
    // S3 answers 204 whether or not the object existed; some compatibles 404.
    if (!res.ok && res.status !== 404) await fail(res, `the delete of ${key}`);
    await res.arrayBuffer().catch(() => {});
  }

  // A time-limited GET link straight to the bucket, so large media is not
  // proxied through the app. The response headers can be overridden so the
  // browser gets the type and file name kept in the database.
  async function signedUrl(key, { expiresIn = 900, contentType, filename } = {}) {
    const query = {};
    if (contentType) query['response-content-type'] = contentType;
    if (filename) {
      const ascii = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      query['response-content-disposition'] = `inline; filename="${ascii}"`;
    }
    return presignUrl(
      { method: 'GET', protocol, host, path: pathFor(key), query },
      creds,
      { region, service: 's3', date: now(), expiresIn },
    ).url;
  }

  return {
    driver: 's3',
    objectStore: true,
    put,
    head,
    get,
    getBuffer,
    delete: remove,
    signedUrl,
    describe: () => `s3 bucket "${bucket}" at ${protocol}//${host}${basePath || ''}`,
  };
}
