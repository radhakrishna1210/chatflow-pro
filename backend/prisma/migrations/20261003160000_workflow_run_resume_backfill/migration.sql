-- Workflow runs parked before "resumeAt" existed (migration 20261002150000
-- added the column with no value) were ignored by the recovery sweep, which
-- selects on resumeAt <= now: a run waiting on a delay never resumed, and
-- hasActiveRun() kept reporting the conversation busy.
--
-- Data only, no schema change. Idempotent: it touches only active runs whose
-- resumeAt is still NULL.
--
-- resumeAt is TIMESTAMP(3) without time zone, holding UTC (Prisma's
-- convention), so now() and the ISO "since" strings are converted to UTC.

-- A run waiting for the customer's reply ("__awaitingReply" in variables)
-- gets its reply deadline: 24 hours after it started waiting. The sweep then
-- closes it at the deadline, or sends an owed reminder first. A marker with no
-- readable "since" is due now (the sweep closes it as expired).
UPDATE "WorkflowRun"
SET "resumeAt" = CASE
    WHEN ("variables" -> '__awaitingReply' ->> 'since') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
      THEN ((("variables" -> '__awaitingReply' ->> 'since')::timestamptz + INTERVAL '24 hours') AT TIME ZONE 'UTC')
    ELSE (now() AT TIME ZONE 'UTC')
  END
WHERE "status" IN ('RUNNING', 'WAITING')
  AND "resumeAt" IS NULL
  AND "variables" IS NOT NULL
  AND jsonb_typeof("variables"::jsonb -> '__awaitingReply') = 'object';

-- Every other active run (parked on a delay, or RUNNING with no lease) is due
-- now: the sweep resumes it from its persisted cursor.
UPDATE "WorkflowRun"
SET "resumeAt" = (now() AT TIME ZONE 'UTC')
WHERE "status" IN ('RUNNING', 'WAITING')
  AND "resumeAt" IS NULL;
