-- Two more workspace roles.
--
-- Only ADMIN and CLIENT existed, so there was no way to give someone the inbox
-- without also giving them campaigns, templates, automations and API keys, and
-- no read-only access at all.
--
-- Existing rows are untouched: ADMIN and CLIENT keep their exact meaning, so
-- nobody's access changes on deploy.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'VIEWER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'AGENT';
