import * as contactsService from '../services/contacts.service.js';

export async function list(req, res) {
  const { search, page, limit } = req.query;
  const result = await contactsService.listContacts(req.params.workspaceId, { search, page: +page || 1, limit: +limit || 20 });
  res.json(result);
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
