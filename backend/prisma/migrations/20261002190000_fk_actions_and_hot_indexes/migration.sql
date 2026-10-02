-- Referential actions (CF-083).
-- Invitation.invitedBy: an invitation is deleted with the user who sent it,
-- instead of blocking the user delete.
ALTER TABLE "Invitation" DROP CONSTRAINT IF EXISTS "Invitation_invitedByUserId_fkey";
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Campaign.template: NO ACTION instead of the implicit RESTRICT. Deleting a
-- template a campaign still uses keeps failing, but the check now runs at the
-- end of the statement, so a workspace delete that cascades to both succeeds.
ALTER TABLE "Campaign" DROP CONSTRAINT IF EXISTS "Campaign_templateId_fkey";
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Indexes for hot tenant-scoped queries (CF-084). IF NOT EXISTS because some
-- databases were shaped with `db push` and may already carry them.
CREATE INDEX IF NOT EXISTS "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");
CREATE INDEX IF NOT EXISTS "Campaign_workspaceId_createdAt_idx" ON "Campaign"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_lastMessageAt_idx" ON "Conversation"("workspaceId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_status_idx" ON "Conversation"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "Invoice_workspaceId_invoiceDate_idx" ON "Invoice"("workspaceId", "invoiceDate");
CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON "RefreshToken"("userId");
