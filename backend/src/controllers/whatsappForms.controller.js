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
    const { name, fields } = req.body; // fields could be a number or array config; keep simple
    const form = await whatsappFormsService.createForm(workspaceId, { name, fields });
    res.status(201).json(form);
  } catch (err) {
    console.error('[WhatsAppForms] create error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create form' });
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
