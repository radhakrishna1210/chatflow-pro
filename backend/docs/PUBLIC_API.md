# Spandan Public API

The Spandan Public API lets your own systems work with a workspace using an API key:
send WhatsApp messages, manage templates, campaigns and contacts, read analytics,
and receive events through a webhook. A separate **Authentication (OTP) API** sends
and verifies one-time passcodes over WhatsApp.

Everything here is source-of-truth for `src/routes/public.routes.js` and
`src/authentication/authentication.routes.js`.

---

## Authentication

Every request carries an API key in the `x-api-key` header:

```http
x-api-key: cfp_xxxxxxxxxxxxxxxxx
```

API keys are created, rotated and revoked by a **workspace admin** in
*Settings → API Keys* (or by connecting an application through Spandan's OAuth
consent screen, which also requires an admin). The raw key is shown once, at
creation or rotation.

A key is refused when:

| Status | When |
|---|---|
| `401` | the header is missing, or the key is unknown or revoked |
| `403` `{ "suspended": true }` | the workspace has been suspended |
| `403` `{ "code": "SUBSCRIPTION_INACTIVE" }` | the workspace's subscription is `CANCELLED` or `EXPIRED` (`PAST_DUE` keeps working during the grace period) |
| `403` `{ "code": "INSUFFICIENT_SCOPE" }` | the key does not hold the scope the endpoint needs |

### Scopes

Each key carries a list of scopes; an endpoint answers `403 INSUFFICIENT_SCOPE`
(naming `requiredScope` and `grantedScopes`) when the key lacks its scope. Keys
issued before scopes existed keep full access.

| Scope | Allows | In the default set |
|---|---|---|
| `messages:send` | `POST /messages` | yes |
| `templates:read` | `GET /templates`, `GET /templates/:id` | yes |
| `templates:write` | `POST /templates` | |
| `campaigns:read` | `GET /campaigns`, `GET /campaigns/:id` | yes |
| `campaigns:write` | `POST /campaigns`, recipients, `POST /campaigns/:id/launch` (launching spends the wallet) | |
| `contacts:read` | `GET /contacts` | yes |
| `contacts:write` | `POST /contacts`, `PUT /contacts/:id` | yes |
| `webhooks:write` | `POST /webhooks` | |
| `analytics:read` | `GET /analytics/summary` | |
| `wallet:read` | `GET /wallet/balance` | |
| `ai-agent:read` | `GET /ai-agent/config` | |
| `ai-agent:write` | `POST /ai-agent/query` | |
| `automations:read` | `GET /automations` | |
| `authentication:send` | the Authentication (OTP) API | never — must be requested explicitly |

### Rate limits

Limits are per API key (not per IP), plus an address-level ceiling in front of key
lookup. Exceeding one returns `429` with a `Retry-After` header and
`{ "error": "...", "retryAfterSeconds": n }`.

| Surface | Limit |
|---|---|
| Any public endpoint | 300 requests / minute per key; 600 / minute per client address |
| `POST /messages` | 60 / minute per key, and 10 / minute to any one recipient number |
| `POST /authentication/generate` | 30 / minute per key, and 5 per 10 minutes to any one phone number |
| `POST /authentication/verify` | 120 / minute per key, and 20 per 10 minutes for any one phone number |

---

## Base URLs

```text
https://<your-deployment>/api/v1/public           # Public API
https://<your-deployment>/api/v1/authentication   # Authentication (OTP) API
```

---

## Billing

Every message sent through this API — `POST /messages` and every OTP — is billed
exactly like a message sent from the dashboard: it uses one message from the plan's
monthly quota, and once the quota is used, the overage rate for the template's
category (MARKETING / UTILITY / AUTHENTICATION) is charged to the workspace wallet.
Text messages use the plan's flat overage rate. If WhatsApp rejects the send, the
quota or wallet charge is refunded.

When neither quota nor wallet balance is left, the send is refused with
`403 { "code": "QUOTA_AND_WALLET_EXHAUSTED" }`.

Every accepted send is recorded on the recipient's conversation (the contact is
created if needed), so it appears in the Inbox and receives delivery and read
statuses.

