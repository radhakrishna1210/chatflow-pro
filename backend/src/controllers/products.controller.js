import * as productsService from '../services/products.service.js';

export async function list(req, res) {
  res.json(await productsService.listProducts(req.params.workspaceId, {
    search: req.query.search, category: req.query.category,
    includeInactive: req.query.includeInactive === 'true',
  }));
}
export async function get(req, res) {
  res.json(await productsService.getProduct(req.params.workspaceId, req.params.id));
}
export async function create(req, res) {
  res.status(201).json(await productsService.createProduct(req.params.workspaceId, req.body));
}
export async function update(req, res) {
  res.json(await productsService.updateProduct(req.params.workspaceId, req.params.id, req.body));
}
export async function remove(req, res) {
  res.json(await productsService.deleteProduct(req.params.workspaceId, req.params.id));
}
