import * as service from '../services/crmCustomization.service.js';

export async function getAllCustomizations(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const data = await service.getAllCustomizations(workspaceId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getSection(req, res, next) {
  try {
    const { workspaceId, sectionKey } = req.params;
    const data = await service.getSection(workspaceId, sectionKey);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// The pipeline (stage set, order and win probabilities) drives every
// member's board and the forecast, which is why /pipeline-stages is an admin
// action. deal_setup rewrites the same PipelineStage rows, so it carries the
// same rule — otherwise any member could do here what that route forbids.
const ADMIN_ONLY_SECTIONS = new Set(['deal_setup']);
function assertSectionRole(req, sectionKey) {
  if (ADMIN_ONLY_SECTIONS.has(sectionKey) && req.user?.role !== 'ADMIN' && req.user?.superAdmin !== true) {
    const e = new Error('Only a workspace admin can change the deal pipeline'); e.status = 403; throw e;
  }
}

export async function updateSection(req, res, next) {
  try {
    const { workspaceId, sectionKey } = req.params;
    assertSectionRole(req, sectionKey);
    const userId = req.user?.id || null;
    const data = await service.updateSection(workspaceId, sectionKey, req.body, userId);
    res.json({ data, message: `Successfully updated ${sectionKey} customization` });
  } catch (err) {
    next(err);
  }
}

export async function resetSection(req, res, next) {
  try {
    const { workspaceId, sectionKey } = req.params;
    assertSectionRole(req, sectionKey);
    const data = await service.resetSection(workspaceId, sectionKey);
    res.json({ data, message: `Successfully reset ${sectionKey} to system defaults` });
  } catch (err) {
    next(err);
  }
}

export async function checkSafeDelete(req, res, next) {
  try {
    const { workspaceId, sectionKey } = req.params;
    const { key, id } = req.query;
    const target = key || id;
    if (!target) {
      return res.status(400).json({ error: 'Missing key or id query parameter' });
    }
    const result = await service.checkSafeDeletion(workspaceId, sectionKey, target);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
