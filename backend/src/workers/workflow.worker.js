import { Worker } from 'bullmq';
import { createBullConnection, logRedisError } from '../lib/redis.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { advanceRun } from '../services/workflowEngine.service.js';
import { sendAutomatedReply } from '../services/outbound.service.js';

async function processResume(job) {
  const { runId } = job.data;
  const run = await advanceRun(runId);
  console.log(`[WorkflowWorker] Resumed run ${runId} → ${run?.status ?? 'missing'}`);
}

// The "Delayed Response Message" automation. Scheduled when a customer sends an
// inbound message; fires only if nobody has replied by the time it runs, so a
// team that answers within the window never triggers it.
async function processDelayedResponse(job) {
  const { conversationId } = job.data;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  });
  if (!conversation) return;
  if (conversation.status === 'CLOSED') return;
  if (!conversation.waNumberId) return;

  const workspace = await prisma.workspace.findUnique({
    where: { id: conversation.workspaceId },
    select: { autoDelayedEnabled: true, delayedMessage: true },
  });
  if (!workspace?.autoDelayedEnabled) return;

  const lastInbound = await prisma.message.findFirst({
    where: { conversationId, direction: 'INBOUND' },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });
  if (!lastInbound) return;

  // Any outbound message after the customer's last one counts as "answered" —
  // whether it came from an agent, a keyword trigger, or a workflow.
  const reply = await prisma.message.findFirst({
    where: { conversationId, direction: 'OUTBOUND', sentAt: { gt: lastInbound.sentAt } },
    select: { id: true },
  });
  if (reply) {
    console.log(`[WorkflowWorker] Delayed check for ${conversationId}: already answered, skipping.`);
    return;
  }

  await sendAutomatedReply({
    conversationId,
    waNumberId: conversation.waNumberId,
    toPhone: conversation.contact.phoneNumber,
    body: workspace.delayedMessage,
  });
  console.log(`[WorkflowWorker] Sent delayed-response reply on ${conversationId}`);
}

async function processJob(job) {
  if (job.name === 'resume') return processResume(job);
  if (job.name === 'delayed-response') return processDelayedResponse(job);
  console.warn(`[WorkflowWorker] Unknown job name "${job.name}" — ignoring.`);
}

export function startWorkflowWorker() {
  const worker = new Worker('workflows', processJob, {
    connection: createBullConnection('workflow-worker'),
    concurrency: 5,
    drainDelay: env.WORKER_DRAIN_DELAY_SEC,
    stalledInterval: env.WORKER_STALLED_INTERVAL_MS,
  });

  worker.on('error', (err) => logRedisError('workflow-worker', err));
  worker.on('failed', (job, err) => console.error(`[WorkflowWorker] Job ${job?.id} failed:`, err.message));

  return worker;
}
