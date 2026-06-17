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
      nodes: JSON.stringify(nodes),
      edges: JSON.stringify(edges),
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
  if (updates.nodes !== undefined) data.nodes = JSON.stringify(updates.nodes);
  if (updates.edges !== undefined) data.edges = JSON.stringify(updates.edges);
  
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
