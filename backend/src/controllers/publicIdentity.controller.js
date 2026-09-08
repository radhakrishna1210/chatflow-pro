/**
 * "Who does this API key belong to?"
 *
 * An integrating application authenticates with a key and gets a workspace — but
 * until now it had no way to find out WHICH workspace, because the key carries
 * that implicitly and nothing on the public API said it out loud. That is a
 * quiet way to lose money and trust: paste the wrong key into a client's
 * integration and their customers get confirmations from another business's
 * WhatsApp number, with nothing anywhere reporting a problem.
 *
 * It also answers the second question a sender needs: which numbers can I send
 * from? `sendPublicMessage` picks with `findFirst` and no ordering when no
 * `waNumberId` is given, so a workspace with two numbers sends from an arbitrary
 * one. A caller that can list them can pass an explicit choice.
 *
 * Deliberately requires no scope beyond a valid key. A key should always be able
 * to identify itself; gating that behind a permission means an integration can
 * hold a working credential and still not know whose data it is about to touch.
 */
import { prisma } from '../lib/prisma.js';

/** GET /api/v1/public/me */
export async function me(req, res) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: req.workspaceId },
    select: { id: true, name: true },
  });

  if (!workspace) {
    // The key authenticated, so the workspace existed when it was issued. Its
    // absence now means the workspace was deleted and the key outlived it.
    return res.status(404).json({ error: 'The workspace this key belongs to no longer exists.' });
  }

  const numbers = await prisma.waNumber.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      phoneNumber: true,
      displayName: true,
      status: true,
      quality: true,
      codeVerificationStatus: true,
      unreachableSince: true,
    },
  });

  res.json({
    workspace,
    apiKey: { name: req.apiKey?.name ?? null, scopes: req.apiKey?.scopes ?? null },
    waNumbers: numbers.map((n) => ({
      id: n.id,
      phoneNumber: n.phoneNumber,
      displayName: n.displayName,
      status: n.status,
      quality: n.quality,
      // Two states that look healthy in a list but fail on every send, so a
      // caller can warn about them rather than discovering it mid-campaign.
      verificationExpired: n.codeVerificationStatus === 'EXPIRED',
      unreachable: Boolean(n.unreachableSince),
    })),
  });
}
