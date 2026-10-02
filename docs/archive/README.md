# Archived audit and stabilisation reports

These files are dated records from earlier stabilisation passes. They used to
live at the repository root, where their "all issues resolved" and "N/N
passing" lines read as current status. They are **not** current:

- The 2026 deep audit re-checked them and found several items regressed or
  never implemented as described (for example missing `authorize('ADMIN')`
  checks claimed as fixed, a React Router migration and Redis-validated OAuth
  state that were never written, and the "every path" record-visibility claim).
- Some of them tell you to run `npx prisma migrate dev`. Never run that against
  a shared or hosted database: it can prompt to reset it. Use
  `prisma migrate deploy` (see [DEPLOY.md](../../DEPLOY.md)).

| File | What it was |
| --- | --- |
| `BUGS.md`, `BUGS-v2.md` | First and second bug audits |
| `STABILIZATION_REPORT.md`, `STABILIZATION_REPORT_V2.md` | Write-ups of the fixes for those audits |
| `issue_sheet.md` | Combined issue list from a later pass, marked "Resolved / Addressed" |
| `AI_FEATURES_REPORT.md` | Patch note for the AI agent / intent matching / fallback channels add-on |
| `OPEN_ISSUES.md` | Open items on the advanced-CRM branch as of 2026-08-16 |
| `TEST_EVIDENCE.md` | Verification log for the advanced-CRM expansion (2026-08-16/17) |

Superseded by:

- [`audit/BUG_SHEET.md`](../../audit/BUG_SHEET.md) — the living issue list
  (CF-001 … CF-227) with evidence and suggested fixes;
- [`audit/AUDIT_REPORT.md`](../../audit/AUDIT_REPORT.md) — the audit summary;
- [`audit/REMEDIATION_STATUS.md`](../../audit/REMEDIATION_STATUS.md) — what the
  audit-remediation release changed for each issue.
