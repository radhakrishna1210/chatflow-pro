# Messaging audit (WhatsApp core, inbox, templates, opt-out, voice/Instagram webhooks)

I checked these end to end against the live API with signed Meta webhooks (`test-meta-secret`), and in the browser (Inbox, Number Setup, Templates).
Test data I seeded: a WaNumber `auditmsg_pnid_1` in the test workspace, plus the "Audit Customer" conversation created by simulated webhooks. The second tenant I created for the IDOR check has been deleted.

## Findings

| ID | Severity | Area | file:line | Problem (concrete failure scenario) | Status | Test added |
|---|---|---|---|---|---|---|
| M1 | Critical | Inbound webhook | services/inboundMessage.js:82 (parse) → webhook.service.js message.create | `parseInboundMessage` put `voice` inside `media`, and that object is spread into `prisma.message.create`. Message has no `voice` column, so Prisma threw "Unknown argument `voice`" and **every inbound image, video, audio, document and sticker was dropped** (reproduced live: STORE FAILED). | Fixed: `voice` is now returned on the parsed result instead of inside `media` | inboundMessage.test.js, webhookProcessing.test.js ("inbound media is stored"), voiceNoteSTT.test.js updated |
| M2 | Critical | Status webhook | services/webhook.service.js (handleStatusUpdate, auth-transaction guard) | `transactions[0]?.deliveredAt == null` was also true when there were no auth transactions, which is every ordinary message. `transactions[0].id` then threw, so **no delivered/read receipt was ever recorded** on inbox, automated or campaign messages, and campaign delivered/read counters never moved. | Fixed: guard is now `transactions.length === 1 && …` | webhookProcessing.test.js (out-of-order statuses) |
| M3 | Critical | Inbox media proxy (IDOR) | services/conversations.service.js getMessageMediaStream | The message was looked up by `{id, conversationId}` with no workspace filter. A member of workspace A could request `/workspaces/A/conversations/<B conv>/messages/<B msg>/media` and download tenant B's customer media, fetched with B's Meta token. | Fixed: scoped by `conversation.workspaceId` (live check: 404) | conversations.service.test.js |
| M4 | High | 24h window | services/conversations.service.js sendMessage/sendMediaMessage | Free-form sends were tried even outside the window. When Meta's API returned 200, the code stamped `lastInboundAt = now`. The Cloud API reports 131047 later, as an async `failed` status, so the 200 proved nothing. An agent could free-form message anyone, and the fake inbound timestamp opened the window for every automated reply too. | Fixed: window is checked before charging or sending (409 OUTSIDE_24H_WINDOW); `lastInboundAt` is only written by real inbound messages | conversations.service.test.js |
| M5 | High | 24h window bypass endpoints | conversations.routes.js:26-27, service reopenWindow/simulateInboundMessage | `POST /:id/reopen-window` and `/:id/inbound-simulate` let any member, AGENT included, fabricate an inbound message or window in production. simulate also accepted an arbitrary `mediaId`, which the media proxy resolves via Graph. | Fixed: both return 404 when NODE_ENV=production; simulate only takes TEXT/AUDIO and never stores a caller-supplied mediaId | conversations.service.test.js |
| M6 | High | Templates edit | services/templates.service.js updateTemplate | Editing an APPROVED or PENDING template only changed the local row and kept it APPROVED. Sends then used components Meta never approved (wrong variable count, header or buttons), so they failed or went out different from the preview. Editing a REJECTED template "resubmitted" through *create* under the same name, which Meta refuses as a duplicate; the error was swallowed and the row stayed PENDING forever. | Fixed: content edits go to Meta's edit endpoint (`POST /{template_id}`, new `editMetaTemplate`), or to create for never-submitted drafts. The row changes only if Meta accepts, then goes to PENDING with `rejectedReason` cleared. Changing name or language of a submitted template, or the category of an approved one, returns 409 with a clear message. Meta errors are shown to the user. UI: name and language are locked for submitted templates. | templates.update.test.js |
| M7 | Medium | SSRF | services/templateImage.service.js adoptMediaFromHandle | `header_handle` is template JSON that a client can write. Any `http(s)` URL was fetched server-side, including internal hosts and cloud metadata, with redirects followed. | Fixed: https on Meta CDN hosts only (`isMetaCdnUrl`), redirects off Meta hosts refused, size capped | webhook.controller.test.js (isMetaCdnUrl) |
| M8 | Medium | Token leak / SSRF | lib/meta.js downloadMediaBuffer | The download URL returned by Graph was fetched with `Authorization: Bearer <token>` (the system-user token as fallback) wherever it pointed, and redirects were followed. Meta's own 401/403 was passed through as our status code; the client treats a 401 as "session ended", so an expired WA token **signed the user out**. | Fixed: Meta host allowlist plus a redirect guard; media id is URL-encoded; upstream failures always return 502 | same |
| M9 | Medium | Media proxy XSS / sniffing (semgrep direct-response-write, conversations.controller.js:137) | controllers/conversations.controller.js streamMedia; templates.controller.js:63 headerImage | The customer-declared MIME type was echoed as Content-Type, so a `text/html` or SVG "document" would render inline on the API origin. | Fixed: only image/audio/video types are served inline; everything else is `application/octet-stream` + `attachment`; `CSP: default-src 'none'; sandbox`, `no-store`. Template asset route: image types only. | — (header logic is a small pure function, `safeMediaHeaders`) |
| M10 | Medium | Webhook robustness | services/webhook.service.js processWebhook | The handlers ran in sequence with no isolation, after the 200 was already sent. One message that threw (for example a missing `from`) aborted every message and status after it in the same delivery, and Meta never redelivers those. `value.errors` was ignored. | Fixed: each item is isolated and logged; top-level `errors` are logged | webhookProcessing.test.js |
| M11 | Medium | 24h window | webhook.service.js conversation update | `lastInboundAt = sentAt` could move backwards when a delayed older message arrived after newer ones, closing the window early. | Fixed: a conditional updateMany only ever moves it forward | webhookProcessing.test.js |
| M12 | Medium | Template status | webhook.service.js handleTemplateStatusUpdate | Meta's rejection `reason` was dropped, so templates rejected by webhook showed no reason. A late APPROVED for a template deleted here brought it back. | Fixed: reason stored on REJECTED and cleared on APPROVED; DELETED rows are never updated by status events | webhookProcessing.test.js |
| M13 | Medium | Opt-out (unblock) | routes/optout.routes.js | Any AGENT could unblock a number that had sent STOP (roleCapabilities allows `/blocked-numbers` writes), against the route's own "only admins change the list" rule. | Fixed: unblock routes require `authorize('CLIENT')`; agents can still block | — |
| M14 | Medium | Opt-out (SMS/email fallback) | services/fallback.service.js | When a campaign message failed (often 131050: the user stopped marketing messages), the SMS/email fallback still contacted people on the opt-out list. The contact name went into email HTML unescaped. | Fixed: fallback is skipped for opted-out contacts (OptOut row or `contact.optedOut`); HTML is escaped | fallback.service.test.js |
| M15 | Medium | Phone normalization | webhook.service.js contact lookup | A contact imported in national format ("9876543210" / "09876543210") never matched Meta's "919876543210", because the fuzzy step still required exact equality. Each such customer became a duplicate contact with split history. | Fixed: a national 10-digit match is accepted only when exactly one candidate matches | webhookProcessing.test.js |
| M16 | Medium | Inbox (frontend) | pages/InboxView.jsx | (a) `<audio src=/api/...>` sends no bearer token, so every voice note got a 401 and never played; images and documents had no viewer or download at all. (b) Only the first 20 conversations ever loaded, and search ran client-side over those 20, so older threads were unreachable. (c) `Avatar` crashed the whole inbox on a contact with `name: null`. (d) The "Quick Reply" button had no handler. (e) At 1400–1600px the composer input pushed the Send button off-screen. (f) Failed assign/status/note actions failed silently. | Fixed: `MessageMedia` fetches through `wFetch` into a blob (image/audio auto, video/document on click); search runs server-side (debounced), with "Load more" up to 200 and a loading state; the open thread stays put while searching; null-safe avatar; dead button removed; `minWidth:0`; action errors shown | Verified in browser (Playwright) |
| M17 | Low | Webhook verify | controllers/webhook.controller.js, instagram.controller.js | `hub.challenge` was reflected with Express's default `text/html`, so anyone holding the verify token could get a script reflected on the API origin. Token compared with `===`. A missing or non-JSON body made `createHmac.update(undefined)` throw a 500. rawBody was decoded and re-encoded as a string before the HMAC. | Fixed: shared `answerChallenge` (text/plain, constant-time) and `checkMetaSignature`; rawBody kept as the raw Buffer (app.js, one-line change) | webhook.controller.test.js |
| M18 | Low | Inbox send validation | conversations.service.js sendMessage | Empty or whitespace bodies, and bodies over 4096 chars, consumed a credit and went to Meta. | Fixed: 400 before anything else | conversations.service.test.js |
| M19 | Low | Opt-out (inbox) | conversations.service.js | `Contact.optedOut` (set from the Contacts screen) was not honoured by inbox text, media or template sends; only the OptOut list was checked. | Fixed: `assertContactReachable` | conversations.service.test.js |
| M20 | Low | Assignment IDOR | conversations.service.js assignConversation | A thread could be assigned to any user id, including one in another tenant, and that user's name came back in the response. | Fixed: must be a workspace member (400) | conversations.service.test.js |
| M21 | Low | Inbox list | conversations.service.js listConversations | `?limit=` was unbounded, so one request could pull the whole inbox with contacts and messages. | Fixed: limit clamped to 1–200, page ≥ 1 | conversations.service.test.js |
| M22 | Low | STT cost on redelivery | webhook.service.js | A redelivered voice note was transcribed again before the dedupe check. | Fixed: cheap metaMessageId pre-check before STT | voiceNoteInbound.test.js stubs updated |
| M23 | Low | Inbound edge cases | webhook.service.js / inboundMessage.js | A missing or garbled timestamp gave an Invalid Date, so the message was lost. Reactions were stored as "[unsupported message: reaction]". A resolved or closed thread was not reopened when the customer wrote again, so it sat unread under "resolved". | Fixed: arrival-time fallback; "[reacted 👍]"; status goes back to OPEN | inboundMessage.test.js, webhookProcessing.test.js |
| M24 | Low | Templates misc | templates.service.js duplicateTemplate; lib/templateHelpers.js | A duplicate of a 60+ character name exceeded Meta's 64-char limit. The DELETED status label was shown raw. | Fixed | — |
| M25 | Low | Number Setup (frontend) | pages/NumberSetupView.jsx | Only the primary number could be disconnected (the cards for other numbers had no action). After a disconnect the list still showed the removed number, and errors appeared as raw JSON. | Fixed: per-card Disconnect, list reloads, error message shown | Verified in browser |
| M26 | Low | Webhook GET verify | controllers/webhook.controller.js | — Verify token cannot be bypassed when unset: env requires it (min 1), and the helper now refuses an empty expected token. | OK (hardened) | webhook.controller.test.js |

