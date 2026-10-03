import { createHash, createHmac } from 'node:crypto';

// AWS Signature Version 4, just enough of it for S3-compatible object storage
// (AWS S3, Cloudflare R2, Supabase Storage's S3 endpoint, MinIO).
//
// Written against node:crypto instead of pulling in @aws-sdk/client-s3: the
// storage driver needs four calls (PUT, GET, HEAD, DELETE) and a presigned GET,
// and the SDK is several megabytes of transitive dependencies for that. The
// signing rules are fixed by the spec and checked against AWS's own published
// examples in sigv4.test.js.
//
// Canonical URIs are taken as given (already percent-encoded, no
// normalisation) — that is S3's rule. The generic-service rule of normalising
// and double-encoding the path is not implemented because nothing here signs
// for any other service.

export const ALGORITHM = 'AWS4-HMAC-SHA256';
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// RFC 3986 percent-encoding as SigV4 defines it: everything but the unreserved
// set A-Z a-z 0-9 - . _ ~ is encoded, hex in upper case. `/` is left alone
// only when encoding a path.
export function uriEncode(value, { keepSlash = false } = {}) {
  let out = '';
  for (const byte of Buffer.from(String(value), 'utf8')) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlash && ch === '/')) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

// An object key as a URL path: each segment encoded, the separators kept.
export const encodeKeyPath = (key) => String(key).split('/').map((s) => uriEncode(s)).join('/');

// 20150830T123600Z and 20150830.
export function amzDate(date) {
  const iso = new Date(date).toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { dateTime: iso, day: iso.slice(0, 8) };
}

export function signingKey(secretAccessKey, day, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

// Query parameters as [name, value] pairs, sorted by encoded name then value.
function canonicalQuery(query) {
  const pairs = Array.isArray(query) ? query : Object.entries(query || {});
  return pairs
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1)))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function canonicalHeaders(headers) {
  const map = new Map();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    const key = name.toLowerCase().trim();
    const clean = String(value).trim().replace(/\s+/g, ' ');
    map.set(key, map.has(key) ? `${map.get(key)},${clean}` : clean);
  }
  const names = [...map.keys()].sort();
  return {
    text: names.map((n) => `${n}:${map.get(n)}\n`).join(''),
    signed: names.join(';'),
  };
}

/**
 * The canonical request and string to sign, exposed for the tests.
 */
export function buildCanonicalRequest({ method, path, query, headers, payloadHash }) {
  const { text, signed } = canonicalHeaders(headers);
  const canonical = [
    method.toUpperCase(),
    path || '/',
    canonicalQuery(query),
    text,
    signed,
    payloadHash,
  ].join('\n');
  return { canonical, signedHeaders: signed };
}

export function buildStringToSign({ dateTime, scope, canonical }) {
  return [ALGORITHM, dateTime, scope, sha256Hex(canonical)].join('\n');
}

/**
 * Signs a request with an Authorization header.
 *
 * `headers` must already hold every header that will be sent and signed —
 * at least `host`. `x-amz-date` (and, for S3, `x-amz-content-sha256`) are
 * added here when absent. Returns the full header set to send.
 *
 * @param {object} req
 * @param {string} req.method
 * @param {string} req.path            already-encoded path, e.g. /bucket/a%20b.txt
 * @param {object|Array} [req.query]   unencoded name/value pairs
 * @param {object} req.headers
 * @param {string} [req.payloadHash]   hex sha256 of the body, or UNSIGNED-PAYLOAD
 * @param {object} creds { accessKeyId, secretAccessKey, sessionToken? }
 * @param {object} scope { region, service, date }
 * @param {object} [opts] { contentSha256Header: true for S3 }
 */
export function signRequest(req, creds, { region, service, date = new Date() }, { contentSha256Header = service === 's3' } = {}) {
  const { dateTime, day } = amzDate(date);
  const payloadHash = req.payloadHash ?? EMPTY_SHA256;
  const headers = { ...req.headers };
  const has = (name) => Object.keys(headers).some((h) => h.toLowerCase() === name);
  if (!has('x-amz-date')) headers['x-amz-date'] = dateTime;
  if (contentSha256Header && !has('x-amz-content-sha256')) headers['x-amz-content-sha256'] = payloadHash;
  if (creds.sessionToken && !has('x-amz-security-token')) headers['x-amz-security-token'] = creds.sessionToken;

  const scopeStr = `${day}/${region}/${service}/aws4_request`;
  const { canonical, signedHeaders } = buildCanonicalRequest({
    method: req.method, path: req.path, query: req.query, headers, payloadHash,
  });
  const stringToSign = buildStringToSign({ dateTime, scope: scopeStr, canonical });
  const signature = hmac(signingKey(creds.secretAccessKey, day, region, service), stringToSign).toString('hex');

  headers.Authorization = `${ALGORITHM} Credential=${creds.accessKeyId}/${scopeStr}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, signature, canonical, stringToSign };
}

/**
 * A presigned URL (query-string authentication). Only `host` is signed, so the
 * URL works from any client — a browser following a redirect included.
 *
 * @returns {{ url: string, signature: string }}
 */
export function presignUrl({ method = 'GET', protocol = 'https:', host, path, query = {} }, creds, {
  region, service = 's3', date = new Date(), expiresIn = 900,
}) {
  const { dateTime, day } = amzDate(date);
  const scopeStr = `${day}/${region}/${service}/aws4_request`;
  const q = {
    ...query,
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${creds.accessKeyId}/${scopeStr}`,
    'X-Amz-Date': dateTime,
    'X-Amz-Expires': String(Math.max(1, Math.min(604800, Math.floor(expiresIn)))),
    'X-Amz-SignedHeaders': 'host',
    ...(creds.sessionToken ? { 'X-Amz-Security-Token': creds.sessionToken } : {}),
  };
  const { canonical } = buildCanonicalRequest({
    method, path, query: q, headers: { host }, payloadHash: UNSIGNED_PAYLOAD,
  });
  const stringToSign = buildStringToSign({ dateTime, scope: scopeStr, canonical });
  const signature = hmac(signingKey(creds.secretAccessKey, day, region, service), stringToSign).toString('hex');
  const search = `${canonicalQuery(q)}&X-Amz-Signature=${signature}`;
  return { url: `${protocol}//${host}${path}?${search}`, signature };
}
