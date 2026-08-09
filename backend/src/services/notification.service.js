import { prisma } from '../lib/prisma.js';

// Real in-app notifications, replacing the derived list the bell used to
// compute client-side (which had no read state, so it could never be
// dismissed). A notification is either addressed to one user (`userId`) or to
// a whole workspace (`workspaceId`, userId null) — the latter tracks read
// state per user in NotificationRead so one member reading it doesn't clear
// the badge for everybody.

const MAX_FEED = 50;

function serialize(row, readAt) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    meta: row.meta,
    createdAt: row.createdAt,
    read: !!(row.userId ? row.readAt : readAt),
    scope: row.userId ? 'user' : 'workspace',
  };
}

// Notify one specific person. Used for invitations, where the whole point is
// that a named account is being asked to join.
export async function notifyUser(userId, { type, title, body = null, link = null, meta = null, workspaceId = null }) {
  if (!userId || !title) return null;
  return prisma.notification.create({
    data: { userId, workspaceId, type, title, body, link, meta: meta ?? undefined },
  });
}

// Notify everyone in a workspace (campaign finished, template approved, a
// contact opted out, wallet running low).
export async function notifyWorkspace(workspaceId, { type, title, body = null, link = null, meta = null }) {
  if (!workspaceId || !title) return null;
  return prisma.notification.create({
    data: { workspaceId, userId: null, type, title, body, link, meta: meta ?? undefined },
  });
}

// Notify a workspace about something that happens once per recipient but is
// only worth one line in the bell. A campaign whose sends are frequency-capped
// schedules a retry for every one of them, and one notification each would bury
// the feed under hundreds of identical rows — so entries sharing a `key` update
// the existing notification in place (with a fresh count and a fresh ETA)
// instead of adding another.
export async function notifyWorkspaceGrouped(workspaceId, { key, type, title, body = null, link = null, meta = null }) {
  if (!workspaceId || !key || !title) return null;
  const payload = { ...(meta ?? {}), key };

  const existing = await prisma.notification.findFirst({
    where: { workspaceId, userId: null, type, meta: { path: ['key'], equals: key } },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    // Re-opened as unread: the count and the ETA in the body have changed, so
    // this is new information even though it reuses the row. Workspace-scoped
    // read state lives in NotificationRead, so clearing those rows is what
    // actually brings the badge back for everyone.
    await prisma.notificationRead.deleteMany({ where: { notificationId: existing.id } }).catch(() => {});
    return prisma.notification.update({
      where: { id: existing.id },
      // createdAt moves with the update: the feed is ordered by it, so without
      // this the refreshed notice would sit unread halfway down the list under
      // the timestamp of the first recipient in the wave.
      data: { title, body, link, meta: payload, readAt: null, createdAt: new Date() },
    });
  }
  return prisma.notification.create({
    data: { workspaceId, userId: null, type, title, body, link, meta: payload },
  });
}

// The bell's feed: this user's personal notifications plus the workspace-wide
// ones, newest first, with each one's read state resolved for this user.
export async function listNotifications(userId, workspaceId, { limit = MAX_FEED } = {}) {
  const take = Math.min(Math.max(Number(limit) || MAX_FEED, 1), 100);

  const rows = await prisma.notification.findMany({
    where: {
      OR: [
        { userId },
        ...(workspaceId ? [{ workspaceId, userId: null }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take,
  });

  const workspaceIds = rows.filter((r) => !r.userId).map((r) => r.id);
  const reads = workspaceIds.length
    ? await prisma.notificationRead.findMany({
        where: { userId, notificationId: { in: workspaceIds } },
        select: { notificationId: true, readAt: true },
      })
    : [];
  const readMap = new Map(reads.map((r) => [r.notificationId, r.readAt]));

  const data = rows.map((row) => serialize(row, readMap.get(row.id)));
  return { data, unread: data.filter((n) => !n.read).length };
}

export async function getUnreadCount(userId, workspaceId) {
  const { unread } = await listNotifications(userId, workspaceId, { limit: 100 });
  return unread;
}

export async function markRead(userId, workspaceId, notificationId) {
  const row = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!row) { const e = new Error('Notification not found'); e.status = 404; throw e; }

  if (row.userId) {
    if (row.userId !== userId) { const e = new Error('Notification not found'); e.status = 404; throw e; }
    await prisma.notification.update({ where: { id: row.id }, data: { readAt: row.readAt ?? new Date() } });
  } else {
    if (workspaceId && row.workspaceId !== workspaceId) { const e = new Error('Notification not found'); e.status = 404; throw e; }
    await prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId: row.id, userId } },
      update: {},
      create: { notificationId: row.id, userId },
    });
  }
  return { ok: true };
}

// What the bell calls when it is opened — this is the fix for "the badge
// never resets after viewing the notifications".
export async function markAllRead(userId, workspaceId) {
  const now = new Date();

  const [personal, shared] = await Promise.all([
    prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } }),
    workspaceId
      ? prisma.notification.findMany({
          where: { workspaceId, userId: null },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  if (shared.length > 0) {
    await prisma.notificationRead.createMany({
      data: shared.map((n) => ({ notificationId: n.id, userId, readAt: now })),
      skipDuplicates: true,
    });
  }

  return { ok: true, marked: personal.count + shared.length };
}
