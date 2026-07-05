import * as automationService from '../services/automation.service.js';

export async function list(req, res) {
  try {
    const triggers = await automationService.listTriggers(req.params.workspaceId);
    res.json(triggers);
  } catch (err) {
    console.error('[Automation] list error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list triggers' });
  }
}

export async function create(req, res) {
  try {
    const trigger = await automationService.createTrigger(req.params.workspaceId, req.body);
    res.status(201).json(trigger);
  } catch (err) {
    console.error('[Automation] create error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create trigger' });
  }
}

export async function update(req, res) {
  try {
    const trigger = await automationService.updateTrigger(req.params.workspaceId, req.params.id, req.body);
    res.json(trigger);
  } catch (err) {
    console.error('[Automation] update error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update trigger' });
  }
}

export async function remove(req, res) {
  try {
    await automationService.deleteTrigger(req.params.workspaceId, req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('[Automation] remove error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to delete trigger' });
  }
}

export async function getBasicAutomations(req, res) {
  try {
    const automations = await automationService.getBasicAutomations(req.params.workspaceId);
    res.json(automations);
  } catch (err) {
    console.error('[Automation] getBasicAutomations error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to get automations' });
  }
}

export async function getVoiceSettings(req, res) {
  try {
    const settings = await automationService.getVoiceSettings(req.params.workspaceId);
    res.json(settings);
  } catch (err) {
    console.error('[Automation] getVoiceSettings error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to get voice settings' });
  }
}

export async function updateVoiceSettings(req, res) {
  try {
    const settings = await automationService.updateVoiceSettings(req.params.workspaceId, req.body);
    res.json(settings);
  } catch (err) {
    console.error('[Automation] updateVoiceSettings error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update voice settings' });
  }
}

export async function updateBasicAutomations(req, res) {
  try {
    const automations = await automationService.updateBasicAutomations(req.params.workspaceId, req.body);
    res.json(automations);
  } catch (err) {
    console.error('[Automation] updateBasicAutomations error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update automations' });
  }
}

