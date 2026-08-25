# Spandan — QA Testing Guide

What was fixed, how to verify it, and who should take which part.

Branch under test: **`high-priority-issues-fix`** · 17 commits · 11 migrations.

Two things to know before you start:

1. **337 assertions already run automatically.** Most of what was fixed is covered by seven live suites. Don't hand-test what a suite already proves — run the suite, then spend your time on the manual sections, which is where the real risk sits.
2. **This build is NOT approved for release.** Two High-priority areas have no test coverage at all (§W5). The suites passing does not change that. Absence of failures in an untested area is not evidence.

---

## Setup (everyone, once)

```bash
# 1. Install and generate the client
cd backend && npm install && npx prisma generate

# 2. Apply migrations — 11 are pending on a fresh database
npx prisma migrate deploy

# 3. Start the server (leave running in its own terminal)
npm run dev

# 4. Frontend, in a second terminal
cd ../frontend && npm install && npm run dev
```

Confirm the server is healthy before testing anything: `curl http://localhost:4000/api/v1/health`

**The suites need a real environment.** They run against a live database and the real Meta Graph API — no mocks. That is deliberate: a campaign path verified against mocks proves nothing about the thing that bills a customer. Consequences:

- `campaign-check` **spends real wallet money** (a few rupees) and **sends real WhatsApp messages**. Run it against staging, never production.
- Suites need a workspace with a connected, reachable WhatsApp number and at least one APPROVED template.
- **Run them one at a time**, not in parallel. Six back-to-back runs exhausted the Postgres pooler and produced connection errors that look like failures but aren't.

---

## Running the automated suites

```bash
cd backend
node --env-file=.env scripts/auth-check.mjs         # 87 assertions
node --env-file=.env scripts/campaign-check.mjs     # 68  ← spends money
node --env-file=.env scripts/regression-check.mjs   # 45
node --env-file=.env scripts/messaging-check.mjs    # 40
node --env-file=.env scripts/ai-flow-check.mjs      # 40  ← costs model calls
node --env-file=.env scripts/addon-check.mjs        # 29
node --env-file=.env scripts/waba-check.mjs         # 28
node scripts/template-payload-check.mjs             # 39  ← no server, no DB, free
```

The last one needs neither the server nor the database: it builds the Meta
payload for every template type and asserts its shape, so a carousel or catalog
regression is caught without spending anything or messaging anyone.

Each prints `N passed, M failed` and exits non-zero on failure.

**If a suite fails, read the failure before reporting it.** A `PrismaClientInitializationError` is a connection problem, not a product bug. A timeout usually means the server isn't running. Report the assertion name and the `<-` detail that follows it.

**Do not "fix" a failing suite by weakening its assertion.** If you think an assertion is wrong, raise it — several assertions here exist specifically because an earlier, looser version passed while the bug was live.

---

# Workstream assignments

Six independent blocks. W1–W4 are mostly "run the suite, then spot-check the UI". W5 and W6 are where the genuine unknowns are — **assign your strongest testers there.**

---

## W1 — Authentication & access control

**Automated:** `auth-check.mjs` (87) + `regression-check.mjs` (45)

### Fixed here

| Issue | What was wrong |
|---|---|
| Brute-force bypass | The login limiter keyed on `X-Forwarded-For`, which the client controls. Rotating it reset the counter — 30/30 attempts succeeded |
| Logout didn't end the session | Only the refresh token was revoked; the access token kept working until natural expiry |
| Roles not enforced | Agent and Viewer roles added, enforced centrally in `workspaceContext` |

### Manual checks

1. **Brute force.** Submit a wrong password 12 times. Expect a lockout at 10. Now repeat while changing the `X-Forwarded-For` header each time — **expect it to still lock out**. Historically it did not.
2. **Logout.** Sign in, copy the access token from devtools, sign out, then replay a request with that token. Expect **401**. Previously it succeeded.
3. **Roles.** Sign in as a Viewer. Expect: can read, cannot write. As an Agent: can write contacts, cannot create campaigns. As a Member: cannot spend from the wallet.
4. **IDOR.** Take a resource id from workspace A and request it while signed into workspace B. Expect 403/404, never the record.

### Known limitation
**OTP email delivery cannot be tested** — SMTP credentials are invalid (`535-5.7.8 BadCredentials`). OTP *generation and verification* are covered; delivery is not. Mark as blocked, not failed.

---

## W2 — WhatsApp messaging & WABA

**Automated:** `messaging-check.mjs` (40) + `waba-check.mjs` (28)