### Checked, no issue
- POST signature: enforced and cannot be bypassed (`META_APP_SECRET` is required by env schema); now timing-safe over raw bytes.
- Idempotency on `metaMessageId` (unique constraint + P2002 handling) works. Verified a live duplicate delivery is stored once.
- Unknown `phone_number_id` is dropped. Routing is unambiguous because `metaPhoneNumberId` is globally unique.
- Status regression guard (read before delivered) works now that M2 is fixed.
- Twilio voice signature validation (`twilio.validateRequest` over the public URL) is correct, and TwiML output is XML-escaped.
- Instagram tokens are stored encrypted; the OAuth state is a random UUID in Redis, single-use, with a 10-minute TTL.
- Opt-out is honoured by `sendAutomatedReply` (all automation), inbox text/media/template, public API, and campaigns (partitionByOptOut).
- Upload guard: declared-type allowlist plus magic-byte check, memory storage, size limits, no path handling, so no traversal.

## Not fixed / outside my scope (for other owners)
- **CRM Sales Inbox** (`frontend/src/pages/CrmSalesInboxView.jsx:448-480, 1021-1042`) shows "Sync window" and "Simulate inbound" buttons that call the endpoints now disabled in production (they become no-ops there). They should be removed or hidden outside dev. The error text there also tells users to "sync the window", which is no longer possible. (CRM owner)
- **Public API `sendPublicMessage`** (`services/whatsapp.service.js:595`): consumes no message credit, does not record the send in the inbox, has no 24h-window check for `type: text`, and does not check that a stored template is APPROVED. (Billing/API owner; I left the billing semantics alone.)
- **Instagram OAuth CSRF:** the `state` is tied to the workspace but not to the browser or user that started the flow. An attacker can send a victim their own auth URL and the victim's IG account gets linked into the attacker's workspace. A fix needs a cookie-bound nonce on the callback. (Auth owner)
- The role comment in `routes/whatsapp.routes.js` ("connecting/onboarding stay admin-only") is not enforced: CLIENT can onboard from the pool or connect a number. `authorize.js` documents CLIENT as allowed to manage numbers, so I left it; flagging the contradiction. (RBAC owner)
- `sendTemplateMessage` fills missing template variables with the literal "there" ("your price is there"). This is a product decision; it should probably reject or ask instead.
- Outbound to contacts stored as a bare national number ("9876543210") goes to Meta without a country code and fails. The inbound side is now matched (M15), but outbound needs a workspace default country code. (Contacts owner)
- Full-suite failures `invitations.service.test.js` ("a link capped at 2 uses…", "signup through a capped link…") come from another auditor's in-progress invitations work, not from messaging.

## Files changed
Backend:
- src/services/inboundMessage.js
- src/services/webhook.service.js
- src/services/conversations.service.js
- src/services/templates.service.js
- src/services/templateImage.service.js
- src/services/fallback.service.js
- src/lib/meta.js
- src/controllers/webhook.controller.js
- src/controllers/instagram.controller.js
- src/controllers/conversations.controller.js
- src/controllers/templates.controller.js
- src/routes/optout.routes.js
- src/app.js (one line: rawBody Buffer)

Tests:
- new: src/services/inboundMessage.test.js, src/controllers/webhook.controller.test.js, src/services/webhookProcessing.test.js, src/services/templates.update.test.js, src/services/fallback.service.test.js
- extended: src/services/conversations.service.test.js
- stubs updated: src/services/voiceNoteInbound.test.js, src/services/voiceNoteSTT.test.js

Frontend:
- src/pages/InboxView.jsx
- src/pages/NumberSetupView.jsx
- src/components/TemplateModal.jsx
- src/lib/templateHelpers.js

## Test results
- Scope tests: 49/49 pass.
- Full `npm test`: 534/536 pass. The 2 failures are in invitations.service.test.js (not my scope).
- `npx vite build`: OK.
