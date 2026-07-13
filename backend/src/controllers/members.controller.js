import * as membersService from '../services/members.service.js';

export async function list(req, res) {
  const members = await membersService.listMembers(req.params.workspaceId);
  res.json(members);
}

export async function invite(req, res) {
  const member = await membersService.inviteMember(req.params.workspaceId, req.body, req.user?.name);
  res.status(201).json(member);
}

export async function updateRole(req, res) {
  const member = await membersService.updateMemberRole(req.params.workspaceId, req.params.userId, req.body.role);
  res.json(member);
}

export async function remove(req, res) {
  await membersService.removeMember(req.params.workspaceId, req.params.userId);
  res.status(204).send();
}
