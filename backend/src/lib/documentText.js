// Turns an uploaded document into the plain text a knowledge base can index.
//
// One extractor for both knowledge surfaces — the website widget's corpus and
// the WhatsApp AI Agent's knowledge base — so "what counts as a document" and
// the error a user sees when it doesn't are answered in one place.
//
// Parsers are imported lazily. pdf-parse and mammoth together pull in a few MB
// and are only needed the moment someone actually uploads a PDF or a Word file;
// loading them at boot would cost every process that never sees one.

import { inflateRawSync } from 'node:zlib';

const MAX_BYTES = 10 * 1024 * 1024;

// A .docx is a ZIP. 10 MB compressed can inflate to gigabytes, and mammoth
// inflates everything in memory, so the archive is checked first.
const MAX_DOCX_UNCOMPRESSED = 50 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 2000;
// pdf-parse reads every page unless told otherwise; past this a document is
// not knowledge-base material anyway.
const MAX_PDF_PAGES = 300;
const PDF_TIMEOUT_MS = 60_000;

const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };

// What we accept, keyed by extension because browsers are unreliable about the
// mime type of a .md or a .csv (Windows in particular sends octet-stream).
export const SUPPORTED_DOCUMENTS = {
  '.pdf':  { label: 'PDF',             kind: 'pdf' },
  '.docx': { label: 'Word document',   kind: 'docx' },
  '.txt':  { label: 'text file',       kind: 'text' },
  '.md':   { label: 'Markdown file',   kind: 'text' },
  '.csv':  { label: 'CSV file',        kind: 'text' },
};

export const SUPPORTED_EXTENSIONS = Object.keys(SUPPORTED_DOCUMENTS);
// For the file picker's `accept` attribute.
export const DOCUMENT_ACCEPT = '.pdf,.docx,.txt,.md,.csv';

const extensionOf = (fileName) => {
  const match = String(fileName || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
};

// Collapses the whitespace extraction leaves behind while keeping the blank
// lines that mark paragraphs — the chunker splits on those, so flattening them
// would produce one unchunked blob.
function tidy(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    // Form feeds are page breaks in extracted PDF text.
    .replace(/\f/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer, fileName) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  let timer;
  try {
    const result = await Promise.race([
      parser.getText({ first: MAX_PDF_PAGES }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), PDF_TIMEOUT_MS); }),
    ]);
    // pdf-parse stamps a "-- 3 of 12 --" marker between pages. Useful when
    // reading the output, noise when indexing it — a question about "12" would
    // otherwise match every long PDF in the corpus.
    return String(result?.text ?? '').replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '');
  } catch (err) {
    // A password-protected or malformed PDF is a user problem, not a bug, and
    // deserves to say which.
    const reason = /password|encrypt/i.test(err?.message || '')
      ? 'it is password-protected'
      : 'it could not be read';
    fail(`Could not read "${fileName}" — ${reason}.`);
  } finally {
    clearTimeout(timer);
    // Frees the worker; without it a long-lived process leaks one per upload.
    await parser.destroy().catch(() => {}); // cleanup only; the text has already been extracted or the error thrown
  }
}

/**
 * Throws unless the ZIP in `buffer` inflates to at most `maxTotal` bytes in at
 * most `maxEntries` entries.
 *
 * The sizes a ZIP declares can lie, so each entry is actually inflated —
 * with zlib's output capped at what is left of the budget, which is what makes
 * a bomb fail fast instead of filling memory. Nothing inflated here is kept.
 */
