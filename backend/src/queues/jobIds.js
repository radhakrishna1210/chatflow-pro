// Every custom BullMQ job id the app builds, in one place so the queues and
// their tests share the same builders.
//
// BullMQ (5.x) rejects a custom id that looks like an integer, and one that
// contains ':' unless it splits into exactly three parts — a legacy exception
// its own source marks for removal in the next breaking release. A rejected id
// throws at enqueue time, which a caller that swallows errors turns into a job
// that silently never runs. So: no colons, and always a non-numeric prefix.

const join = (...parts) => parts.join('__');

// A workflow run parked on a delay step. The cursor is part of the id because
// a run may park on several delays; a run-only id would collide on the second.
export const workflowResumeJobId = (runId, cursor) => join('resume', runId, cursor);

// One pending "Delayed Response Message" check per conversation.
export const delayedResponseJobId = (conversationId) => join('delayed', conversationId);

// The reminder for an unanswered wait_reply step.
export const replyReminderJobId = (runId, cursor) => join('remind', runId, cursor);

// The sweep-driven advance of one sequence enrollment. Deterministic, so a
// sweep that finds the same due enrollment twice collapses into one job.
export const sequenceAdvanceJobId = (enrollmentId) => `advance-${enrollmentId}`;

// A follow-up scheduled from inside a running advance job. It must not reuse
// that job's own id (the running job is locked and cannot be replaced), so it
// is scoped to the time it is due.
export const sequenceFollowUpJobId = (enrollmentId, dueAtMs) => `advance-${enrollmentId}-${Math.round(dueAtMs)}`;

// One campaign retry per (recipient, attempt). Recovery rebuilds it from the
// row, so it must stay derivable from data the database holds.
export const retryJobId = (recipientId, attempt) => `retry-${recipientId}-${attempt}`;

// The colon form retries were queued under before; only used to clear a job
// still waiting in Redis under the old id so recovery does not run it twice.
export const legacyRetryJobId = (recipientId, attempt) => `retry:${recipientId}:${attempt}`;
