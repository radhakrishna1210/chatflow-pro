-- Platform credentials editable from the super-admin UI, so rotating a key
-- does not mean waiting out a redeploy. Values are encrypted with the same
-- AES key as WhatsApp access tokens; only an allow-listed set of names is ever
-- read back (see config/settingsStore.js).

CREATE TABLE IF NOT EXISTS "SystemSetting" (
  "key"       TEXT         NOT NULL,
  "value"     TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
