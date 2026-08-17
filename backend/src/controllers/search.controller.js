import * as searchService from '../services/search.service.js';

export async function search(req, res) {
  const result = await searchService.searchWorkspace(req.params.workspaceId, {
    q: req.query.q,
    limit: req.query.limit,
  });
  res.json(result);
}
