import { prisma } from './prisma.js';

// A WhatsApp number assigned to a context agent is dedicated to it: that agent
// answers everything arriving on the number, and nothing else in the workspace
// may send from it or automate on it.
//
// This lives in lib/, depending on nothing but the database, so campaigns,
// widgets, OTP, sequences and the public API can all ask "is this number
// taken?" without importing the agent service (and its LLM and outbound
// dependencies) or creating an import cycle with it.

// Prisma `where` fragment for WaNumber: only numbers no context agent holds.
// Spread it into any query that picks a number on the workspace's behalf, so a
// dedicated number can never become somebody's default.
export const NOT_DEDICATED = Object.freeze({ contextAgent: { is: null } });

// Prisma `where` fragment for Conversation: threads that are not on a
// dedicated number. Written as a NOT so conversations with no number at all
// (waNumberId null) still match.
export const NOT_ON_DEDICATED_NUMBER = Object.freeze({
  NOT: { waNumber: { is: { contextAgent: { isNot: null } } } },
});

// The context agent holding this number, or null.
export async function dedicatedAgentFor(waNumberId) {
  if (!waNumberId) return null;
  return prisma.contextAgent.findUnique({
    where: { waNumberId },
    select: { id: true, name: true, workspaceId: true },
  });
}

// Throws 409 when the number is dedicated. `purpose` finishes the sentence
// "…so it cannot be used for ___", e.g. "campaigns".
export async function assertNumberNotDedicated(waNumberId, purpose = 'anything else') {
  const agent = await dedicatedAgentFor(waNumberId);
  if (!agent) return;
  const e = new Error(
    `This WhatsApp number is dedicated to the context agent "${agent.name}", so it cannot be used for ${purpose}. `
    + 'Pick another number, or unassign it from the agent first (Automation → Context Agent).',
  );
  e.status = 409;
  e.code = 'NUMBER_DEDICATED';
  throw e;
}
