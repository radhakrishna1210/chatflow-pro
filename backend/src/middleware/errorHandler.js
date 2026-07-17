export function errorHandler(err, req, res, next) {
  console.error('[Error]', err);

  if (err.name === 'ZodError') {
    return res.status(400).json({ error: 'Validation error', details: err.flatten().fieldErrors });
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const body = { error: message };
  // Only surface `code` for intentional 4xx errors thrown by our own service
  // layer (e.g. PLAN_LIMIT_REACHED) — never for unexpected 500s, where it'd
  // just leak internal error codes (e.g. Prisma's P2002) to the client.
  if (err.code && status < 500) body.code = err.code;
  res.status(status).json(body);
}
