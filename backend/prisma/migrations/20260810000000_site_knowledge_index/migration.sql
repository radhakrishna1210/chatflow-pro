-- Vector store for the website assistant (see services/siteKnowledge.service.js).
--
-- One row per indexed chunk of site content. Persisted so that embeddings
-- survive a restart: re-embedding the corpus on every boot would burn provider
-- quota that the assistant needs for answering. `contentHash` drives the
-- incremental sync — a chunk whose text has not changed keeps its embedding.
--
-- `embedding` is a plain double precision array, not pgvector. The corpus is
-- around a hundred chunks, so cosine similarity is computed in the app with an
-- exhaustive scan; an ANN index would be operational weight with nothing to
-- carry. Empty array means "not embedded yet" (the provider was unavailable),
-- and those chunks stay searchable through the lexical scorer.

CREATE TABLE IF NOT EXISTS "SiteKnowledgeChunk" (
  "id"          TEXT             NOT NULL,
  "ref"         TEXT             NOT NULL,
  "source"      TEXT             NOT NULL,
  "docId"       TEXT             NOT NULL,
  "title"       TEXT             NOT NULL,
  "topic"       TEXT,
  "content"     TEXT             NOT NULL,
  "contentHash" TEXT             NOT NULL,
  "embedding"   DOUBLE PRECISION[],
  "embeddedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SiteKnowledgeChunk_ref_key" ON "SiteKnowledgeChunk"("ref");
CREATE INDEX IF NOT EXISTS "SiteKnowledgeChunk_source_idx" ON "SiteKnowledgeChunk"("source");