### Fixed here

| Issue | What was wrong |
|---|---|
| Duplicate messages | Production held messages stored **four times** — Meta redelivers, nothing was idempotent |
| Cross-tenant leak | One WhatsApp number was claimable by two workspaces |
| Phone format | Recipients were unnormalised on three send paths — 136 of 159 live contacts stored with `+` |
| 24-hour window | Free-form sends outside the window now refused *before* any charge |

### Manual checks

1. **Send and receive** a text from a real device. Confirm it appears in the inbox once, not twice.
2. **Media** — send an image, a document and a location inbound. Confirm caption, filename and coordinates all survive.
3. **Delivery ticks** — confirm sent → delivered → read progress in the inbox, and that a **late delivery receipt never downgrades a read**.
4. **24-hour rule** — find a thread with no inbound message in 24h. Expect free-form send refused with a clear reason, and the template picker offered instead.
5. **Opt-out** — reply `STOP` from a test device. Expect no further automated messages of any kind.

### Priority spot-check
**Outbound media is not asserted by any suite** — only the refusal path is. Please test sending an image, document and video from the inbox properly.

---

## W3 — Campaigns & contacts

**Automated:** `campaign-check.mjs` (68) — ⚠️ spends real money

### Fixed here

| Issue | What was wrong |
|---|---|
| Duplicate sends | `RUNNING` was claimable, so two job deliveries both iterated the same PENDING recipients |
| Rejected templates sendable | Only `DELETED` was checked — a REJECTED template could go to a whole audience *after* the wallet was charged |
| Audience could only grow | Deselecting a contact in a reopened draft still messaged them |
| No pause | Cancelling was the only way to stop a campaign, and it's irreversible |
| Carousel failed for every recipient | Meta `100`. A card's *static* link button was sent an empty `text` parameter — that parameter only exists for a URL ending in `{{n}}`, and a static one has nothing to substitute |
| Catalog failed for every recipient | Meta `131008`. Nothing about a catalog button is chosen per send, so `components` was omitted entirely — Meta still requires the button to be addressed |
| Sync erased carousel images | Meta's components were taken verbatim, and Meta has never seen the stored-image reference each card carries. Every sync wiped it, so a working carousel lost its pictures and then failed with "no stored media" |

### Manual checks

1. **Full wizard** — build a campaign end to end in the UI. Confirm the cost shown before launch is the amount actually deducted.
2. **Opt-out protection** (highest priority): put an opted-out contact in the audience. Expect it flagged before launch, marked SKIPPED at launch, never sent to, never billed.
3. **Pause mid-flight** on a large audience. Expect it to stop within roughly one message.
4. **Cancel** a running campaign. Expect exactly one refund of the unsent balance.
5. **Statistics** — confirm the campaign report's sent/failed/skipped counts match the recipient rows.
6. **Carousel** — send `carousel_testing`. Expect both cards, both images, both bodies, `View offer` on each, and sent → delivered → read with failed=0. Meta `100` must not appear.
7. **Template sync twice** — open a carousel in the editor and note its card images. Run a sync, reopen: the images, card text, buttons, URLs and card order must all still be there. Run it a second time and confirm nothing else drifts. This is the regression that used to erase them.

### ⚠️ Catalog needs a Meta setting — do not log as a bug
The `131008` failure **is fixed**; the payload is now accepted. What replaces it is Meta `131009`: this business account has no product catalog behind the button. Verified directly against Meta — both `whatsapp_commerce_settings` and the WABA's `product_catalogs` come back empty.

A catalog template cannot deliver until someone creates a catalog in Commerce Manager, connects it to the WABA, and enables it under WhatsApp Manager → Commerce Settings. No code change and no new environment variable will move this. Once it is connected, retry `qa_catalog_test_01` and report what Meta answers.

### Untested — please cover manually
Contact **import** (CSV) and **segmentation**. Segments are currently static membership with no criteria model, and overlap with a second concept (Cluster). Report what you find; this is a design gap, not just a bug.

---

## W4 — AI, flows, widget & handoff

**Automated:** `ai-flow-check.mjs` (40) — costs a handful of model calls

### Fixed here

| Issue | What was wrong |
|---|---|
| Branches never worked | The engine tested `node.subtype`, but a condition is `{ type: 'condition', subtype: 'contains' }`. Every condition fell through and guarded nothing — **both sides of every branch always ran** |
| Bot talked over the human | Nothing stopped automation after a handoff |
| Intermittent AI failures | `gemini-flash-latest` returns 503 under load ~2 calls in 5. Now retries with a fallback model |

