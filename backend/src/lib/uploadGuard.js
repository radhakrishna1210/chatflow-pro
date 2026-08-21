import multer from 'multer';

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

/**
 * A configured multer instance that accepts only `allowed` mime types.
 *
 * @param {string[]} allowed   mime types this route accepts
 * @param {number}   maxBytes
 */
export function uploader(allowed, maxBytes) {
  const allowedSet = new Set(allowed);
  return multer({
    storage: multer.memoryStorage(),
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
export function verifyFileContents(req, res, next) {
  const files = req.file ? [req.file] : (Array.isArray(req.files) ? req.files : []);
  for (const file of files) {
    const declared = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
    if (!file.buffer || file.buffer.length === 0) {
      return next(reject('That file is empty.'));
    }
    if (!looksLike(file.buffer, declared)) {
      return next(reject(
        `${file.originalname || 'That file'} does not look like a ${declared} file. `
        + 'It may be corrupt, or renamed from another format — re-export it and try again.',
        'FILE_CONTENT_MISMATCH',
      ));
    }
  }
  return next();
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
});
