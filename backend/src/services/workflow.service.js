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
export async function simulateWorkflow(workspaceId, workflowId, sampleMessage = 'Hi') {
  const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId } });
  if (!workflow) { const e = new Error('Workflow not found'); e.status = 404; throw e; }

  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  if (nodes.length === 0) {
    return { workflowId, name: workflow.name, ran: false, reason: 'This workflow has no steps to run.', trace: [] };
  }

  const trigger = nodes.find((n) => n.type === 'trigger');
  const trace = [];
  let triggered = true;
  let reason = null;

  if (trigger) {
    if (trigger.subtype === 'keyword') {
      const kw = String(trigger.value || '').toLowerCase();
      triggered = kw ? sampleMessage.toLowerCase().includes(kw) : false;
      trace.push({
        step: 'trigger', subtype: 'keyword',
        detail: kw ? `Match "${trigger.value}" against "${sampleMessage}"` : 'No keyword configured',
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

  if (triggered) {
    for (const node of nodes.filter((n) => n.type === 'action')) {
      let detail = node.value;
      let result = 'ok';
      if (node.subtype === 'message') detail = `Would send: "${node.value}"`;
      else if (node.subtype === 'delay') detail = `Would wait ${node.value || '0'}`;
      else if (node.subtype === 'tag') detail = `Would tag contact "${node.value}"`;
      else if (node.subtype === 'agent') detail = 'Would hand off to a human agent';
      else { detail = `Unknown action "${node.subtype}"`; result = 'skipped'; }
      trace.push({ step: 'action', subtype: node.subtype, detail, result });
    }
  }

  return {
    workflowId, name: workflow.name, ran: triggered,
    reason,
    trace,
    note: 'Simulation only — no real messages were sent.',
  };
}
