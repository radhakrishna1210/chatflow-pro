import * as teamsService from '../services/teams.service.js';

export async function list(req, res) {
  res.json(await teamsService.listTeams(req.params.workspaceId));
}
export async function create(req, res) {
  res.status(201).json(await teamsService.createTeam(req.params.workspaceId, req.body));
}
export async function update(req, res) {
  res.json(await teamsService.updateTeam(req.params.workspaceId, req.params.id, req.body));
}
export async function remove(req, res) {
  await teamsService.deleteTeam(req.params.workspaceId, req.params.id);
  res.status(204).send();
}
export async function setMembers(req, res) {
  res.json(await teamsService.setTeamMembers(req.params.workspaceId, req.params.id, req.body.userIds));
}
export async function getVisibility(req, res) {
  res.json(await teamsService.getVisibility(req.params.workspaceId));
}
export async function setVisibility(req, res) {
  res.json(await teamsService.setVisibility(req.params.workspaceId, req.body.recordVisibility));
}
