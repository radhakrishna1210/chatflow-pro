-- Smart Website Widget: an embeddable widget a customer installs on their own
-- site, answering visitor questions from that customer's indexed website
-- content, capturing leads into Contacts, and handing off to WhatsApp.

-- The knowledge index becomes two-tenanted rather than gaining a twin table:
-- retrieval, embedding and the incremental content-hash sync are identical for
-- the platform's own corpus and a customer's, and only the scope of a search
-- differs. NULL keeps every existing row on the platform corpus, which is
-- exactly where the landing-page assistant expects to find it.
ALTER TABLE "SiteKnowledgeChunk"
  ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

CREATE INDEX IF NOT EXISTS "SiteKnowledgeChunk_workspaceId_idx"
  ON "SiteKnowledgeChunk" ("workspaceId");

DO $$ BEGIN
  CREATE TYPE "WidgetType" AS ENUM ('WHATSAPP', 'AI', 'AI_WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WidgetEventType" AS ENUM (
    'IMPRESSION', 'OPEN', 'QUESTION', 'ANSWER', 'WHATSAPP_CLICK', 'LEAD', 'HANDOFF'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Widget" (
  "id"             TEXT         NOT NULL,
  "workspaceId"    TEXT         NOT NULL,
  "name"           TEXT         NOT NULL,
  "type"           "WidgetType" NOT NULL DEFAULT 'AI_WHATSAPP',
  "enabled"        BOOLEAN      NOT NULL DEFAULT true,
  -- Appears in the page source of a public website, so it is a rotatable
  -- random key rather than the primary key.
  "publicKey"      TEXT         NOT NULL,
  "waNumberId"     TEXT,
  "config"         JSONB        NOT NULL,
  "allowedDomains" TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "pagePaths"      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "leadCapture"    JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Widget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Widget_publicKey_key" ON "Widget" ("publicKey");
CREATE INDEX IF NOT EXISTS "Widget_workspaceId_idx" ON "Widget" ("workspaceId");

CREATE TABLE IF NOT EXISTS "WidgetSession" (
  "id"          TEXT         NOT NULL,
  "widgetId"    TEXT         NOT NULL,
  "workspaceId" TEXT         NOT NULL,
  -- A random id the browser holds for the tab: no cookie, and it identifies
  -- nobody until the visitor chooses to leave their details.
  "visitorKey"  TEXT         NOT NULL,
  "transcript"  JSONB        NOT NULL DEFAULT '[]',
  "contactId"   TEXT,
  "pageUrl"     TEXT,
  "handedOff"   BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WidgetSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WidgetSession_visitorKey_key" ON "WidgetSession" ("visitorKey");
CREATE INDEX IF NOT EXISTS "WidgetSession_widgetId_idx" ON "WidgetSession" ("widgetId");
CREATE INDEX IF NOT EXISTS "WidgetSession_workspaceId_idx" ON "WidgetSession" ("workspaceId");

CREATE TABLE IF NOT EXISTS "WidgetEvent" (
  "id"          TEXT              NOT NULL,
  "widgetId"    TEXT              NOT NULL,
  "workspaceId" TEXT              NOT NULL,
  "type"        "WidgetEventType" NOT NULL,
  "visitorKey"  TEXT,
  "meta"        JSONB,
  "createdAt"   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WidgetEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WidgetEvent_widgetId_type_idx" ON "WidgetEvent" ("widgetId", "type");
CREATE INDEX IF NOT EXISTS "WidgetEvent_widgetId_createdAt_idx" ON "WidgetEvent" ("widgetId", "createdAt");
CREATE INDEX IF NOT EXISTS "WidgetEvent_workspaceId_idx" ON "WidgetEvent" ("workspaceId");

CREATE TABLE IF NOT EXISTS "KnowledgeSource" (
  "id"          TEXT         NOT NULL,
  "workspaceId" TEXT         NOT NULL,
  "kind"        TEXT         NOT NULL,
  "url"         TEXT,
  "title"       TEXT         NOT NULL,
  "content"     TEXT         NOT NULL DEFAULT '',
  "status"      TEXT         NOT NULL DEFAULT 'PENDING',
  "error"       TEXT,
  "fetchedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "KnowledgeSource_workspaceId_idx" ON "KnowledgeSource" ("workspaceId");

-- Foreign keys. A widget dies with its workspace; a disconnected WhatsApp
-- number leaves the widget standing (it falls back to the workspace's number)
-- rather than deleting a live installation out from under a customer's site.
ALTER TABLE "Widget"
  ADD CONSTRAINT "Widget_workspaceId_fkey" FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Widget"
  ADD CONSTRAINT "Widget_waNumberId_fkey" FOREIGN KEY ("waNumberId")
  REFERENCES "WaNumber" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WidgetSession"
  ADD CONSTRAINT "WidgetSession_widgetId_fkey" FOREIGN KEY ("widgetId")
  REFERENCES "Widget" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WidgetSession"
  ADD CONSTRAINT "WidgetSession_workspaceId_fkey" FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A deleted contact must not take the visitor's transcript with it.
ALTER TABLE "WidgetSession"
  ADD CONSTRAINT "WidgetSession_contactId_fkey" FOREIGN KEY ("contactId")
  REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WidgetEvent"
  ADD CONSTRAINT "WidgetEvent_widgetId_fkey" FOREIGN KEY ("widgetId")
  REFERENCES "Widget" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WidgetEvent"
  ADD CONSTRAINT "WidgetEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeSource"
  ADD CONSTRAINT "KnowledgeSource_workspaceId_fkey" FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
