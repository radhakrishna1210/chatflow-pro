import * as contactsService from '../services/contacts.service.js';

export async function list(req, res) {
  const {
    search, page, limit, clusterId, segmentId, tags, status, sort,
    createdFrom, createdTo, updatedFrom, updatedTo,
  } = req.query;
  // 'all' is how the campaign audience picker asks for the whole book.
  const parsedLimit = limit === 'all' || limit === '0' ? 10000 : Math.min(+limit || 20, 10000);
  const result = await contactsService.listContacts(req.params.workspaceId, {
    search, clusterId, segmentId, tags, status, sort,
    createdFrom, createdTo, updatedFrom, updatedTo,
    page: +page || 1, limit: parsedLimit,
  });
  res.json(result);
}

// Distinct tags in use, for the filter panel's tag picker.
export async function tags(req, res) {
  res.json(await contactsService.listContactTags(req.params.workspaceId));
}

export async function getOne(req, res) {
  const contact = await contactsService.getContact(req.params.workspaceId, req.params.id);
  res.json(contact);
}

export async function create(req, res) {
  const contact = await contactsService.createContact(req.params.workspaceId, req.body);
  res.status(201).json(contact);
}

export async function importCsv(req, res) {
  if (!req.file) return res.status(400).json({ error: 'CSV file required' });
  const result = await contactsService.importContacts(req.params.workspaceId, req.file.buffer);
  res.json(result);
}

export async function remove(req, res) {
  await contactsService.deleteContact(req.params.workspaceId, req.params.id);
  res.status(204).send();
}

export async function update(req, res) {
  const contact = await contactsService.updateContact(req.params.workspaceId, req.params.id, req.body);
  res.json(contact);
}

// CSV download. Sends the same filters the list endpoint takes, so "export"
// means "export what I am looking at".
export async function exportCsv(req, res) {
  const { page: _p, limit: _l, ...filters } = req.query;
  const { csv, filename, count, truncated } = await contactsService.exportContactsCsv(
    req.params.workspaceId, filters,
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Export-Count', String(count));
  if (truncated) res.setHeader('X-Export-Truncated', 'true');
  // A BOM so Excel opens non-ASCII names in the right encoding instead of
  // mangling them.
  res.send('﻿' + csv);
}
