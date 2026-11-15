import * as adminService from '../services/admin.service.js';
import * as platformSettings from '../services/platformSettings.service.js';
import * as authService from '../services/auth.service.js';
import * as invitationsService from '../services/invitations.service.js';
import * as audit from '../services/audit.service.js';

// Whatever the auth layer resolved for this request. Every audited action reads
// the operator from here rather than the body, so the log records who actually
// held the token and not who the request claimed to be.
const actorOf = (req) => ({ id: req.user?.id, email: req.user?.email });

// Pool rows carry the number's encrypted Meta access token. Ciphertext is not
// the token, but it has no business in a browser either — and it becomes the
// token for anyone who later obtains ENCRYPTION_KEY.
const safePoolEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return entry;
  const { encryptedAccessToken, ...rest } = entry;
  return { ...rest, hasAccessToken: !!encryptedAccessToken };
};

const badRequest = (res, error) => res.status(400).json({ error });

// `new Date('garbage')` is an Invalid Date, which Prisma rejects with a 500.
const invalidDate = (...values) => values.some((v) => v !== undefined && v !== '' && Number.isNaN(new Date(v).getTime()));

export async function getPool(req, res) {
  const result = await adminService.getPoolSummary();
  res.json({ ...result, pool: (result.pool || []).map(safePoolEntry) });
}

export async function addNumber(req, res) {
  const { phoneNumber, accessToken } = req.body || {};
  if (typeof phoneNumber !== 'string' || !/^\+?[0-9]{6,20}$/.test(phoneNumber.replace(/[\s()-]/g, ''))) {
    return badRequest(res, 'phoneNumber must be a phone number in international format');
  }
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    return badRequest(res, 'accessToken is required');
  }
  const entry = await adminService.addToPool(req.body);
  await audit.record({
    actor: actorOf(req), action: 'number.add', targetType: 'number', targetLabel: entry?.phoneNumber || phoneNumber,
  });
  res.status(201).json(safePoolEntry(entry));
}

export async function requestOtp(req, res) {
  const result = await adminService.sendOtpRequest(req.body);
  res.json(result);
}

export async function verifyOtp(req, res) {
  const entry = await adminService.verifyOtpAndAdd(req.body);
  res.status(201).json(safePoolEntry(entry));
}

export async function resetAllAssignments(req, res) {
  const result = await adminService.resetAllAssignments();
  // Disconnects every workspace's WhatsApp number at once — the single most
  // destructive button on the console, so it leaves a trace like the rest.
  await audit.record({ actor: actorOf(req), action: 'number.reset-all', targetType: 'number', targetLabel: 'all' });
  res.json(result);
}

export async function resetPoolEntry(req, res) {
  const entry = await adminService.resetPoolEntry(req.params.id);
  await audit.record({
    actor: actorOf(req), action: 'number.reset', targetType: 'number',
    targetLabel: entry?.phoneNumber || req.params.id,
  });
  res.json(safePoolEntry(entry));
}

export async function banPoolEntry(req, res) {
  const entry = await adminService.banPoolEntry(req.params.id);
  await audit.record({
    actor: actorOf(req), action: 'number.ban', targetType: 'number',
    targetLabel: entry?.phoneNumber || req.params.id,
  });
  res.json(safePoolEntry(entry));
}

export async function unbanPoolEntry(req, res) {
  const entry = await adminService.unbanPoolEntry(req.params.id);
  await audit.record({
    actor: actorOf(req), action: 'number.unban', targetType: 'number',
    targetLabel: entry?.phoneNumber || req.params.id,
  });
  res.json(safePoolEntry(entry));
}

export async function twilioSync(req, res) {
  const result = await adminService.twilioSync();
  res.json(result);
}

export async function syncPoolFromWaba(req, res) {
  const result = await adminService.syncPoolFromWaba();
  res.json(result);
}

export async function getWabaNumbers(req, res) {
  const result = await adminService.getWabaNumbers();
  res.json(result);
}

export async function metaTestCalls(req, res) {
  const result = await adminService.metaTestCalls();
  res.json(result);
}

export async function listWorkspaces(req, res) {
  const workspaces = await adminService.listWorkspaces();
  res.json(workspaces);
}

export async function assignToWorkspace(req, res) {
  const { poolEntryId, workspaceId } = req.body;
  if (!poolEntryId || !workspaceId) {
    return res.status(400).json({ error: 'poolEntryId and workspaceId are required' });
  }
  const result = await adminService.assignToWorkspace(poolEntryId, workspaceId);
  await audit.record({
    actor: actorOf(req), action: 'number.assign', targetType: 'number',
    targetLabel: result?.phoneNumber || poolEntryId,
    meta: { workspaceId, poolEntryId },
  });
  res.status(201).json(result);
}

export async function platformStats(req, res) {
  res.json(await adminService.getPlatformStats());
}

