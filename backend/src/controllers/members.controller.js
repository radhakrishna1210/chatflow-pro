import * as membersService from '../services/members.service.js';
import * as invitationsService from '../services/invitations.service.js';

export async function list(req, res) {
  const members = await membersService.listMembers(req.params.workspaceId);
  res.json(members);
}

// Kept for API compatibility, but it now *invites*: it used to insert a
// WorkspaceMember for any existing account straight away, so an admin of any
// workspace could pull a stranger into it without their consent, and its 404
// "User not found" told anyone with a workspace which addresses have accounts.
// The person now has to accept, exactly as with POST /invitations.
export async function invite(req, res) {
  const invitation = await invitationsService.createInvitation(req.params.workspaceId, req.body, req.user.id);
  res.status(201).json(invitation);
}

export async function updateRole(req, res) {
  // The acting user is passed through so the service can refuse a self-demotion
  // that would leave the workspace without an admin.
  const member = await membersService.updateMemberRole(
    req.params.workspaceId, req.params.userId, req.body.role, req.user?.id,
  );
  res.json(member);
}

export async function remove(req, res) {
  await membersService.removeMember(req.params.workspaceId, req.params.userId, req.user?.id);
  res.status(204).send();
}
