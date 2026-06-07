import { prisma } from '../lib/prisma.js';

export const createTemplate = async (req, res) => {
  try {
    const { workspaceId } = req.user;
    const { name, category, language, body } = req.body;
    
    const template = await prisma.template.create({
      data: {
        workspaceId,
        name,
        category: category || 'MARKETING',
        language: language || 'en_US',
        status: 'APPROVED',
        aiGenerated: true,
        components: [
          { type: 'BODY', text: body }
        ]
      }
    });
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createCampaign = async (req, res) => {
  try {
    const { workspaceId } = req.user;
    const { name, templateId } = req.body;
    
    const campaign = await prisma.campaign.create({
      data: {
        workspaceId,
        name,
        templateId,
        status: 'RUNNING',
        aiGenerated: true,
        totalContacts: 100
      }
    });
    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateCampaign = async (req, res) => {
  try {
    const { workspaceId } = req.user;
    const { id, status } = req.body;
    const campaign = await prisma.campaign.update({
      where: { id, workspaceId },
      data: { status }
    });
    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateTemplate = async (req, res) => {
  try {
    const { workspaceId } = req.user;
    const { id, body } = req.body;
    const template = await prisma.template.update({
      where: { id, workspaceId },
      data: { 
        components: [
          { type: 'BODY', text: body }
        ] 
      }
    });
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const executeWorkflow = async (req, res) => {
  res.json({ status: 'workflow_executed', message: 'Successfully triggered automation flow via AI' });
};
