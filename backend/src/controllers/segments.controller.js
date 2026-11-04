import * as segmentsService from '../services/segments.service.js';

// List all segments with optional pagination (not implemented for simplicity)
export async function listSegments(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId;
    const segments = await segmentsService.listSegments(workspaceId);
    res.json(segments);
  } catch (err) {
    // The shared error handler keeps a 4xx message and replaces a 5xx (a raw
    // Prisma error, say) with a reference, rather than echoing it to the client.
    next(err);
  }
}

export async function createSegment(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId;
    const { name, desc, color } = req.body;
    const segment = await segmentsService.createSegment(workspaceId, { name, desc, color });
    res.status(201).json(segment);
  } catch (err) {
    // The shared error handler keeps a 4xx message and replaces a 5xx (a raw
    // Prisma error, say) with a reference, rather than echoing it to the client.
    next(err);
  }
}

export async function updateSegment(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId;
    const segmentId = req.params.id;
    const updates = req.body;
    const segment = await segmentsService.updateSegment(workspaceId, segmentId, updates);
    res.json(segment);
  } catch (err) {
    // The shared error handler keeps a 4xx message and replaces a 5xx (a raw
    // Prisma error, say) with a reference, rather than echoing it to the client.
    next(err);
  }
}

export async function deleteSegment(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId;
    const segmentId = req.params.id;
    await segmentsService.deleteSegment(workspaceId, segmentId);
    res.status(204).send();
  } catch (err) {
    // The shared error handler keeps a 4xx message and replaces a 5xx (a raw
    // Prisma error, say) with a reference, rather than echoing it to the client.
    next(err);
  }
}

// Contact association
export async function addContactToSegment(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId;
    const segmentId = req.params.id;
    const contactData = req.body; // may contain existing contactId or contact fields to create
    const result = await segmentsService.addContactToSegment(workspaceId, segmentId, contactData);
    res.status(201).json(result);
  } catch (err) {
    // The shared error handler keeps a 4xx message and replaces a 5xx (a raw
    // Prisma error, say) with a reference, rather than echoing it to the client.
    next(err);
  }
}

export async function updateContactInSegment(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId;
    const segmentId = req.params.id;
    const contactId = req.params.contactId;
    const updates = req.body;
    const updated = await segmentsService.updateContactInSegment(workspaceId, segmentId, contactId, updates);
    res.json(updated);
  } catch (err) {
    // The shared error handler keeps a 4xx message and replaces a 5xx (a raw
    // Prisma error, say) with a reference, rather than echoing it to the client.
    next(err);
  }
}

export async function removeContactFromSegment(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId;
    const segmentId = req.params.id;
    const contactId = req.params.contactId;
    await segmentsService.removeContactFromSegment(workspaceId, segmentId, contactId);
    res.status(204).send();
  } catch (err) {
    // The shared error handler keeps a 4xx message and replaces a 5xx (a raw
    // Prisma error, say) with a reference, rather than echoing it to the client.
    next(err);
  }
}
