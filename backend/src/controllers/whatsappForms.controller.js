// WhatsApp Forms controller
import * as whatsappFormsService from '../services/whatsappForms.service.js';

export async function listForms(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const forms = await whatsappFormsService.listForms(workspaceId);
    res.json(forms);
  } catch (err) {
    console.error('[WhatsAppForms] list error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list forms' });
  }
}

export async function createForm(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const form = await whatsappFormsService.createForm(workspaceId, req.body);
    res.status(201).json(form);
  } catch (err) {
    console.error('[WhatsAppForms] create error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create form' });
  }
}

export async function listSubmissions(req, res) {
  try {
    const submissions = await whatsappFormsService.listSubmissions(req.params.workspaceId, req.params.id);
    res.json(submissions);
  } catch (err) {
    console.error('[WhatsAppForms] submissions error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list submissions' });
  }
}

export async function updateForm(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const formId = req.params.id;
    const updates = req.body;
    const form = await whatsappFormsService.updateForm(workspaceId, formId, updates);
    res.json(form);
  } catch (err) {
    console.error('[WhatsAppForms] update error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update form' });
  }
}

export async function deleteForm(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const formId = req.params.id;
    await whatsappFormsService.deleteForm(workspaceId, formId);
    res.status(204).send();
  } catch (err) {
    console.error('[WhatsAppForms] delete error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to delete form' });
  }
}
