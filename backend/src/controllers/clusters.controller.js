import * as clustersService from '../services/clusters.service.js';

export async function list(req, res) {
  const result = await clustersService.listClusters(req.params.workspaceId);
  res.json(result);
}

export async function get(req, res) {
  const clusterId = req.params.clusterId || req.params.id;
  const result = await clustersService.getCluster(req.params.workspaceId, clusterId);
  res.json(result);
}

export async function create(req, res) {
  const result = await clustersService.createCluster(req.params.workspaceId, req.body);
  res.status(201).json(result);
}

export async function update(req, res) {
  const clusterId = req.params.clusterId || req.params.id;
  const result = await clustersService.updateCluster(req.params.workspaceId, clusterId, req.body);
  res.json(result);
}

export async function remove(req, res) {
  const clusterId = req.params.clusterId || req.params.id;
  await clustersService.deleteCluster(req.params.workspaceId, clusterId);
  res.status(204).send();
}