---

## Identity

### `GET /me`

No scope required. Returns the workspace the key belongs to and the WhatsApp numbers
it can send from (oldest first — the first one is used when `waNumberId` is omitted).

---

## Messages

### `POST /messages` — scope `messages:send`

Sends an approved template, or a free-form text message.

**Template message**

```json
{
  "type": "template",
  "to": "+919876543210",
  "template": {
    "name": "order_update",
    "language": { "code": "en_US" },
    "variables": ["Priya", "#1042"]
  },
  "waNumberId": "optional — a number id from GET /me"
}
```

- `template.name` must be a template in this workspace that Meta has **APPROVED**;
  `language` narrows the match when the same name exists in several languages
  (a bare string such as `"en_US"` is accepted too).
- `template.variables` fills `{{1}}`, `{{2}}`, … in order. Every placeholder the
  template uses must have a non-empty value, or the request is refused with
  `422 TEMPLATE_VARIABLES_REQUIRED` (`details.requiredVariables` says how many).
- Header media, buttons and carousels are built from the stored template; you do
  not send `components`.

**Text message**

```json
{ "type": "text", "to": "+919876543210", "body": "Your order has shipped." }
```

WhatsApp only accepts free-form text within 24 hours of the customer's last
message. Outside that window the send is refused with
`409 { "code": "OUTSIDE_24H_WINDOW" }` and nothing is charged — send a template
instead.

**Response** — `200` with WhatsApp's response plus the stored message id:

```json
{
  "messaging_product": "whatsapp",
  "contacts": [{ "input": "919876543210", "wa_id": "919876543210" }],
  "messages": [{ "id": "wamid.HBgM..." }],
  "messageId": "clx..."
}
```

**Errors**

| Status | Meaning |
|---|---|
| `400` | invalid body (missing `to`, `template` or `body`; unknown `type`) |
| `403` | quota and wallet exhausted, subscription inactive, or the recipient opted out (`RECIPIENT_OPTED_OUT`) |
| `404` | no WhatsApp number / unknown `waNumberId` / template not found |
| `409` | outside the 24-hour window (text) |
| `422` | template not approved, or missing variables |
| `502` | WhatsApp rejected the send (its reason is included) |

---

## Templates