export async function listWorkspacesDetailed(req, res) {
  res.json(await adminService.listWorkspacesDetailed());
}

export async function suspendWorkspace(req, res) {
  const { suspended, reason } = req.body || {};
  // Must be a real boolean: `!!"false"` is true, so a string here used to
  // suspend the workspace the caller was trying to reinstate.
  if (typeof suspended !== 'boolean') return badRequest(res, 'suspended must be true or false');
  if (reason != null && typeof reason !== 'string') return badRequest(res, 'reason must be text');
  const result = await adminService.setWorkspaceSuspended(req.params.id, suspended, reason);
  await audit.record({
    actor: actorOf(req),
    action: suspended ? 'suspend' : 'reinstate',
    targetType: 'workspace',
    targetLabel: result?.name || req.params.id,
    reason: reason || null,
    meta: { workspaceId: req.params.id },
  });
  res.json(result);
}

// The models available to the platform's Gemini key, for the model pickers.
export async function listAiModels(req, res) {
  res.json(await adminService.listAiModels());
}

// Pins one workspace to a model, or (empty/null) back to the platform default.
// Audited: it changes what every AI feature in that workspace answers with.
export async function setWorkspaceAiModel(req, res) {
  const result = await adminService.setWorkspaceAiModel(req.params.id, req.body?.model ?? null);
  await audit.record({
    actor: actorOf(req),
    action: 'ai_model',
    targetType: 'workspace',
    targetLabel: result?.name || req.params.id,
    reason: result.aiModel ? `Set to ${result.aiModel}` : 'Reset to the platform default',
    meta: { workspaceId: req.params.id, from: result.previousAiModel, to: result.aiModel },
  });
  res.json(result);
}

export async function listTickets(req, res) {
  res.json(await adminService.listAllTickets(req.query.status));
}

