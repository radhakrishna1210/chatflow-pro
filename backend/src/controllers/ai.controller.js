import { prisma } from '../lib/prisma.js';
import { simulateWorkflow } from '../services/workflow.service.js';

// All routes here run behind `authenticate`; workspace scoping uses the
// JWT workspaceId but every mutation re-verifies membership against the DB
// so a stale token cannot touch workspaces the user has left.
async function assertMembership(userId, workspaceId) {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!member) {
    const e = new Error('Not a member of this workspace');
    e.status = 403;
    throw e;
  }
  return member;
}

export const createTemplate = async (req, res, next) => {
  try {
    const { workspaceId, id: userId } = req.user;
    await assertMembership(userId, workspaceId);
    const { name, category, language, body } = req.body;
    if (!name || !body) return res.status(400).json({ error: 'name and body are required' });

    // AI-drafted templates are local drafts pending Meta review — never mark
    // them APPROVED: campaigns using an unapproved name are rejected by Meta.
    const template = await prisma.template.create({
      data: {
        workspaceId,
        name,
        category: category || 'MARKETING',
        language: language || 'en_US',
        status: 'PENDING',
        aiGenerated: true,
        components: [{ type: 'BODY', text: body }],
      },
    });
    res.json(template);
  } catch (error) {
    next(error);
  }
};

export const createCampaign = async (req, res, next) => {
  try {
    const { workspaceId, id: userId } = req.user;
    await assertMembership(userId, workspaceId);
    const { name, templateId } = req.body;
    if (!name || !templateId) return res.status(400).json({ error: 'name and templateId are required' });

    const template = await prisma.template.findFirst({ where: { id: templateId, workspaceId } });
    if (!template) return res.status(404).json({ error: 'Template not found in this workspace' });

    // Created as an honest DRAFT with zero stats — the campaign worker is the
    // only thing allowed to move counters. No fabricated totals.
    const campaign = await prisma.campaign.create({
      data: {
        workspaceId,
        name,
        templateId,
        status: 'DRAFT',
        aiGenerated: true,
      },
    });
    res.json(campaign);
  } catch (error) {
    next(error);
  }
};

export const updateCampaign = async (req, res, next) => {
  try {
    const { workspaceId, id: userId } = req.user;
    await assertMembership(userId, workspaceId);
    const { id, status } = req.body;
    const allowed = ['DRAFT', 'CANCELLED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
    }
    // updateMany with the workspace filter guarantees scoping (compound
    // `where: { id, workspaceId }` is not a unique selector for `update`).
    const result = await prisma.campaign.updateMany({
      where: { id, workspaceId },
      data: { status },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Campaign not found' });
    res.json(await prisma.campaign.findUnique({ where: { id } }));
  } catch (error) {
    next(error);
  }
};

export const updateTemplate = async (req, res, next) => {
  try {
    const { workspaceId, id: userId } = req.user;
    await assertMembership(userId, workspaceId);
    const { id, body } = req.body;
    if (!body) return res.status(400).json({ error: 'body is required' });
    const result = await prisma.template.updateMany({
      where: { id, workspaceId },
      data: { components: [{ type: 'BODY', text: body }], status: 'PENDING' },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Template not found' });
    res.json(await prisma.template.findUnique({ where: { id } }));
  } catch (error) {
    next(error);
  }
};

export const executeWorkflow = async (req, res, next) => {
  try {
    const { workspaceId, id: userId } = req.user;
    await assertMembership(userId, workspaceId);
    const { workflowId, sampleMessage } = req.body;
    if (!workflowId) return res.status(400).json({ error: 'workflowId is required' });
    // Runs a real interpretation of the workflow's nodes and returns an honest
    // trace — no more canned "success" for empty/nonsensical workflows.
    const result = await simulateWorkflow(workspaceId, workflowId, sampleMessage || 'Hi');
    res.json(result);
  } catch (error) {
    next(error);
  }
};
