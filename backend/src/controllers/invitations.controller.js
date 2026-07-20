import * as invitationsService from '../services/invitations.service.js';
import * as authService from '../services/auth.service.js';

export async function create(req, res) {
  const invitation = await invitationsService.createInvitation(req.params.workspaceId, req.body, req.user.id);
  res.status(201).json(invitation);
}

export async function list(req, res) {
  res.json(await invitationsService.listInvitations(req.params.workspaceId));
}

export async function resend(req, res) {
  const invitation = await invitationsService.resendInvitation(req.params.workspaceId, req.params.id, req.user.id);
  res.json(invitation);
}

export async function revoke(req, res) {
  await invitationsService.revokeInvitation(req.params.workspaceId, req.params.id);
  res.status(204).send();
}

export async function getByToken(req, res) {
  const invitation = await invitationsService.getInvitationByToken(req.params.token);
  if (!invitation) return res.status(404).json({ error: 'Invite not found' });
  res.json(invitation);
}

// Orchestrates both services here (not service-to-service) so
// invitations.service.js never has to import auth.service.js.
export async function accept(req, res) {
  const result = await invitationsService.acceptInvitation(req.params.token, req.user.id);
  const session = await authService.mintSessionForWorkspace(req.user.id, result.workspaceId, result.role);
  res.json(session);
}
