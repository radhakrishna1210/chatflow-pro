# Workflow and automation audit (2026-10-03)

QA reported that WhatsApp workflows and automations "fail and don't trigger".
Four read-only audits covered the inbound trigger path, the workflow engine,
the builder-to-engine contract, and event triggers, sequences and regressions
from the remediation release. About 65 throwaway tests reproduced the bugs
before anything was changed.

**Conclusion.** The keyword-to-workflow matcher works correctly. Workflows
looked broken for four reasons:

1. Several layers in front of the engine swallowed messages silently, often
   permanently for one contact.
2. Some workflows could never deliver, yet reported COMPLETED.
3. When a send failed, the run history gave the wrong reason.
4. The Automation screen under-reported runs.

Items 1 and 2 are also present on `master`.

Fixes are on `fix/audit-remediation` (merges `89346a1`, `56c7a43`, `68fe609`,
`6f9400e`, plus `bea3528` and `b3c26e0`). Deploy steps and behaviour changes
are in [`DEPLOY.md`](../DEPLOY.md) §4, under "Workflow automation fixes",
"Sequences and CRM events" and "Workflow engine fixes".

## Why a workflow did not fire (inbound)

| Finding | Fix |
|---|---|
| Any manual inbox reply, an "Assign to agent" step, the bare word "agent"/"human", escalation words ("refund", "worst") with no AI agent deployed, or an AI provider failure set `humanHandoffAt`. That switched off **all** automation on the chat until it was resolved. Nothing was logged in run history. | The handoff expires after `HANDOFF_TTL_HOURS` (default 24) without a human reply, and closing or resolving the chat ends it. The reason is recorded (`Conversation.handoffReason`) and shown on an inbox banner. A bare "agent" hands off only while a flow is open. Escalation rules apply only when the AI agent is deployed, and only after workflows and triggers have run. A provider failure no longer hands off. |
| Control words ran before a waiting workflow and used typo tolerance: "None" was read as *done* and cancelled the run, and a button titled "Agent" escalated. | A waiting run gets the reply first. Control words now need an exact match, and a word that is one of the offered options never counts as a control word. |
| "end", "quit", "cancel", "remove" and "no thanks" (including a tap on a "No thanks" button) opted the contact out permanently, even mid-flow. There was no way to opt back in. | Only STOP / UNSUBSCRIBE opt out, never a button tap. STOP during a flow first ends the flow. START / SUBSCRIBE opts back in. |
| Abandoned WhatsApp Form submissions never expired, so they swallowed every later message, even when the form was paused. | A submission is abandoned after 24 h or when its form is not Active. A matching workflow keyword breaks out of a stale form. |
| Captions on photos were ignored. Placeholder text like "[unsupported message: order]" could match keywords, and "[photo]" was saved as the answer to a question. | A caption counts as customer text. Placeholders never match keywords and never answer a waiting question. |
| "New Contact Welcome" fired only for numbers never seen before, so imported and campaign contacts were never welcomed. | It now fires on the contact's first inbound message. |
| A queue retry after the message was stored dropped the automation. | `Message.automationProcessedAt` lets a retry finish the automation without sending twice. |
| In production, webhooks were queued even when no process consumed the queue (`RUN_WORKERS=false` without a shared Redis). Nothing was ever processed. | `/health/ready` checks for a queue consumer. With none, webhooks are processed inline and a loud warning is logged at boot. |
| The `campaignAi` plan gate also disabled rule-based intents and intent → workflow routes on Free. | Only the LLM classifier and AI-agent replies need `campaignAi`. |
| Instagram catch-all Quickflows ran before waiting runs and workflows. | New order: waiting run, workflows, keyword Quickflows, … catch-all Quickflow last. |
| A suppressed trigger left no trace. | A CANCELLED run "Not run: <reason>" is recorded and shown as "Didn't run — <reason>". |

## Why a run failed or did nothing (engine)

