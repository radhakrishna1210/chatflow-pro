import { prisma } from '../lib/prisma.js';

export async function listWorkflows(workspaceId) {
  return prisma.workflow.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createWorkflow(workspaceId, { name, isActive = true, nodes = [], edges = [] }) {
  return prisma.workflow.create({
    data: {
      workspaceId,
      name,
      isActive,
      nodes,
      edges,
    },
  });
}

export async function updateWorkflow(workspaceId, id, updates) {
  const workflow = await prisma.workflow.findFirst({ where: { id, workspaceId } });
  if (!workflow) {
    const e = new Error('Workflow not found');
    e.status = 404;
    throw e;
  }
  
  const data = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.isActive !== undefined) data.isActive = updates.isActive;
  if (updates.nodes !== undefined) data.nodes = updates.nodes;
  if (updates.edges !== undefined) data.edges = updates.edges;
  
  return prisma.workflow.update({
    where: { id },
    data,
  });
}

export async function deleteWorkflow(workspaceId, id) {
  const workflow = await prisma.workflow.findFirst({ where: { id, workspaceId } });
  if (!workflow) {
    const e = new Error('Workflow not found');
    e.status = 404;
    throw e;
  }
  await prisma.workflow.delete({ where: { id } });
}

// Real workflow simulation: interpret the trigger/action nodes and produce an
// honest step-by-step execution trace. This replaces the old canned
// "Successfully triggered automation flow via AI" stub, which returned success
// for any input regardless of content.
//
// `options.replies` are the customer's answers, in order, to each "wait for
// reply" step.
export async function simulateWorkflow(workspaceId, workflowId, sampleMessage = 'Hi', options = {}) {
  const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId } });
  if (!workflow) { const e = new Error('Workflow not found'); e.status = 404; throw e; }

  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  if (nodes.length === 0) {
    return { workflowId, name: workflow.name, ran: false, reason: 'This workflow has no steps to run.', trace: [] };
  }

  const msgText = typeof sampleMessage === 'string'
    ? sampleMessage
    : String(sampleMessage?.message || sampleMessage?.text || sampleMessage || '');

  const trigger = nodes.find((n) => n.type === 'trigger');
  const trace = [];
  let triggered = true;
  let reason = null;

  if (trigger) {
    if (trigger.subtype === 'keyword') {
      const kw = String(trigger.value || '').trim();
      const { keywordMatches } = await import('./automation.service.js');
      triggered = kw ? keywordMatches(kw, msgText) : false;
      trace.push({
        step: 'trigger', subtype: 'keyword',
        detail: kw ? `Match "${trigger.value}" against "${msgText}"` : 'No keyword configured',
        result: triggered ? 'matched' : 'no match',
      });
      if (!triggered) reason = `Sample message does not contain the keyword "${trigger.value}".`;
    } else {
      trace.push({ step: 'trigger', subtype: trigger.subtype, detail: `Trigger type "${trigger.subtype}"`, result: 'assumed fired (simulation)' });
    }
  } else {
    triggered = false;
    reason = 'Workflow has no trigger step, so nothing would start it.';
    trace.push({ step: 'trigger', detail: 'missing', result: 'no trigger' });
  }

  // Walks the steps the way the engine does — conditions skip, a wait for the
  // customer's reply consumes the next sample reply — so a branching chat can
  // be tried end to end. Without replies the walk stops at the first wait and
  // says what is still to come, rather than guessing an answer.
  let pendingReplies = 0;
  if (triggered) {
    const { evaluateCondition, skipCount } = await import('./workflowConditions.js');
    const { resolveReply } = await import('./workflowEngine.service.js');
    const replies = (Array.isArray(options.replies) ? options.replies : [])
      .map((r) => String(r ?? '').trim()).filter(Boolean);
    const steps = nodes.filter((n) => n.type === 'action' || n.type === 'condition');
    let current = msgText;
    let lastOptions = [];
    // Mirrors the engine: once a step hands the chat to a person, the bot
    // sends nothing more on that run.
    let handedOff = false;

    for (let i = 0; i < steps.length; i += 1) {
      const node = steps[i];
      if (handedOff && ['message', 'buttons', 'template', 'wait_reply'].includes(node.subtype)) {
        trace.push({ step: 'action', subtype: node.subtype, detail: 'Skipped — the chat was handed to a person', result: 'skipped' });
        continue;
      }
      if (node.type === 'condition') {
        const held = evaluateCondition(node, { messageBody: current, isNewContact: false, contact: null });
        const skip = skipCount(node);
        trace.push({
          step: 'condition', subtype: node.subtype,
          detail: `If message ${node.subtype === 'equals' ? 'is' : node.subtype.replace(/_/g, ' ')} "${node.value ?? ''}" (testing "${current}")`,
          result: held ? 'yes' : `no — skip ${skip} step(s)`,
        });
        if (!held) i += skip;
        continue;
      }

      if (node.subtype === 'wait_reply') {
        if (replies.length === 0) {
          pendingReplies = steps.slice(i + 1).length;
          trace.push({
            step: 'action', subtype: 'wait_reply',
            detail: 'Would wait for the customer to reply'
              + (node.reminder && node.remindAfter ? ` (reminding them after ${node.remindAfter}: "${node.reminder}")` : '')
              + (pendingReplies ? ` — the remaining ${pendingReplies} step(s) run on their answer` : ''),
            result: 'waiting',
          });
          break;
        }
        current = resolveReply(replies.shift(), lastOptions);
        lastOptions = [];
        const saveAs = String(node.value ?? '').trim();
        trace.push({
          step: 'action', subtype: 'wait_reply',
          detail: `Customer replies "${current}"${saveAs ? ` (saved as {{${saveAs}}})` : ''}`,
          result: 'ok',
        });
        continue;
      }

      let detail = node.value;
      let result = 'ok';
      if (node.subtype === 'message' || node.subtype === 'template') lastOptions = [];
      if (node.subtype === 'message') detail = `Would send: "${node.value}"`;
      else if (node.subtype === 'template') detail = `Would send template: "${node.value}"`;
      else if (node.subtype === 'buttons') {
        const parts = String(node.value ?? '').split('|').map((p) => p.trim()).filter(Boolean);
        lastOptions = parts.slice(1);
        detail = `Would ask "${parts[0] ?? ''}" with options: ${lastOptions.join(', ') || '(none)'}`;
        if (lastOptions.length === 0) result = 'skipped';
      }
      else if (node.subtype === 'delay') detail = `Would wait ${node.value || '0'}`;
      else if (node.subtype === 'tag') detail = `Would tag contact "${node.value}"`;
      else if (node.subtype === 'agent') { detail = 'Would hand off to a human agent'; handedOff = true; }
      else if (node.subtype === 'task') detail = `Would create task "${node.value}"`;
      else if (node.subtype === 'lead_status') detail = `Would set lead status to ${node.value}`;
      else if (node.subtype === 'owner') detail = `Would assign owner "${node.value}"`;
      else if (node.subtype === 'sequence') detail = `Would enrol in sequence "${node.value}"`;
      else { detail = `Unknown action "${node.subtype}"`; result = 'skipped'; }
      trace.push({ step: 'action', subtype: node.subtype, detail, result });
    }
  }

  return {
    workflowId, name: workflow.name, ran: triggered,
    reason,
    trace,
    ...(pendingReplies ? { awaitingReply: true } : {}),
    note: 'Simulation only — no real messages were sent.',
  };
}
