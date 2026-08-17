-- Store the bytes of a template's header image.
--
-- Meta hands back two different, non-interchangeable identifiers for header
-- media. The `header_handle` produced by the Resumable Upload API is accepted
-- only when the template is created, as the sample a human reviewer looks at;
-- it is rejected at send time. Sending a template that has a media header
-- requires supplying real media again on EVERY message, as a media id from
-- POST /{phone-number-id}/media — and those ids expire after about 30 days.
--
-- So neither identifier can be stored once and reused. The only thing that
-- survives is the image itself, which is why the bytes live here: an approved
-- template must still be able to mint a fresh media id months later, and the
-- app runs on ephemeral containers where a file on disk would not survive a
-- redeploy.
--
-- metaMediaId/metaMediaNumberId/metaMediaAt are a cache of the most recent
-- send-time upload, not a source of truth — a media id is scoped to the phone
-- number that uploaded it, so it is re-minted whenever it is missing, stale,
-- or belongs to a different number.

CREATE TABLE IF NOT EXISTS "TemplateAsset" (
  "id"                TEXT NOT NULL,
  "workspaceId"       TEXT NOT NULL,
  "mimeType"          TEXT NOT NULL,
  "bytes"             BYTEA NOT NULL,
  "sizeBytes"         INTEGER NOT NULL,
  "prompt"            TEXT,
  "source"            TEXT NOT NULL DEFAULT 'upload',
  "metaMediaId"       TEXT,
  "metaMediaNumberId" TEXT,
  "metaMediaAt"       TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TemplateAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TemplateAsset_workspaceId_idx" ON "TemplateAsset"("workspaceId");

ALTER TABLE "TemplateAsset"
  DROP CONSTRAINT IF EXISTS "TemplateAsset_workspaceId_fkey";
ALTER TABLE "TemplateAsset"
  ADD CONSTRAINT "TemplateAsset_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable with no default: every existing template keeps working, and code
-- deployed before this migration is unaffected. Templates synced from Meta
-- have no bytes on our side and so stay null — the send path reports that
-- explicitly rather than silently dropping the image.
ALTER TABLE "Template"
  ADD COLUMN IF NOT EXISTS "headerAssetId" TEXT;

CREATE INDEX IF NOT EXISTS "Template_headerAssetId_idx" ON "Template"("headerAssetId");

-- SET NULL rather than CASCADE: losing the image must not delete the template
-- (and its campaign history) along with it.
ALTER TABLE "Template"
  DROP CONSTRAINT IF EXISTS "Template_headerAssetId_fkey";
ALTER TABLE "Template"
  ADD CONSTRAINT "Template_headerAssetId_fkey"
  FOREIGN KEY ("headerAssetId") REFERENCES "TemplateAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
