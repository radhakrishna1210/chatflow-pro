import { env } from '../config/env.js';
import { randomUUID } from 'crypto';

// Errors our own service layer raises carry a `status` and a message written
// for the person reading it. Anything without one is unexpected — a Prisma
// failure, a TypeError, a driver timeout — and its message is written for us,
// not for the client. Those leak schema details, file paths, and occasionally
// connection strings, so they are replaced with a reference the user can quote
// and we can find in the logs.
const GENERIC_5XX = 'Something went wrong on our side. Please try again — quote the reference below if it keeps happening.';

export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  if (err.name === 'ZodError') {
    const issue = err.issues?.[0];
    const field = issue?.path?.join('.') || '';
    const msg = issue?.message || 'Validation error';
    const readable = field && !msg.toLowerCase().includes(field.toLowerCase())
      ? `${msg} (${field})`
      : msg;
    return res.status(400).json({ error: readable, message: readable, details: err.flatten().fieldErrors });
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Multer raises its own error class with no status, so an oversized upload
  // was answering 500 "something went wrong" instead of saying the file was too
  // big — which is a thing the user can act on.
  if (err.name === 'MulterError') {
    const message = {
      LIMIT_FILE_SIZE: 'That file is too large for this upload.',
      LIMIT_FILE_COUNT: 'Only one file can be uploaded at a time.',
      LIMIT_UNEXPECTED_FILE: 'That file was sent under an unexpected field name.',
    }[err.code] || `That upload could not be accepted (${err.code}).`;
    console.warn('[Upload]', req.method, req.url, err.code);
    return res.status(400).json({ error: message, code: err.code });
  }

  // A deliberate 5xx — "the mail service is refusing our credentials", "the
  // payment gateway is not configured" — carries a message written for the
  // user, and replacing it with a generic apology would throw away the only
  // thing that tells them what to do. `expose` is how a service says so; every
  // other 5xx is still treated as unexpected.
  if (status >= 500 && err.expose === true) {
    console.error('[Error]', req.method, req.url, status, err.message);
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    return res.status(status).json(body);
  }

  if (status >= 500) {
    // One id ties the response the user sees to the stack trace we keep.
    const reference = randomUUID().slice(0, 8);
    console.error(`[Error:${reference}]`, req.method, req.url, err);
    return res.status(status).json({
      error: GENERIC_5XX,
      reference,
      // The real message stays available where it is safe to show it. Never in
      // production: `NODE_ENV` is the only thing standing between a Prisma
      // error and the client.
      ...(env.NODE_ENV === 'production' ? {} : { detail: err.message }),
    });
  }

  // Deliberate 4xx: the message is the whole point of raising it.
  console.warn('[Error]', req.method, req.url, status, err.message);
  const body = { error: err.message || 'Request failed' };
  if (err.code) body.code = err.code;
  if (err.details) body.details = err.details;
  return res.status(status).json(body);
}
