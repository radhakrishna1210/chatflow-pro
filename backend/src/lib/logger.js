import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.resolve(__dirname, '../../server_error.log');

export function logToFile(msg, err) {
  const time = new Date().toISOString();
  const errMsg = err ? `\nError: ${err.message}\nStack: ${err.stack}` : '';
  try {
    fs.appendFileSync(logPath, `[${time}] ${msg}${errMsg}\n\n`);
  } catch (e) {
    console.error('Failed to write to log file:', e);
  }
}