export function assertZipWithinLimits(buffer, { maxTotal = MAX_DOCX_UNCOMPRESSED, maxEntries = MAX_DOCX_ENTRIES } = {}) {
  const tooBig = () => fail('That document expands to more than the size limit when opened, so it cannot be read.');
  const invalid = () => fail('That file is not a valid .docx document.');

  // End of central directory: fixed 22 bytes plus a comment of up to 64 KB.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) invalid();
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || offset === 0xffffffff) tooBig(); // ZIP64: far beyond any real .docx
  if (entries > maxEntries) tooBig();

  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) invalid();
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const declaredSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    offset += 46 + nameLen + extraLen + commentLen;

    if (declaredSize > maxTotal - total) tooBig();
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) invalid();
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    let size;
    if (method === 0) size = data.length;
    else if (method === 8) {
      try {
        size = inflateRawSync(data, { maxOutputLength: Math.max(1, maxTotal - total + 1) }).length;
      } catch (err) {
        if (err instanceof RangeError || err?.code === 'ERR_BUFFER_TOO_LARGE') tooBig();
        invalid();
      }
    } else invalid();

    total += size;
    if (total > maxTotal) tooBig();
  }
}

async function extractDocx(buffer, fileName) {
  assertZipWithinLimits(buffer);
  const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
  try {
    // Raw text rather than HTML: the knowledge index wants prose, and markup
    // would be indexed as content.
    const { value } = await mammoth.extractRawText({ buffer });
    return value ?? '';
  } catch {
    fail(`Could not read "${fileName}" — it may not be a valid .docx file. Older .doc files are not supported; re-save it as .docx or PDF.`);
  }
}

/**
 * Extracts text from an uploaded document.
 *
 * Returns { text, label, pages? }. Throws a 400 with a message meant for the
 * person who uploaded the file.
 */
export async function extractDocumentText({ buffer, fileName, mimeType } = {}) {
  if (!buffer?.length) fail('That file is empty.');
  if (buffer.length > MAX_BYTES) {
    fail(`That file is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_BYTES / 1024 / 1024} MB.`);
  }

  const ext = extensionOf(fileName);
  const spec = SUPPORTED_DOCUMENTS[ext];
  if (!spec) {
    // .doc gets its own message because "unsupported" is unhelpful when the
    // fix is a two-click re-save.
    if (ext === '.doc') fail('Old-style .doc files are not supported — re-save it as .docx or PDF and try again.');
    fail(`${ext ? `"${ext}" files are not supported` : 'That file has no extension'}. Upload a PDF, Word document, or plain text file (${SUPPORTED_EXTENSIONS.join(', ')}).`);
  }

  let raw;
  if (spec.kind === 'pdf') raw = await extractPdf(buffer, fileName);
  else if (spec.kind === 'docx') raw = await extractDocx(buffer, fileName);
  else {
    // Text formats. A CSV is left as-is: its rows are already line-separated
    // prose as far as retrieval is concerned, and reformatting it into
    // sentences would invent structure the file does not have.
    raw = buffer.toString('utf8');
    // A binary file renamed to .txt decodes into replacement characters.
    if (raw.includes(' ')) fail(`"${fileName}" does not look like a text file.`);
  }

  const text = tidy(raw);
  if (text.length < 20) {
    fail(`"${fileName}" had no readable text.${spec.kind === 'pdf' ? ' Scanned PDFs are images — they need OCR before they can be indexed.' : ''}`);
  }

  return { text, label: spec.label };
}

// Trims text to a ceiling without cutting mid-sentence, and says how much went.
// Used where the destination has a hard size limit (the AI agent's knowledge
// column) so a too-long document is visibly shortened rather than silently cut.
export function truncateAtSentence(text, limit) {
  const value = String(text || '');
  if (value.length <= limit) return { text: value, truncated: false, dropped: 0 };

  const slice = value.slice(0, limit);
  // Prefer a sentence end, then a paragraph, then a word — whichever is close
  // enough to the limit to not throw away a meaningful amount.
  const floor = Math.floor(limit * 0.6);
  const candidates = [
    slice.lastIndexOf('. '), slice.lastIndexOf('.\n'),
    slice.lastIndexOf('!'), slice.lastIndexOf('?'),
    slice.lastIndexOf('\n\n'),
  ].filter((i) => i > floor);
  const cut = candidates.length ? Math.max(...candidates) + 1 : (slice.lastIndexOf(' ') > floor ? slice.lastIndexOf(' ') : limit);

  const kept = value.slice(0, cut).trim();
  return { text: kept, truncated: true, dropped: value.length - kept.length };
}
