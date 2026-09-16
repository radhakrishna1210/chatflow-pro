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

export async function updateSection(req, res, next) {
  try {
    const { workspaceId, sectionKey } = req.params;
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
