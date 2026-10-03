import { prisma } from '../lib/prisma.js';
import { findMatchingWorkflows } from './workflowEngine.service.js';

// "My workflow did not fire" — visible in run history (WF-IN-16).
//
// Several layers in front of the workflow engine can keep an inbound message
// from reaching it: a person holding the thread (human handoff), a WhatsApp
// form mid-question, an opt-out, a control word. Each is right to do so, but
// from the Workflows screen the result looked exactly like a broken trigger:
// no run, no error, nothing. When one of them stops a message that an active
// workflow WOULD have matched, a CANCELLED run is recorded against that
// workflow with `error: "Not run: <reason>"`, so its history says why.
//
// Throttled to one per conversation and workflow per hour, so a chatty
// customer in a long handoff does not fill the history.

export const SUPPRESSION_REASONS = Object.freeze({
  handoff: (detail) => `a person is handling this chat${detail ? ` (${detail})` : ''} — automation is paused on it`,
  form: (detail) => `the customer was answering a WhatsApp form${detail ? ` (${detail})` : ''}`,
  optout: (keyword) => `the message was an opt-out ("${keyword}")`,
  control: (word) => `the customer's message "${word}" was read as a command to the running flow`,
});

const THROTTLE_MS = 60 * 60_000;

/**
 * Records "Not run: <reason>" against the workflow this message would have
 * started. Never throws; returns the run written, or null.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string} args.conversationId
 * @param {string} [args.contactId]
 * @param {string} args.reason              human-readable, after "Not run: "
 * @param {object} args.match               the inbound context the engine matches on:
 *   { messageBody, event, mediaType, isNewContact }
 */
export async function recordSuppressedAutomation({ workspaceId, conversationId, contactId = null, reason, match }) {
  try {
    if (!workspaceId || !conversationId || !match) return null;
    const workflows = await findMatchingWorkflows(workspaceId, {
      messageBody: match.messageBody ?? '',
      event: match.event ?? 'message',
      mediaType: match.mediaType ?? null,
      isNewContact: match.isNewContact === true,
    });
    const workflow = workflows?.[0];
    if (!workflow) return null;

    const now = new Date();
    const recent = await prisma.workflowRun.findFirst({
      where: {
        workspaceId,
        workflowId: workflow.id,
        conversationId,
        status: 'CANCELLED',
        error: { startsWith: 'Not run:' },
        startedAt: { gte: new Date(now.getTime() - THROTTLE_MS) },
      },
      select: { id: true },
    });
    if (recent) return null;

    const error = `Not run: ${reason}`.slice(0, 1000);
    const run = await prisma.workflowRun.create({
      data: {
        workspaceId,
        workflowId: workflow.id,
        conversationId,
        contactId,
        nodes: workflow.nodes ?? [],
        trace: [{ step: 0, subtype: 'suppressed', detail: error, result: 'skipped', at: now.toISOString() }],
        triggerMessage: match.messageBody ? String(match.messageBody).slice(0, 2000) : null,
        status: 'CANCELLED',
        cursor: 0,
        error,
        startedAt: now,
        finishedAt: now,
      },
    });
    console.log(`[Automation] Workflow "${workflow.name}" (${workflow.id}) would have run on ${conversationId} — ${error}`);
    return run;
  } catch (err) {
    console.warn(`[Automation] Could not record a suppressed workflow on ${conversationId}:`, err.message);
    return null;
  }
}
