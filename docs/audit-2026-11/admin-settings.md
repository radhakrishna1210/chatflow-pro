# Audit: admin-settings (platform admin, workspace settings, integrations, support, email)

How I verified it: I called every `/admin/*` route three ways: with no token (401), as a workspace ADMIN (403), and as a workspace ADMIN whose JWT was forged to carry `superAdmin: true` (403, because requireSuperAdmin checks the email in the database). I also called the settings, integrations and support routes as VIEWER, as CLIENT, and as an admin of a different workspace. Playwright crawled Settings, Integrations, Support, Customize Business, Legal and all 13 Super Admin sections at 1366 px and 390 px, checking for console errors, 5xx responses and horizontal overflow. It also ran these flows: a notification toggle persists after reload; Lead Capture appears on the Team tab only; Razorpay connect, then reload, then disconnect behind a confirm with a banner; the Zapier modal; a support ticket containing HTML (rendered escaped); and API Management save, mask, clear override and audit entry. The only 5xx responses seen were transient: the Vite proxy returned 500 while node --watch restarted the API after other auditors' edits. The same endpoints returned 200 when called again.

| ID | Severity | Area | file:line | Problem (concrete failure scenario) | Status | Test added |
|---|---|---|---|---|---|---|
| AS-1 | High | Email | backend/src/services/email.service.js (campaignCompleted/Failed, templateApproved/Rejected, apiKeyCreated) | `campaignName`, `templateName`, `recipientName`, `userName`, `keyName`, `environment` and `keyPrefix` were put into HTML emails without escaping. A member who names a campaign or template `<a href=evil>…` or `<img src=x onerror=…>` gets that markup into the inbox of every member of the workspace. Only the welcome, invite and OTP templates escaped their values. | Fixed: everything now goes through `esc()`, and so does the `btn()` href | email.service.test.js |
| AS-2 | Medium | Email | email.service.js:319 (semgrep unsafe-dynamic-method) | `BUILDERS[type]` with a queue-supplied `type` resolved `constructor`, `toString` and similar names to Object.prototype functions and ran them as templates. | Fixed: own-property lookup with `Object.hasOwn` | yes |
| AS-3 | Medium | Email | email.service.js (6 builders) | The "Go to Dashboard", "Sign in", "Edit Template" and "Manage API Keys" buttons linked to `env.APP_URL`, which is the backend API base, or to `#` when APP_URL is unset. Every one of those links was broken. A missing campaign counter also threw inside the worker, so the summary email was never sent. | Fixed: links use `CLIENT_URL`; counters default to 0 | yes |
| AS-4 | High | Settings | backend/src/validators/index.js `settingsSchemas.update` | `autoLeadFromReply` is on the service allow-list but was missing from the zod schema. Zod strips unknown keys, so the Settings → Lead Capture toggle switched on in the UI, saved nothing, and was off again after reload. Lead capture from campaign replies could never be turned on. | Fixed | settings.service.test.js |
| AS-5 | Medium | Platform settings | backend/src/services/platformSettings.service.js | Secrets were sent to the browser as the first 4 and last 4 characters (`test...cret`). For a 13-character secret that is about two thirds of the value. `looksMasked` only matched the current mask, so a stale preview (another admin had rotated the key since the page loaded) or an edit typed onto the end of the mask was saved literally over a working key. | Fixed: the mask is now `********` plus the last 4 characters, and only for secrets of 16+ characters (shorter ones are fully masked). Any mask shape, current or stale, counts as "unchanged". A value typed onto the mask gets a 400. UI: secret inputs start empty with the mask as placeholder, emptying a field you started typing in is a no-op, and there is an explicit "Clear override" button | platformSettings.service.test.js |
| AS-6 | Medium | Admin audit | backend/src/middleware/authorize.js `requireSuperAdmin` | The access token carries no email, and `actorOf(req)` reads `req.user.email`, so every audit row recorded the actor as **"unknown"**. | Fixed: requireSuperAdmin sets `req.user.email` from the DB row it already loads | verified in browser (audit shows admin@example.com) |
| AS-7 | Medium | Admin audit | backend/src/controllers/admin.controller.js | These actions were not audited: rotating platform credentials, reset-all-numbers (disconnects every workspace's number), reset/unban/add number, cross-workspace invite, invite link, invite revoke. | Fixed: all are now audited (key names only, never values) | — |
| AS-8 | Medium | Admin | admin.controller.js `suspendWorkspace` | `suspended` was never type-checked. `{"suspended":"false"}` became `!!"false"`, so a request meant to reinstate a workspace suspended it instead. | Fixed: must be a boolean, otherwise 400 (verified via API) | — |
| AS-9 | Medium | Admin | admin.controller.js getPool/addNumber/ban/unban/reset/verifyOtp | Number-pool responses included `encryptedAccessToken`, the ciphertext of each number's Meta token, in the browser. Anyone who later obtains ENCRYPTION_KEY could decrypt it. `addNumber` with no token caused a 500 from `encrypt(undefined)`. | Fixed: responses return `hasAccessToken` instead; addNumber validates phoneNumber and accessToken | — |
| AS-10 | Low | Admin | admin.controller.js transactions/payments, updateTicket | `?from=garbage` produced an Invalid Date, which Prisma rejected as a 500. Ticket `adminNote` was untyped and had no length limit, and `status` was not validated. | Fixed: 400s | — |
| AS-11 | Medium | Integrations | backend/src/services/integrations.service.js | No input validation on connect. The provider id was any string; `credentials` and `config` were unbounded, untyped JSON (`config` is sent back on every page load). An `apikey` connection with no credentials was stored as CONNECTED. A manual `type:'oauth'` POST, which the UI sends for providers not wired yet, was stored as **CONNECTED** with no token, so the card claimed a live Zoho/Salesforce link. The same POST against a real OAuth row nulled `encryptedCredentials`, which silently destroyed the grant. | Fixed: shape and size checks; manual oauth rows are `PENDING` and never overwrite a real grant; the UI shows "request recorded" and treats PENDING as not connected | integrations.service.test.js |
| AS-12 | High (functional) | Integrations UI | frontend/src/pages/IntegrationsView.jsx `webhookUrl` | The Zapier, Make and Pabbly modals told users to paste `/api/v1/webhook/integration/<ws>/<id>`, a route that does not exist (404). The hints also described the wrong direction ("Catch Hook trigger"). | Fixed: the modal now points to the real public API `POST /api/v1/public/contacts` with `x-api-key` (`contacts:write`), plus corrected instructions | browser-verified |
| AS-13 | Medium | Integrations UI | IntegrationsView.jsx `connectionKey` | Shopify Sales/Marketing are API-key connections but were looked up under the OAuth id `shopify`. A successful save therefore showed "not connected", and Disconnect called DELETE on a row that doesn't exist. | Fixed | — |
| AS-14 | Low | Integrations UI | IntegrationsView.jsx:809 (semgrep open-redirect) | `window.location.href = data.url` would follow any scheme the response carried. | Fixed: navigation only to `https:` URLs, otherwise an error is shown | — |
| AS-15 | Low | Integrations UI | IntegrationsView.jsx handleDisconnect | Disconnect deleted stored credentials without a confirmation, and errors were swallowed. | Fixed: confirm, success banner, error banner | browser-verified |
| AS-16 | Info | Integrations UI | IntegrationsView.jsx:213 (semgrep Stripe token) | `sk_live_xxxxxxxxxxxx` / `whsec_xxxxxxxxxxxx` are input placeholders, not secrets. | No change needed | — |
| AS-17 | Medium | Integration health | backend/src/services/integrationHealth.service.js, components/CrmIntegrationHealthModal.jsx | Fake data. Meta Graph was hardcoded HEALTHY with an invented 42 ms latency, the wrong API version and "99.98% uptime". The WhatsApp webhook showed ACTIVE for any connected number. Google Sheets looked up the catalogue id `google-sheets`, but the real OAuth grant is stored under `google`, so it was always shown as disconnected; when connected it claimed a "bidirectional sync" that doesn't exist. | Fixed: health is reported from real state (whether the token is configured, `appSubscribed`, the provider id); the fake numbers are removed | integrationHealth.service.test.js updated |
| AS-18 | Low | Support | backend/src/services/support.service.js | A non-string subject or message hit `.trim()` and caused a 500. `category` was stored verbatim with any type and any length. | Fixed: type checks plus a category allow-list | support.service.test.js |
| AS-19 | Medium | Onboarding (non-AI) | backend/src/controllers/onboarding.controller.js chatWithAi | The route is not behind workspaceContext, so a **suspended** workspace, or one with a CANCELLED/EXPIRED subscription, could still create templates and campaigns through the chat. A non-string message caused a 500. | Fixed | API smoke-tested |
| AS-20 | Low | Notifications | backend/src/services/notification.service.js markRead | When the session had no workspaceId, any user could create read markers on any workspace's broadcast notifications. | Fixed: a workspaceId match is required | — |
| AS-21 | Low | Settings | backend/src/controllers/settings.controller.js:28 (semgrep direct-response-write) | The invoice HTML is fully escaped and served as an attachment, so this is a false positive. | Hardened: `CSP: sandbox` and `nosniff` headers on the download | settings.service.test.js (escaping) |
| AS-22 | Low | Settings UI | frontend/src/pages/SettingsView.jsx | The Lead Capture and Teams cards appeared on every tab (Billing, Security…). Save Preferences failures showed nothing. The toggles were clickable divs with no role or keyboard support. | Fixed: both cards are on the Team tab only; errors are shown; toggles have `role="switch"`, aria-checked and Space/Enter | browser-verified |
| AS-23 | Low | Customize Business UI | frontend/src/pages/CustomizeBusinessView.jsx requestDelete | The "is this option in use?" check **failed open**: on a network error or non-OK response it went ahead and deleted the option. | Fixed: it fails closed and shows a warning | — |
| AS-24 | Low | Custom fields UI | frontend/src/components/CustomFields.jsx | Removing a field ran without a confirmation. | Fixed: confirm | — |
| AS-25 | Low | Super admin UI | frontend/src/pages/SuperAdminView.jsx impersonate | The server records an impersonation reason, but the UI never sent one. | Fixed: a prompt asks for the reason and sends it | — |

Checked and found OK:
- Every `/admin` route requires authentication plus a DB-verified super admin.
- Impersonation refuses to impersonate the platform admin and issues a non-superAdmin token.
- Settings PATCH is allow-listed: `plan`, `walletBalance`, `suspended` and `webhookVerifyToken` are dropped.
- Cross-workspace settings, integration and support access returns 403.
- VIEWER cannot write.
- `webhookVerifyToken` is hidden from VIEWER and AGENT.
- Integration credentials are AES-encrypted and never returned.
- The OAuth state is HMAC-signed and expires after 15 minutes.
- The outgoing webhook goes through `assertDeliverableUrl`.
- Support tickets render as React text (no XSS).
- The LegalCenter `dangerouslySetInnerHTML` renders static bundled content only.
- Mail header injection is not possible: subjects are static, recipients come from the DB, and nodemailer is used.
- There is **no admin wallet credit/debit endpoint** in the code, so there was nothing to validate (`audit.summary` counts `wallet.adjust`, but nothing writes it).

## Not fixed / outside my scope (reported only)
- **Medium, OAuth CSRF / account binding** (integrations.controller.js oauthStart/oauthCallback, and the same pattern in auth.routes.js): the signed state is not tied to the browser that started the flow. An attacker can start a flow for their own workspace, send the consent URL to a victim, and if the victim approves, the victim's Google/HubSpot/Shopify tokens are stored in the attacker's workspace. The fix needs an httpOnly, SameSite=Lax nonce cookie set at start and checked at callback. That is cross-cutting (auth owner).
- **Medium, impersonation tokens** (auth.service.js `impersonateUser`, auth scope): the session issued has no `impersonatedBy` claim and gets a full 7-day refresh token, so actions taken while impersonating are recorded as the user's own and the session outlives the support task.
- Low: VIEWER and AGENT cannot file support tickets, because `roleCapabilities.js` denies POST `/support` (shared middleware).
- Low: the workspace ticket list returns `adminNote` to all members. Fine if it is meant as a reply, a leak if it is meant to be internal.
- Low: `getPoolSummary` runs a WABA sync on every GET while the pool is empty, which is slow with dead Meta credentials.

## Files changed
Backend:
- src/services/email.service.js
- src/services/platformSettings.service.js
- src/services/integrations.service.js
- src/services/integrationHealth.service.js (+ its test)
- src/services/support.service.js
- src/services/notification.service.js
- src/controllers/admin.controller.js
- src/controllers/settings.controller.js
- src/controllers/onboarding.controller.js
- src/middleware/authorize.js (one line in requireSuperAdmin)
- src/validators/index.js (one field in settingsSchemas)

New tests:
- email.service.test.js
- platformSettings.service.test.js
- integrations.service.test.js
- support.service.test.js
- settings.service.test.js

Frontend:
- pages/IntegrationsView.jsx
- pages/ApiManagementTab.jsx
- pages/SettingsView.jsx
- pages/SuperAdminView.jsx
- pages/CustomizeBusinessView.jsx
- components/CustomFields.jsx
- components/CrmIntegrationHealthModal.jsx

## Results
- `npm test`: 538/538 pass.
- `npx vite build`: OK.
- Test users created for role checks: as-viewer@example.test, as-client@example.test, and as-other@example.test (in the "AS other ws" workspace).