| Method | Path | Scope | Notes |
|---|---|---|---|
| `GET` | `/templates` | `templates:read` | List templates |
| `GET` | `/templates/:id` | `templates:read` | One template |
| `POST` | `/templates` | `templates:write` | Create a template and submit it to Meta for review. Body: `name`, `category`, `language`, `components` (Meta's template format) |

---

## Campaigns

| Method | Path | Scope | Notes |
|---|---|---|---|
| `GET` | `/campaigns?page=1&limit=20` | `campaigns:read` | Paginated list |
| `GET` | `/campaigns/:id` | `campaigns:read` | One campaign with its results |
| `POST` | `/campaigns` | `campaigns:write` | Create a draft: `{ "name", "templateId", "numberId" }` |
| `POST` | `/campaigns/:id/recipients` | `campaigns:write` | Add recipients: `{ "contactIds": ["..."] }` (max 10,000) |
| `PUT` | `/campaigns/:id/recipients` | `campaigns:write` | Replace the audience: `{ "contactIds": [...] }` |
| `POST` | `/campaigns/:id/launch` | `campaigns:write` | Launch (or schedule with `{ "scheduledAt": "ISO-8601" }`). The campaign's cost is charged to the wallet at launch |

---

## Contacts

| Method | Path | Scope | Notes |
|---|---|---|---|
| `GET` | `/contacts?page=1&limit=20` | `contacts:read` | Paginated list |
| `POST` | `/contacts` | `contacts:write` | `{ "name", "phoneNumber", "email"? }` |
| `PUT` | `/contacts/:id` | `contacts:write` | Update fields of a contact |

---

## Analytics, wallet, AI agent, automations

| Method | Path | Scope | Notes |
|---|---|---|---|
| `GET` | `/analytics/summary` | `analytics:read` | Workspace overview metrics |
| `GET` | `/wallet/balance` | `wallet:read` | Wallet balance and recent transactions |
| `GET` | `/ai-agent/config` | `ai-agent:read` | AI agent persona and settings |
| `POST` | `/ai-agent/query` | `ai-agent:write` | `{ "message": "..." }` → the agent's reply (nothing is sent on WhatsApp) |
| `GET` | `/automations` | `automations:read` | Active automations |

---

## Webhooks

### `POST /webhooks` — scope `webhooks:write`

Sets the URL Spandan POSTs workspace events to, and optionally which events.

```json
{
  "webhookUrl": "https://your-system.example.com/spandan-events",
  "webhookEvents": ["messages", "deliveries"]
}
```

`webhookUrl` must be an `http(s)` URL that resolves to a **public** address —
private, loopback, link-local and cloud-metadata addresses are refused with `400`.
Send `""` to remove the webhook. The response is the workspace's webhook settings,
including `webhookVerifyToken`, the secret deliveries are signed with (generated
automatically when a URL is first set).

**Deliveries**

```http
POST <webhookUrl>
Content-Type: application/json
X-ChatFlow-Event: message.received
X-ChatFlow-Delivery: 6f1c...            # same id on every retry of one event
X-ChatFlow-Signature-256: sha256=<hex HMAC-SHA256 of the raw body, keyed with webhookVerifyToken>

{ "id": "6f1c...", "event": "message.received", "workspaceId": "...", "sentAt": "...", "data": { ... } }
```

Events: `message.received`, `message.status`, `campaign.completed`,
`template.status`, `contact.created`, `optout.created`, `custom.event`.

`webhookEvents` is optional. Omitted or empty means every event. Otherwise it is a
list of categories: `messages`, `reactions` and `referrals` select
`message.received`; `deliveries` and `reads` select `message.status`. Other events
are only delivered when no selection is set.

A `2xx` acknowledges the event. Network errors, timeouts (10 s), `408`, `429` and
`5xx` are retried after 2 s, 10 s, 1 min and 5 min (five attempts in all); any other
`4xx` is not retried. Redirects are not followed. Use `X-ChatFlow-Delivery` to
discard duplicates.

---

## Authentication (OTP) API

Base URL `/api/v1/authentication`. Requires a key with the `authentication:send`
scope — the workspace's dedicated Authentication key, provisioned by an admin under
*Authentication → API Key*. Which approved **AUTHENTICATION / COPY_CODE** template
and which WhatsApp number are used is set in the workspace's Authentication
configuration; the caller only supplies the phone number.

### `POST /authentication/generate`

```json
{ "to": "+919876543210" }
```

Spandan generates a 6-digit code, sends it through the configured template and
stores only its hash. The code is never returned to the caller. Each OTP is a
billed AUTHENTICATION-category message (see *Billing*).

```json
{
  "status": "SENT",
  "phone": "919876543210",
  "templateName": "login_code",
  "expiresAt": "2026-10-02T10:10:00.000Z",
  "expiresIn": 600,
  "metaMessageId": "wamid...",
  "mode": "CHATFLOW_GENERATED"
}
```

Errors: `400` invalid phone, `403` quota/wallet, subscription or recipient opted out,
`409` Authentication not configured or disabled, `422` template is not a COPY_CODE
authentication template, `429` rate limit, `502` WhatsApp rejected the send.

### `POST /authentication/verify`

```json
{ "phone": "+919876543210", "code": "123456" }
```

Returns `{ "verified": true, "transactionId": "..." }` or `{ "verified": false, "reason": "..." }` with
`reason` one of `OTP_NOT_FOUND`, `OTP_EXPIRED`, `OTP_ALREADY_USED`, `INVALID_OTP`,
`MAX_ATTEMPTS_EXCEEDED`. Codes expire after 10 minutes and allow 5 attempts.

---

## Errors

Error bodies have the shape:

```json
{ "error": "Human-readable description", "code": "OPTIONAL_MACHINE_CODE" }
```

`400` validation errors also carry `details` (field → messages). Unexpected server
errors return `500` with a `reference` to quote to support.
