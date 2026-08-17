-- Organisational tags on a WhatsApp Form, e.g. ["Feedback","Survey"].
--
-- Nullable with no default, so existing forms keep working untouched and code
-- deployed before this migration still runs against the new shape.

ALTER TABLE "WhatsappForm"
  ADD COLUMN IF NOT EXISTS "categories" JSONB;
