import { prisma } from '../lib/prisma.js';

// ─── Platform audit trail ────────────────────────────────────────────────────
//
// What an operator did, to whom, and when. The Admin control deck could already
// impersonate a user, suspend a workspace, rewrite a plan's entitlements and
// move a wallet balance — all of it leaving no trace anyone could read back.
// This is that trace.
//
// Two deliberate choices:
//
//   * Writes never throw. An audit failure must not turn a successful
//     suspension into a 500, which would leave the operator unsure whether the
//     action landed. A dropped row is visible in the log's own gaps; a failed
//     suspension is not.
//   * Rows are not workspace-scoped and are never cascade-deleted. The most
//     interesting entry in an audit log is usually about something that no
//     longer exists.

export async function record({ actor, action, targetType = '', targetLabel = '', reason = null, meta = null }) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId: actor?.id || null,
        actorEmail: String(actor?.email || 'unknown').slice(0, 200),
        action: String(action || '').slice(0, 80),
        targetType: String(targetType || '').slice(0, 40),
        targetLabel: String(targetLabel || '').slice(0, 200),
        reason: reason ? String(reason).slice(0, 500) : null,
        meta: meta ?? undefined,
      },
    });
  } catch (err) {
    console.error('[Audit] could not record', action, err?.message);
  }
}

export async function list({ limit = 100, action = '', search = '' } = {}) {
  const where = {};
  if (action) where.action = action;
  if (search) {
    where.OR = [
      { actorEmail:  { contains: search, mode: 'insensitive' } },
      { targetLabel: { contains: search, mode: 'insensitive' } },
      { action:      { contains: search, mode: 'insensitive' } },
    ];
  }
  return prisma.adminAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(500, Math.max(1, limit)),
  });
}

// The distinct actions present in the log, for the filter dropdown. Read from
// the data rather than a hardcoded list so a newly audited action appears in
// the filter the first time it happens.
export async function actions() {
  const rows = await prisma.adminAuditLog.groupBy({
    by: ['action'],
    _count: { _all: true },
    orderBy: { _count: { action: 'desc' } },
    take: 40,
  });
  return rows.map((r) => ({ action: r.action, count: r._count._all }));
}

// Counts for the security summary strip: how much happened, and how much of it
// was the sensitive kind.
export async function summary(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [total, impersonations, suspensions, walletAdjustments] = await Promise.all([
    prisma.adminAuditLog.count({ where: { createdAt: { gte: since } } }),
    prisma.adminAuditLog.count({ where: { createdAt: { gte: since }, action: 'impersonate' } }),
    prisma.adminAuditLog.count({ where: { createdAt: { gte: since }, action: { in: ['suspend', 'reinstate'] } } }),
    prisma.adminAuditLog.count({ where: { createdAt: { gte: since }, action: 'wallet.adjust' } }),
  ]);
  return { days, total, impersonations, suspensions, walletAdjustments };
}
