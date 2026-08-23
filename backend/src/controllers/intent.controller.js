import * as svc from '../services/intent.service.js';

// Intent routing rules. Thin wrappers — every decision lives in the service so
// the inbound message path and the dashboard share one matcher.

const fail = (res, err, fallback) => {
  if (!err?.status || err.status >= 500) console.error('[Intent]', err);
  res.status(err?.status || 500).json({ error: err?.message || fallback });
};

export async function list(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const [rules, hits] = await Promise.all([
      svc.listRules(workspaceId),
      svc.ruleHits(workspaceId),
    ]);
    // The card shows "matched N× in 30d" under each rule, so the count rides
    // along rather than costing the client a second request per rule.
    res.json(rules.map((r) => ({ ...r, matchCount30d: hits[r.id] || 0, routedTo: svc.describeAction(r) })));
  } catch (err) { fail(res, err, 'Failed to list intents'); }
}

export async function create(req, res) {
  try {
    res.status(201).json(await svc.createRule(req.params.workspaceId, req.body || {}));
  } catch (err) { fail(res, err, 'Failed to create intent'); }
}

export async function update(req, res) {
  try {
    res.json(await svc.updateRule(req.params.workspaceId, req.params.id, req.body || {}));
  } catch (err) { fail(res, err, 'Failed to update intent'); }
}

export async function remove(req, res) {
  try {
    res.json(await svc.deleteRule(req.params.workspaceId, req.params.id));
  } catch (err) { fail(res, err, 'Failed to delete intent'); }
}

export async function test(req, res) {
  try {
    res.json(await svc.testMessage(req.params.workspaceId, req.body?.message));
  } catch (err) { fail(res, err, 'Failed to test message'); }
}

export async function accuracy(req, res) {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    res.json(await svc.accuracy(req.params.workspaceId, days));
  } catch (err) { fail(res, err, 'Failed to load accuracy'); }
}
