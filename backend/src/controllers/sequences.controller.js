import * as sequencesService from '../services/sequences.service.js';
import { enqueueAdvance } from '../queues/sequence.queue.js';

export async function list(req, res) {
  res.json(await sequencesService.listSequences(req.params.workspaceId, { status: req.query.status }));
}
export async function get(req, res) {
  res.json(await sequencesService.getSequence(req.params.workspaceId, req.params.id));
}
export async function create(req, res) {
  res.status(201).json(await sequencesService.createSequence(req.params.workspaceId, req.body, req.user.id));
}
export async function update(req, res) {
  res.json(await sequencesService.updateSequence(req.params.workspaceId, req.params.id, req.body));
}
export async function changeStatus(req, res) {
  res.json(await sequencesService.changeSequenceStatus(req.params.workspaceId, req.params.id, req.body.status));
}
export async function remove(req, res) {
  await sequencesService.deleteSequence(req.params.workspaceId, req.params.id);
  res.status(204).send();
}
export async function enroll(req, res) {
  const result = await sequencesService.enrollContacts(req.params.workspaceId, req.params.id, req.body);
  // Kick each new enrollment immediately; the sweep would otherwise take up to
  // a minute to notice, which feels broken when a rep just pressed Enrol.
  //
  // A failure here is logged rather than swallowed — the enrollment is already
  // committed with nextRunAt set, so the sweep still recovers it, but silence
  // is how a broken queue id went unnoticed before.
  for (const id of result.enrollmentIds) {
    await enqueueAdvance(id).catch((err) => {
      console.error(`[Sequence] Could not queue enrollment ${id}, leaving it to the sweep:`, err.message);
    });
  }
  res.status(201).json(result);
}
export async function unenroll(req, res) {
  res.json(await sequencesService.unenroll(req.params.workspaceId, req.params.enrollmentId));
}
