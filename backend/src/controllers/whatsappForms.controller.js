// WhatsApp Forms controller
import * as whatsappFormsService from '../services/whatsappForms.service.js';
import * as formScreenService from '../services/whatsappFormScreen.service.js';
import * as formStockService from '../services/whatsappFormStock.service.js';
import { listFormTemplates } from '../data/formTemplates.js';

// ── Form screen (the form as one WhatsApp Flow screen) ─────────────────────

export async function getScreen(req, res) {
  try {
    res.json(await formScreenService.getScreenState(req.params.workspaceId, req.params.id));
  } catch (err) {
    console.error('[WhatsAppForms] screen state error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to load the form screen' });
  }
}

export async function publishScreen(req, res) {
  try {
    res.json(await formScreenService.publishScreen(req.params.workspaceId, req.params.id));
  } catch (err) {
    console.error('[WhatsAppForms] screen publish error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to publish the form screen' });
  }
}

// ── Today's stock (how much of each quantity question can still be ordered) ─

export async function getStock(req, res) {
  try {
    res.json(await formStockService.getStock(req.params.workspaceId, req.params.id));
  } catch (err) {
    console.error('[WhatsAppForms] stock error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to load stock' });
  }
}

export async function setStock(req, res) {
  try {
    res.json(await formStockService.setStock(req.params.workspaceId, req.params.id, req.body || {}));
  } catch (err) {
    console.error('[WhatsAppForms] stock update error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to save stock' });
  }
}

export async function updateScreen(req, res) {
  try {
    res.json(await formScreenService.setScreenEnabled(req.params.workspaceId, req.params.id, req.body?.enabled));
  } catch (err) {
    console.error('[WhatsAppForms] screen update error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update the form screen' });
  }
}

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

export async function getSettings(req, res) {
  try {
    res.json(await whatsappFormsService.getFormSettings(req.params.workspaceId));
  } catch (err) {
    console.error('[WhatsAppForms] settings error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to load settings' });
  }
}

export async function updateSettings(req, res) {
  try {
    res.json(await whatsappFormsService.updateFormSettings(req.params.workspaceId, req.body || {}));
  } catch (err) {
    console.error('[WhatsAppForms] settings update error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to save settings' });
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
    // A form shown as a screen is republished when its questions change, so
    // the screen never asks yesterday's questions. In the background: a slow
    // or failed publish must not hold up or fail the save (the form falls back
    // to chat until the screen is current again).
    if (updates?.schema !== undefined || updates?.name !== undefined) {
      formScreenService.republishIfStale(workspaceId, formId);
    }
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
