import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.resolve(__dirname, '../../server_error.log');

// Rotate past this size so the log cannot fill an ephemeral disk between
// deploys. One previous generation is kept as server_error.log.1.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function format(msg, err) {
  const time = new Date().toISOString();
  const errMsg = err ? `\nError: ${err.message}\nStack: ${err.stack}` : '';
  return `[${time}] ${msg}${errMsg}\n\n`;
}

// Tracked in memory so the hot path never stats the file. -1 means "not read
// yet"; the first write seeds it from disk.
let size = -1;

// Serialises appends so concurrent requests cannot interleave partial lines.
// Rotation happens inside the queue too: doing it at enqueue time would let
// the size counter run ahead of what has actually reached disk.
let queue = Promise.resolve();

async function writeLine(line) {
  if (size < 0) {
    try {
      size = (await fs.promises.stat(logPath)).size;
    } catch {
      size = 0; // no log on disk yet
    }
  }
  const bytes = Buffer.byteLength(line);
  if (size + bytes > MAX_LOG_BYTES) {
    try {
      await fs.promises.rename(logPath, `${logPath}.1`);
    } catch {
      // Nothing to rotate — first write, or the file vanished under us.
    }
    size = 0;
  }
  await fs.promises.appendFile(logPath, line);
  size += bytes;
}

/**
 * Non-blocking append. Use for anything on the request path — a synchronous
 * write there stalls the event loop once per request.
 */
export function logToFile(msg, err) {
  const line = format(msg, err);
  queue = queue.then(() => writeLine(line).catch((e) => {
    console.error('Failed to write to log file:', e);
  }));
}

/**
 * Blocking append. Use only where the process is about to exit and a queued
 * async write would never flush — uncaught exceptions and fatal startup
 * errors. Reads the size from disk rather than trusting the shared counter,
 * since queued appends may still be in flight.
 */
export function logToFileSync(msg, err) {
  const line = format(msg, err);
  try {
    let current = 0;
    try {
      current = fs.statSync(logPath).size;
    } catch {
      current = 0;
    }
    const bytes = Buffer.byteLength(line);
    if (current + bytes > MAX_LOG_BYTES) {
      try {
        fs.renameSync(logPath, `${logPath}.1`);
      } catch {
        // Nothing to rotate.
      }
      current = 0;
    }
    fs.appendFileSync(logPath, line);
    size = current + bytes;
  } catch (e) {
    console.error('Failed to write to log file:', e);
  }
}
