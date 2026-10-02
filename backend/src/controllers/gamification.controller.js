import * as gamification from '../services/gamification.service.js';

export async function profile(req, res) {
  res.json(await gamification.getProfile(req.params.workspaceId, req.user.id));
}
export async function settings(req, res) {
  res.json(await gamification.getSettings(req.params.workspaceId));
}
export async function updateSettings(req, res) {
  res.json(await gamification.saveSettings(req.params.workspaceId, req.body || {}));
}
export async function leaderboard(req, res) {
  res.json({ data: await gamification.leaderboard(req.params.workspaceId, { limit: Number(req.query.limit) || 10 }) });
}
