import * as crmSalesInboxService from '../services/crmSalesInbox.service.js';
import { prisma } from '../lib/prisma.js';
import { computeLeadCategory } from '../services/leadSegmentation.service.js';

export async function getSegments(req, res, next) {
  try {
    const data = await crmSalesInboxService.getInboxSegments(req.workspace.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function reviewAudience(req, res, next) {
  try {
    const { category, source, status, search } = req.query;
    const data = await crmSalesInboxService.reviewSegmentAudience(req.workspace.id, {
      category,
      source,
      status,
      search,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function recalculateLeadCategory(req, res, next) {
  try {
    const { leadId } = req.params;
    const updated = await computeLeadCategory(req.workspace.id, leadId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function launchBulkCampaign(req, res, next) {
  try {
    const { name, category, source, status, templateId, waNumberId } = req.body;
    const result = await crmSalesInboxService.launchSegmentCampaign(
      req.workspace.id,
      { name, category, source, status, templateId, waNumberId },
      req.user
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}
