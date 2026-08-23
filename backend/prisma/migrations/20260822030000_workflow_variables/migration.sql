-- Values collected during a workflow run, available to later steps as
-- {{token}}. Steps could previously only send fixed text, so every recipient of
-- an automation received a byte-identical message.
ALTER TABLE "WorkflowRun" ADD COLUMN "variables" JSONB;
