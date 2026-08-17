import * as tasksService from '../services/tasks.service.js';

export async function list(req, res) {
  const { status, assignedToUserId, isOverdue } = req.query;
  const result = await tasksService.listTasks(req.params.workspaceId, { status, assignedToUserId, isOverdue });
  res.json(result);
}

export async function get(req, res) {
  const result = await tasksService.getTask(req.params.workspaceId, req.params.id);
  res.json(result);
}

export async function create(req, res) {
  const result = await tasksService.createTask(req.params.workspaceId, req.body, req.user.id);
  res.status(201).json(result);
}

export async function update(req, res) {
  const result = await tasksService.updateTask(req.params.workspaceId, req.params.id, req.body);
  res.json(result);
}

export async function remove(req, res) {
  await tasksService.deleteTask(req.params.workspaceId, req.params.id);
  res.status(204).send();
}