| Finding | Fix |
|---|---|
| CRM-triggered workflows ran without a conversation. Every message/template/buttons step was "skipped" and the run showed COMPLETED. Message-triggered runs had no lead. | CRM runs use the contact's WhatsApp chat, or open one on the workspace number. Message runs carry the contact's lead. |
| Customer-facing steps that could not run counted as success. A reply timeout showed COMPLETED. | Those steps are now `failed` and the run ends FAILED. A timeout ends CANCELLED with its reason. A workspace notification is sent at most once per workflow per day. |
| Every send failure was reported as "Meta rejected / 24-hour window closed". | The real reason is recorded: quota and wallet empty, opted out, window closed, no number, subscription inactive, or Meta's own error. The first credit refusal notifies the workspace. |
| Template steps filled `{{2}}`+ with Meta's approval **sample values**, so customers received e.g. "ORD-12345". | Template steps map each placeholder to a value (`params`). A missing value fails the step and is never filled with a sample value. |
| A template send that failed while building its payload still used up the credit. | The credit is released. |
| Re-sending the keyword started a parallel run of the same workflow. | One active run per workflow per conversation. |
| No timeout on Meta calls. A hung send outlived the run lease and was sent again (duplicate OTP). | `META_HTTP_TIMEOUT_MS` (30 s), plus a lease renewal and an in-flight marker before each send. |
| A reply could skip a delay. Runs parked before `resumeAt` existed never resumed. | Guarded, and backfilled by a migration. |
| Button titles that collided after the 20-character cut became identical buttons. | Rejected at save, and made unique at send. |
| A message whose text equalled a template name was sent as a paid template. | That runtime switch is removed; saving warns instead. |
| The keyword winner depended on the length of the whole keyword list, and the oldest workflow won ties. | The longest *matched* keyword wins, then the most recently updated workflow. Saving warns about overlapping keywords. |
| Templates with a VIDEO or DOCUMENT header could not be sent. | Video and document header parameters are built at send time. |
| "Test this workflow" did not behave like production. | It reports inactive workflows, which workflow would actually win, conditions evaluated against a chosen contact, and steps that would fail. It tests the unsaved draft. |

## Builder (Automation screen)

- Run counts covered only the latest 20 runs **across the workspace**, so a working workflow could show "0 runs". Each card now shows its own all-time count and last run, with paged history.
- Run history now updates live, through a `workflow.run` event or a 30 s fallback poll.
- New template picker that shows approval status, with an input for each `{{n}}` placeholder.
- Hints for step combinations that cannot reach the customer.
- Warnings from the server are shown after saving.
- "Immediate" delay accepted.
- Steps can be inserted and reordered.
- Step numbers match the server's error messages.
- Custom lead and deal stages can be selected.
- Run history is visible to viewers and agents.
- Help text corrected, plus a "Why didn't my workflow run?" guide.

## Sequences, CRM events and scheduling

- **Sequences:** messages after a wait of 24 h or more could never be delivered, and failed the whole enrollment.
  - New TEMPLATE step.
  - A closed window skips only that step.
  - No credit pauses the enrollment and retries.
  - Problems send a notification.
  - The default wait is now 23 h.
- **Instagram:** a sequence wrote a WhatsApp number onto an Instagram thread. Instagram contacts are now skipped, and sends use the WhatsApp chat only.
- **CRM events:**
  - Score triggers missed customer replies and fired for every imported lead; fixed.
  - Status changes made by workflows and sequences now trigger workflows, stopping after 3 chained levels.
  - Creating a deal fires a stage event.
- **Bulk edits** launched one workflow lookup per lead and dropped automations under load. Lookups are now batched, with at most 3 running at once.
- **Lost Redis data** also removed the recovery sweeps. A watchdog re-adds them every 5 minutes.
- **`contact.created` webhooks** are now sent from every creation path, except voice calls (they upsert, so a new contact can't be told apart).

## Verification

- Backend: 1300 tests, 0 failures (153 need a real database and are skipped offline).
- Frontend: 52 tests pass and the production build succeeds.
- The engine audit's original repro tests were run against the merged code. 12/16 pass. The 4 that don't are by design:
  - Two control-word cases call the word detector without the waiting-run context. The real pipeline covers both: `inboundGate.test.js` "a waiting workflow gets "Complete" …" and the button "Agent" test.
  - Collected answers reach a template through explicit `params`, not by guessing.
  - Identical clipped button titles are refused at save.
- Not exercised against live Meta, Redis or Postgres.

## For the owner

- **Check the live configuration.** Confirm `RUN_WORKERS` and `REDIS_URL` on both stacks, and where Meta's webhook points. A web process with no queue consumer now reports not-ready, which can fail a deploy health check.
- **Template steps need values.** Existing workflow template steps whose templates have `{{2}}`+ placeholders now need values mapped in the builder, otherwise the step fails rather than sending sample data.
- **Inbox template sends still use sample values.** InboxView sends no variables. This is a separate follow-up.
- **Runs that used to "complete" silently will now show FAILED.** That is the point of the fix.
- **Product decision left open:** a campaign larger than the remaining quota uses all of it until it settles, so automated replies then draw on the wallet.