### Manual checks

1. **Build a branching flow** in the builder. Send a message that satisfies the condition and one that doesn't. Confirm the guarded steps run only when they should, and that later steps still run either way.
2. **Variables** — use `{{name}}` and `{{custom.field}}`. Confirm they resolve, and that an *unknown* token is removed rather than sent literally. A customer must never receive `{{order_id}}`.
3. **Handoff** — trigger an escalation, then send another inbound message. **The bot must stay silent.** Switch the bot back on and confirm automation resumes.
4. **Buttons** — build an "Ask with buttons" step (`Question | Option A | Option B`). Confirm buttons render on a real device and that tapping one drives the flow.
5. **Widget** — embed on a test page. Confirm it loads, answers, and that the config exposes no token. Check an unauthorised domain is refused.

---

## W5 — ⚠️ API keys & webhooks — NO AUTOMATED COVERAGE

**This is the highest-risk block. Assign an experienced tester. Nothing here is proven.**

Code inspection says these are implemented correctly. Code inspection is not evidence — that's precisely why this block exists.

### API keys — test every step

1. **Generate** a key. Confirm the secret is shown **exactly once** and never again.
2. **Storage** — check the `ApiKey` row directly. Expect only `keyHash` (SHA-256) and `keyPrefix`. **If the raw key is recoverable from the database, stop and escalate immediately.**
3. **Masking** — confirm the list endpoint never returns the full key.
4. **Use** the key against the public API. Confirm it authenticates.
5. **Scopes** — mint a read-only key and try to launch a campaign with it. Expect refusal. (Previously *every* key was handed role `ADMIN`.)
6. **Revoke**, then reuse the key. Expect **401**.
7. **Regenerate**, then use the *old* key. Expect **401**.
8. **Rate limiting** — hammer an endpoint with a valid key and confirm throttling.

### Webhooks

**Incoming is covered** by the suites (verification, signature, duplicates). **Outgoing is not.**

1. Point an outgoing webhook at a request-bin URL.
2. Trigger each of the 7 event types.
3. Verify the **HMAC signature** on the receiving end.
4. Take the receiver **offline** and confirm the retry ladder fires: 0s, 2s, 10s, 60s, 300s.
5. Confirm a duplicate delivery is not processed twice.

---

## W6 — UI/UX across devices — NO AUTOMATED COVERAGE

There is no browser automation in this project. Everything here is manual.

### Fixed here
Add Money button (it dispatched a navigation to the page it was already on, and the router returns early when the URL is unchanged) · back arrow · sidebar reachability · browser title/branding · responsive pass.

### Test on desktop, tablet and mobile

For each of: **sidebar, modals, forms, tables, chat, campaigns, templates, payments** —

- [ ] No horizontal overflow (the page body must never scroll sideways)
- [ ] No clipped text
- [ ] No overlapping elements
- [ ] Loading, empty and error states all render

### Reported but never reproduced — verify these first
Navigation for **Templates**, **API Keys**, **Campaign**, and the **Smart List arrow** was reported broken. It was never reproduced or fixed. Confirm whether each still misbehaves, and capture the exact URL and any console/network error — an API 401 and a broken route look identical from the outside but have completely different causes.

---

## Blocked — external dependencies

Do not log these as bugs. They need configuration, not code.

| Area | Blocker |
|---|---|
| OTP email | SMTP credentials invalid — needs a fresh App Password |
| Instagram | `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` not set. The "incorrect password" bug **is fixed** — it fell back to the Facebook app id, and Instagram rejects credentials for an unrecognised `client_id` |
| Meta Embedded Signup | `API_PUBLIC_URL` must be HTTPS; Meta refuses non-HTTPS redirect URIs |
| Webhook fields | App subscribed to `messages` only. Repair must run **from the deployed service** — production's verify token differs from local |
| Live payments | Razorpay live keys needed for a real end-to-end top-up |
| Catalog templates | No product catalog exists on the WABA. Needs one created in Commerce Manager, connected to the account, and enabled in WhatsApp Commerce Settings — see W3 |

---

## Reporting bugs

Include: **workstream ID · steps · expected · actual · severity · evidence** (assertion name, screenshot, or request/response).

Before filing, check the callouts above — the catalog template's remaining blocker is Meta configuration, not a defect, and the blocked items are already documented.

**Severity:** Critical = data loss, money, cross-tenant leak, or mass-messaging error · High = core feature broken with no workaround · Medium = broken with a workaround · Low = cosmetic.

---

