-- File storage behind lib/storage (CF-165).
--
-- TemplateAsset: with an object store configured the image goes to the bucket
-- and only its key is kept here, so `bytes` becomes optional. Existing rows
-- keep their bytes until scripts/migrate-uploads-to-object-storage.js copies
-- them across (and, with --purge-db-bytes, clears them).
ALTER TABLE "TemplateAsset" ALTER COLUMN "bytes" DROP NOT NULL;
ALTER TABLE "TemplateAsset" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;

-- Message: our own copy of inbound/outbound WhatsApp media, which Meta deletes
-- after ~30 days.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mediaStorageKey" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mediaSize" INTEGER;
