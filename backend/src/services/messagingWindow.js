import { prisma } from '../lib/prisma.js';

// WhatsApp's 24-hour customer service window.
//
// Meta only accepts a free-form (non-template) message within 24 hours of the
// customer's last inbound message. Outside it the send is rejected with error
// 131047, and only an approved template may be used.
//
// The app had no concept of this at all. Nothing checked the window, so an
// agent's inbox reply outside it came back as a bare "Request failed with
// status code 400"; an automated reply hit the same wall and
// sendAutomatedReply() returned null, dropping it in silence. Both looked like
// WhatsApp sending being broken rather than a rule being enforced.

export const WINDOW_MS = 24 * 60 * 60 * 1000;

// Meta's code for "outside the customer service window", worth naming once
// rather than as a literal at each call site.
export const OUTSIDE_WINDOW_CODE = 131047;

/**
 * @returns {{ open: boolean, lastInboundAt: Date|null, expiresAt: Date|null, msRemaining: number }}
 */
export function windowStateFrom(lastInboundAt) {
  if (!lastInboundAt) {
    return { open: false, lastInboundAt: null, expiresAt: null, msRemaining: 0 };
  }
  const last = new Date(lastInboundAt);
  const expiresAt = new Date(last.getTime() + WINDOW_MS);
  const msRemaining = expiresAt.getTime() - Date.now();
  return { open: msRemaining > 0, lastInboundAt: last, expiresAt, msRemaining: Math.max(0, msRemaining) };
}

export async function getWindowState(conversationId) {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { lastInboundAt: true },
  });
  return windowStateFrom(convo?.lastInboundAt ?? null);
}

// Human phrasing for how much of the window is left, for the inbox banner.
export function describeWindow(state) {
  if (!state.lastInboundAt) {
    return 'This customer has never messaged you, so only an approved template can be sent.';
  }
  if (!state.open) {
    return 'The 24-hour reply window has closed. Send an approved template to reopen the conversation.';
  }
  const hours = Math.floor(state.msRemaining / 3_600_000);
  const minutes = Math.floor((state.msRemaining % 3_600_000) / 60_000);
  return hours > 0
    ? `${hours}h ${minutes}m left to reply freely.`
    : `${minutes}m left to reply freely.`;
}

// Raised instead of letting Meta reject the send. Carries `code` so the client
// can offer the template picker rather than only printing the message.
export function outsideWindowError(state) {
  const e = new Error(
    state.lastInboundAt
      ? 'The 24-hour reply window for this conversation has closed. WhatsApp only allows an approved template message now — pick one to reopen the conversation.'
      : 'This contact has not messaged you, so WhatsApp only allows an approved template message.',
  );
  e.status = 409;
  e.code = 'OUTSIDE_24H_WINDOW';
  e.details = { lastInboundAt: state.lastInboundAt, expiresAt: state.expiresAt };
  return e;
}
