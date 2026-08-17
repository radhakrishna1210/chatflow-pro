import { prisma } from '../lib/prisma.js';
import { computeLeadScore } from './leadScoring.service.js';
import { emitCrmEvent } from './workflowCrm.service.js';

// Turning a campaign reply into a lead.
//
// The messaging platform already knows who received which campaign
// (`CampaignRecipient`) and who replied (`Message.direction = INBOUND`). What
// was missing is the link: a reply produced no CRM record at all, so the
// pipeline never saw the traffic the platform was generating.
//
// How far back a reply still counts as attributable to the campaign that
// prompted it. Beyond this, a reply is a conversation, not a campaign response,
// and attributing it would inflate campaign credit.
const ATTRIBUTION_WINDOW_DAYS = 30;

/**
 * The most recent campaign this contact actually received, within the
 * attribution window.
 *
 * Only delivered states count — a campaign that failed or was skipped for this
 * contact never reached them, so a reply cannot be a response to it.
 */
export async function findAttributableCampaign(workspaceId, contactId, at = new Date()) {
  const since = new Date(at.getTime() - ATTRIBUTION_WINDOW_DAYS * 86400000);

  const recipient = await prisma.campaignRecipient.findFirst({
    where: {
      contactId,
      campaign: { workspaceId },
      status: { in: ['SENT', 'DELIVERED', 'READ'] },
      sentAt: { gte: since, lte: at },
    },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true, campaign: { select: { id: true, name: true } } },
  });

  return recipient
    ? { campaignId: recipient.campaign.id, campaignName: recipient.campaign.name, sentAt: recipient.sentAt }
    : null;
}

/**
 * Creates a lead for a contact who replied to a campaign, if the workspace has
 * opted in and the contact is not already a lead.
 *
 * Returns a result object rather than throwing: this runs off the inbound
 * message path, where nothing may be allowed to cost the platform an incoming
 * WhatsApp message.
 */
export async function createLeadFromReply(workspaceId, contactId, { at = new Date() } = {}) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { autoLeadFromReply: true },
  });
  if (!workspace?.autoLeadFromReply) return { created: false, reason: 'Disabled for this workspace' };

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true, optedOut: true },
  });
  if (!contact) return { created: false, reason: 'Contact not found' };

  // Someone who opted out is not a prospect, whatever they last replied to.
  if (contact.optedOut) return { created: false, reason: 'Contact opted out' };

  const existing = await prisma.lead.findUnique({ where: { contactId }, select: { id: true } });
  if (existing) return { created: false, reason: 'Already a lead', leadId: existing.id };

  const attribution = await findAttributableCampaign(workspaceId, contactId, at);
  if (!attribution) return { created: false, reason: 'No campaign to attribute this reply to' };

  // Scored on creation so the new lead sorts correctly straight away rather
  // than sitting at zero until someone recalculates. The reply itself is
  // already in the message history, so it counts toward the score.
  const { score, factors, computedAt } = await computeLeadScore(workspaceId, contactId);

  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      contactId,
      status: 'CONTACTED', // they have engaged — NEW would understate it
      source: `Campaign: ${attribution.campaignName}`,
      score,
      scoreFactors: factors,
      scoreComputedAt: computedAt,
    },
    select: { id: true, score: true, source: true },
  });

  // Same event any other lead creation raises, so CRM workflows treat a
  // campaign-generated lead exactly like a hand-entered one.
  emitCrmEvent(workspaceId, 'lead_created', { leadId: lead.id, contactId, score: lead.score });

  return {
    created: true,
    leadId: lead.id,
    score: lead.score,
    source: lead.source,
    campaignId: attribution.campaignId,
  };
}

// Fire-and-forget wrapper for the inbound webhook path. A failure here must
// never cost the platform the message itself.
export function captureReplyAsLead(workspaceId, contactId) {
  createLeadFromReply(workspaceId, contactId).catch((err) => {
    console.error('[CampaignLeads] Could not create a lead from this reply:', err.message);
  });
}
