import * as nbaService from '../services/nextBestAction.service.js';
import { relationshipStrength, buildSignals } from '../services/relationship.service.js';
import { prisma } from '../lib/prisma.js';

export async function recommendations(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  res.json(await nbaService.getRecommendations(req.params.workspaceId, req.user, { limit }));
}

export async function relationship(req, res) {
  const { workspaceId, contactId } = req.params;
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true, name: true, optedOut: true, createdAt: true },
  });
  if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }

  // One query for the whole history, capped: a relationship judged on the last
  // 500 messages is not improved by reading ten thousand.
  const messages = await prisma.message.findMany({
    where: { conversation: { contactId, workspaceId } },
    select: { direction: true, sentAt: true },
    orderBy: { sentAt: 'desc' },
    take: 500,
  });

  res.json({
    contact: { id: contact.id, name: contact.name },
    ...relationshipStrength(buildSignals({ contact, messages })),
  });
}
