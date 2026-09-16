import * as gamification from '../services/gamification.service.js';

export async function profile(req, res) {
  res.json(await gamification.getProfile(req.params.workspaceId, req.user.id));
}
export async function leaderboard(req, res) {
  res.json({ data: await gamification.leaderboard(req.params.workspaceId, { limit: Number(req.query.limit) || 10 }) });
}
