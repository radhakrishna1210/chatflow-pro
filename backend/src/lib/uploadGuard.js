import multer from 'multer';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { rateLimit } from '../middleware/rateLimit.js';

// Upload validation.
//
// The four upload routes each configured multer with a size limit and nothing
// else: no fileFilter, and no check that the bytes matched the declared type.
// `file.mimetype` is whatever the client's Content-Type header said, so a
// caller could label a script `image/png` and have it accepted on trust — and
// the template path forwards that declared type straight to Meta.
//
// Two checks, in order:
//   1. the declared type is one this route accepts at all;
//   2. the leading bytes actually are that kind of file.
//
// The second is what makes the first mean anything.

// Magic numbers for the formats the product accepts. Kept deliberately short —
// these identify the container, and anything claiming to be one of them without
// the right prefix is not.
const SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', test: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'application/pdf', test: (b) => b.slice(0, 4).toString('ascii') === '%PDF' },
  // ID3 tag, or a raw MPEG frame sync.
  { mime: 'audio/mpeg', test: (b) => b.slice(0, 3).toString('ascii') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { mime: 'audio/ogg', test: (b) => b.slice(0, 4).toString('ascii') === 'OggS' },
  // MP4 and friends put a size field first, then 'ftyp' at offset 4.
  { mime: 'video/mp4', test: (b) => b.slice(4, 8).toString('ascii') === 'ftyp' },
  // Office formats are ZIP containers.
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  },
];

// Formats with no reliable signature. Text and CSV are genuinely just bytes, so
// they are validated by being parsed downstream rather than by a prefix — the
// CSV importer already rejects anything it cannot read.
const UNSIGNED = new Set(['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel']);

function looksLike(buffer, mime) {
  if (UNSIGNED.has(mime)) {
    // Reject content with NUL bytes in the first block: real text does not
    // contain them, and it is the cheapest way to catch a binary payload
    // wearing a .csv extension.
    return !buffer.slice(0, 512).includes(0x00);
  }
  const sig = SIGNATURES.find((s) => s.mime === mime);
  if (!sig) return false;
  return sig.test(buffer);
}

function reject(message, code = 'UNSUPPORTED_FILE') {
  const e = new Error(message);
  e.status = 400;
  e.code = code;
  e.expose = true;
  return e;
}

// Routes that take large files (media up to Meta's 100 MB) stream the upload
// to a temp file instead of buffering it in the heap while it arrives: a slow
// client, or ten at once, would otherwise pin that memory in the one process
// that also runs every worker. The bytes are loaded only once the whole file
// has arrived and passed the content check, a few files at a time.
const UPLOAD_DIR = path.join(os.tmpdir(), 'spandan-uploads');
const DISK_THRESHOLD_BYTES = 10 * 1024 * 1024;
const MAX_LARGE_FILES_IN_MEMORY = 4;

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fsp.mkdir(UPLOAD_DIR, { recursive: true }).then(() => cb(null, UPLOAD_DIR), cb);
  },
  filename: (req, file, cb) => cb(null, randomBytes(16).toString('hex')),
});

let largeFilesInMemory = 0;
const waitingForMemory = [];
function acquireMemorySlot() {
  if (largeFilesInMemory < MAX_LARGE_FILES_IN_MEMORY) {
    largeFilesInMemory += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitingForMemory.push(resolve));
}
function releaseMemorySlot() {
  const next = waitingForMemory.shift();
  if (next) next();
  else largeFilesInMemory -= 1;
}

async function readHead(filePath, bytes = 512) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Per member: large uploads are the expensive request in this process.
export const uploadRateLimit = rateLimit({
  windowMs: 10 * 60_000,
  max: 60,
  keyPrefix: 'uploads',
  by: (req) => (req.user?.id ? `user:${req.user.id}` : null),
});

/**
 * A configured multer instance that accepts only `allowed` mime types.
 *
 * @param {string[]} allowed   mime types this route accepts
 * @param {number}   maxBytes
 */
export function uploader(allowed, maxBytes) {
  const allowedSet = new Set(allowed);
  return multer({
    storage: maxBytes > DISK_THRESHOLD_BYTES ? diskStorage : multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    // First gate: the declared type. Cheap, and rejects before any bytes are
    // buffered.
    fileFilter: (req, file, cb) => {
      const declared = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
      if (!allowedSet.has(declared)) {
        return cb(reject(
          `${file.originalname || 'That file'} is a ${declared || 'unknown'} file. `
          + `This upload accepts ${allowed.join(', ')}.`,
        ));
      }
      return cb(null, true);
    },
  });
}

/**
 * Second gate, after multer has the bytes: the content must match the type it
 * claimed. Mount immediately after the uploader on any route that takes a file.
 */
export async function verifyFileContents(req, res, next) {
  const files = req.file ? [req.file] : (Array.isArray(req.files) ? req.files : []);
  const onDisk = files.filter((f) => f.path && !f.buffer);
  // Temp files go when the response does, however the handler ends.
  if (onDisk.length) {
    res.once('close', () => { for (const f of onDisk) fsp.unlink(f.path).catch(() => {}); /* may already be gone; the OS temp dir is the backstop */ });
  }

  try {
    for (const file of files) {
      const declared = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
      const size = file.buffer ? file.buffer.length : file.size;
      if (!size) return next(reject('That file is empty.'));
      const head = file.buffer ?? await readHead(file.path);
      if (!looksLike(head, declared)) {
        return next(reject(
          `${file.originalname || 'That file'} does not look like a ${declared} file. `
          + 'It may be corrupt, or renamed from another format — re-export it and try again.',
          'FILE_CONTENT_MISMATCH',
        ));
      }
    }

    // Handlers read file.buffer, so a verified disk upload is loaded for
    // them — bounded, so a burst of large uploads queues instead of stacking
    // up in memory.
    if (onDisk.length) {
      await acquireMemorySlot();
      let released = false;
      const release = () => { if (!released) { released = true; releaseMemorySlot(); } };
      res.once('close', release);
      if (res.destroyed || res.writableFinished) { release(); return undefined; }
      for (const file of onDisk) file.buffer = await fsp.readFile(file.path);
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// The sets each route accepts, named so the intent is visible at the mount.
export const ACCEPTS = Object.freeze({
  // Meta's own limits for template headers (see lib/meta.js).
  templateMedia: ['image/jpeg', 'image/png', 'video/mp4', 'application/pdf'],
  csv: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  knowledge: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
  ],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  // What WhatsApp accepts as a message attachment, which is a different (and
  // wider) set than a template header — see OUTBOUND_MEDIA_TYPES in lib/meta.js.
  outboundMedia: ['image/jpeg', 'image/png', 'video/mp4', 'audio/mpeg', 'audio/ogg', 'application/pdf'],
});
