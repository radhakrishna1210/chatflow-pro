-- Data-only (CF-051): SMS/email fallback and Voice AI are now plan feature
-- flags (`fallback`, `voice`) enforced where they are switched on and where
-- they run. Both are on every plan, so every existing plan is granted them;
-- a value already set on a plan (by the admin Plans tab) is kept.
UPDATE "Plan"
SET "features" = '{"fallback": true, "voice": true}'::jsonb || COALESCE("features", '{}'::jsonb);
