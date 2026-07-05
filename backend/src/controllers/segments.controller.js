import * as segmentsService from '../services/segments.service.js';

// List all segments with optional pagination (not implemented for simplicity)
export async function listSegments(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const segments = await segmentsService.listSegments(workspaceId);
    res.json(segments);
  } catch (err) {
    console.error('[Segments] list error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list segments' });
  }
}

export async function createSegment(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const { name, desc, color } = req.body;
    const segment = await segmentsService.createSegment(workspaceId, { name, desc, color });
    res.status(201).json(segment);
  } catch (err) {
    console.error('[Segments] create error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create segment' });
  }
}

export async function updateSegment(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const segmentId = req.params.id;
    const updates = req.body;
    const segment = await segmentsService.updateSegment(workspaceId, segmentId, updates);
    res.json(segment);
  } catch (err) {
    console.error('[Segments] update error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update segment' });
  }
}

export async function deleteSegment(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const segmentId = req.params.id;
    await segmentsService.deleteSegment(workspaceId, segmentId);
    res.status(204).send();
  } catch (err) {
    console.error('[Segments] delete error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to delete segment' });
  }
}

// Contact association
export async function addContactToSegment(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const segmentId = req.params.id;
    const contactData = req.body; // may contain existing contactId or contact fields to create
    const result = await segmentsService.addContactToSegment(workspaceId, segmentId, contactData);
    res.status(201).json(result);
  } catch (err) {
    console.error('[Segments] addContact error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to add contact to segment' });
  }
}

export async function updateContactInSegment(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const segmentId = req.params.id;
    const contactId = req.params.contactId;
    const updates = req.body;
    const updated = await segmentsService.updateContactInSegment(workspaceId, segmentId, contactId, updates);
    res.json(updated);
  } catch (err) {
    console.error('[Segments] updateContact error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update contact in segment' });
  }
}

export async function removeContactFromSegment(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const segmentId = req.params.id;
    const contactId = req.params.contactId;
    await segmentsService.removeContactFromSegment(workspaceId, segmentId, contactId);
    res.status(204).send();
  } catch (err) {
    console.error('[Segments] removeContact error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to remove contact from segment' });
  }
}
