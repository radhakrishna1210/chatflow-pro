// WhatsApp Forms controller
import * as whatsappFormsService from '../services/whatsappForms.service.js';
import { listFormTemplates } from '../data/formTemplates.js';

// Starter question sets + the category vocabulary the builder offers. Static
// data, but served from the API so the presets and the field types the
// runtime accepts cannot drift apart.
export async function listTemplates(req, res) {
  res.json(listFormTemplates());
}

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

export async function exportSubmissions(req, res) {
  try {
    const { from, to, label } = req.query;
    const { csv, filename, count } = await whatsappFormsService.exportSubmissionsCsv(req.params.workspaceId, req.params.id, { from, to, label });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(count));
    // A BOM so Excel shows ₹ and non-English names correctly.
    res.send(`﻿${csv}`);
  } catch (err) {
    console.error('[WhatsAppForms] export error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to export submissions' });
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
