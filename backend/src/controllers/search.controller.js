import * as searchService from '../services/search.service.js';

export async function search(req, res) {
  // req.user is what applies record-level visibility — without it the palette
  // lists records the caller cannot open.
  const result = await searchService.searchWorkspace(req.params.workspaceId, {
    q: req.query.q,
    limit: req.query.limit,
  }, req.user);
  res.json(result);
}
