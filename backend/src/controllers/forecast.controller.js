import * as forecastService from '../services/forecast.service.js';

export async function get(req, res) {
  const result = await forecastService.getForecast(req.params.workspaceId, {
    from: req.query.from,
    to: req.query.to,
    ownerUserId: req.query.ownerUserId,
  });
  res.json(result);
}