export async function updateTicket(req, res) {
  const { status, adminNote } = req.body || {};
  if (status !== undefined && !['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) {
    return badRequest(res, 'status must be one of OPEN, IN_PROGRESS, RESOLVED, CLOSED');
  }
  if (adminNote !== undefined && adminNote !== null && (typeof adminNote !== 'string' || adminNote.length > 4000)) {
    return badRequest(res, 'adminNote must be text of at most 4000 characters');
  }
  const ticket = await adminService.updateTicket(req.params.id, { status, adminNote });
  await audit.record({
    actor: actorOf(req), action: 'ticket.update', targetType: 'ticket',
    targetLabel: ticket?.subject || req.params.id,
    meta: { ticketId: req.params.id, status: req.body?.status },
  });
  res.json(ticket);
}

export async function transactionAnalysis(req, res) {
  const { workspaceId, from, to, type } = req.query;
  if (invalidDate(from, to)) return badRequest(res, 'from/to must be valid dates');
  res.json(await adminService.getTransactionAnalysis({ workspaceId, from, to, type }));
}

export async function listAllCampaigns(req, res) {
  const { workspaceId, status } = req.query;
  res.json(await adminService.listAllCampaigns({ workspaceId, status }));
}

export async function revenueOverview(req, res) {
  res.json(await adminService.getRevenueOverview());
}

export async function workspaceAnalytics(req, res) {
  res.json(await adminService.getWorkspaceAnalytics());
}

export async function paymentsAnalysis(req, res) {
  const { workspaceId, from, to } = req.query;
  if (invalidDate(from, to)) return badRequest(res, 'from/to must be valid dates');
  res.json(await adminService.getPaymentsAnalysis({ workspaceId, from, to }));
}

export async function workspaceMembers(req, res) {
  res.json(await adminService.getWorkspaceMembers(req.params.id));
}

// Super admins can invite into any workspace without being a member of it, so
// these reuse the same invitation service the workspace's own admins use —
// same tokens, seat limits, expiry and revoke semantics, just reached through
// the platform console. `req.user.id` is the super admin, who is recorded as
// the inviter.
export async function workspaceInvite(req, res) {
  const invitation = await invitationsService.createInvitation(req.params.id, req.body, req.user.id);
  await audit.record({
    actor: actorOf(req), action: 'invite.create', targetType: 'workspace', targetLabel: req.params.id,
    meta: { workspaceId: req.params.id, email: req.body?.email, role: req.body?.role },
  });
  res.status(201).json(invitation);
}

export async function workspaceInviteLink(req, res) {
  const invitation = await invitationsService.createLinkInvitation(req.params.id, req.body, req.user.id);
  await audit.record({
    actor: actorOf(req), action: 'invite.link', targetType: 'workspace', targetLabel: req.params.id,
    meta: { workspaceId: req.params.id, role: req.body?.role, maxUses: req.body?.maxUses ?? null },
  });
  res.status(201).json(invitation);
}

export async function workspaceRevokeInvite(req, res) {
  await invitationsService.revokeInvitation(req.params.id, req.params.invitationId);
  await audit.record({
    actor: actorOf(req), action: 'invite.revoke', targetType: 'workspace', targetLabel: req.params.id,
    meta: { workspaceId: req.params.id, invitationId: req.params.invitationId },
  });
  res.status(204).send();
}

export async function listUsers(req, res) {
  const { search, page, limit } = req.query;
  res.json(await adminService.listUsers({ search, page, limit }));
}

export async function impersonateUser(req, res) {
  const result = await authService.impersonateUser(req.params.id, req.user.id);
  // Audited after the fact deliberately: a failed impersonation is an
  // authorisation event the auth layer already reports, and logging the attempt
  // as if it succeeded would be worse than not logging it.
  await audit.record({
    actor: actorOf(req),
    action: 'impersonate',
    targetType: 'user',
    targetLabel: result?.user?.email || req.params.id,
    reason: req.body?.reason || null,
    meta: { userId: req.params.id, workspaceId: result?.user?.workspaceId || null },
  });
  res.json(result);
}

// ─── Plan management ──────────────────────────────────────────
export async function listPlans(req, res) {
  res.json({ plans: await adminService.listAllPlans(), knownFeatures: adminService.KNOWN_FEATURE_FLAGS });
}

export async function createPlan(req, res) {
  const plan = await adminService.createPlan(req.body || {});
  await audit.record({
    actor: actorOf(req), action: 'plan.create', targetType: 'plan',
    targetLabel: plan?.name || '', meta: { planId: plan?.id },
  });
  res.status(201).json(plan);
}

export async function updatePlan(req, res) {
  const plan = await adminService.updatePlan(req.params.id, req.body || {});
  // The changed keys, not the values: entitlements can carry pricing, and an
  // audit log is read by more people than the billing screen is.
  await audit.record({
    actor: actorOf(req), action: 'plan.update', targetType: 'plan',
    targetLabel: plan?.name || req.params.id,
    meta: { planId: req.params.id, changed: Object.keys(req.body || {}) },
  });
  res.json(plan);
}

export async function deletePlan(req, res) {
  const result = await adminService.deletePlan(req.params.id);
  await audit.record({
    actor: actorOf(req), action: 'plan.delete', targetType: 'plan',
    targetLabel: req.params.id,
  });
  res.json(result);
}

// ── Platform credentials (API Management) ────────────────────────────────────
//
// Super-admin only (admin.routes.js gates the whole router). Values are
// returned masked and never in full — the screen shows what is configured and
// where it comes from, not what it is.

export async function getSystemSettings(req, res) {
  res.json(await platformSettings.getAllSettings());
}

// Live check of the credentials actually in force, whatever their source.
// The settings screen shows a masked value and a source, which says a key is
// *present* but never whether the provider accepts it — the distinction that
// matters when every AI reply has quietly stopped working.
// Which Meta webhook events the app is actually subscribed to. The live app
// was subscribed to `messages` alone, so no template status or category update
// ever reached the handlers that exist for them.
export async function inspectWebhooks(req, res) {
  const { inspectWebhookSubscription } = await import('../lib/meta.js');
  res.json(await inspectWebhookSubscription());
}

// Re-registers the subscription with every field the webhook handler supports.
export async function repairWebhooks(req, res) {
  const { setAppWebhookSubscription, inspectWebhookSubscription } = await import('../lib/meta.js');
  await setAppWebhookSubscription(req.body?.callbackUrl);
  res.json({ ok: true, subscription: await inspectWebhookSubscription() });
}

export async function checkSystemCredentials(req, res) {
  res.json(await platformSettings.checkPlatformCredentials());
}

export async function updateSystemSettings(req, res) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const result = await platformSettings.updateSettings(body);
  // Rotating a platform credential (Meta token, Razorpay secret, SMTP…) is
  // as sensitive as anything else on this console, so it is audited too —
  // key names only, never values.
  if (result.updated.length || result.cleared.length) {
    await audit.record({
      actor: actorOf(req), action: 'platform.settings.update', targetType: 'platform',
      targetLabel: [...result.updated, ...result.cleared].join(', '),
      meta: { updated: result.updated, cleared: result.cleared },
    });
  }
  res.json({ success: true, ...result, settings: await platformSettings.getAllSettings() });
}


// ─── Audit & security ─────────────────────────────────────────
//
// Read-only. The log is written from the actions above and from the wallet
// service; nothing exposes a way to edit or delete an entry, which is the point
// of having one.
export async function auditLog(req, res) {
  const { action, search, limit } = req.query;
  res.json(await audit.list({ action, search, limit: Number(limit) || 100 }));
}

export async function auditActions(req, res) {
  res.json(await audit.actions());
}

export async function auditSummary(req, res) {
  res.json(await audit.summary(Math.min(365, Math.max(1, Number(req.query.days) || 30))));
}
