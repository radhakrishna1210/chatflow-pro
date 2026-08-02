import * as notificationService from '../services/notification.service.js';

// The bell reads notifications for the signed-in user across their current
// workspace. workspaceId is optional: a super admin with no workspace context
// still sees their personal notifications.
export async function list(req, res) {
  const result = await notificationService.listNotifications(
    req.user.id, req.user.workspaceId, { limit: +req.query.limit || 50 },
  );
  res.json(result);
}

export async function unreadCount(req, res) {
  const unread = await notificationService.getUnreadCount(req.user.id, req.user.workspaceId);
  res.json({ unread });
}

export async function markRead(req, res) {
  const result = await notificationService.markRead(req.user.id, req.user.workspaceId, req.params.id);
  res.json(result);
}

export async function markAllRead(req, res) {
  const result = await notificationService.markAllRead(req.user.id, req.user.workspaceId);
  res.json(result);
}
