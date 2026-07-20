# ChatFlowPro Public API

The ChatFlowPro Public API allows you to programmatically access your workspace features using API Keys.

## Authentication

All public API requests must be authenticated using an API Key. You can generate API Keys from your ChatFlowPro Dashboard.

Pass the API Key in the `x-api-key` header for every request:

```http
x-api-key: cfp_xxxxxxxxxxxxxxxxx
```

If the key is missing, invalid, or revoked, you will receive a `401 Unauthorized` response.

---

## Base URL

```text
https://api.yourdomain.com/api/v1/public
```
*(Replace `api.yourdomain.com` with your actual ChatFlowPro deployment domain, or `http://localhost:3000` for local development.)*

---

## Endpoints

### 1. Messages

#### Send a WhatsApp Message
`POST /messages`

Sends a template or text message to a WhatsApp number.

**Request Body:**
```json
{
  "to": "1234567890",
  "type": "template",
  "template": {
    "name": "hello_world",
    "language": {
      "code": "en_US"
    }
  },
  "waNumberId": "optional_specific_number_id_to_send_from"
}
```

---

### 2. Templates

#### List Templates
`GET /templates`

Returns a list of templates in your workspace.

#### Create Template
`POST /templates`

Creates a new template. (Body matches the standard Meta template format).

---

### 3. Campaigns

#### List Campaigns
`GET /campaigns?page=1&limit=20`

Returns paginated campaigns.

#### Create Campaign
`POST /campaigns`

**Request Body:**
```json
{
  "name": "My API Campaign",
  "templateId": "cuid_of_template",
  "numberId": "cuid_of_wa_number"
}
```

#### Launch Campaign
`POST /campaigns/:id/launch`

Launches a draft campaign.

**Request Body (optional scheduling):**
```json
{
  "scheduledAt": "2023-12-01T10:00:00Z"
}
```

---

### 4. Contacts

#### List Contacts
`GET /contacts?page=1&limit=20`

Returns paginated contacts.

#### Create Contact
`POST /contacts`

**Request Body:**
```json
{
  "name": "John Doe",
  "phoneNumber": "1234567890",
  "email": "john@example.com"
}
```

---

### 5. Webhooks

#### Register Webhook URL
`POST /webhooks`

Sets or updates the webhook URL for your workspace. ChatFlowPro will send events (message received, delivery receipts, etc.) to this URL.

**Request Body:**
```json
{
  "webhookUrl": "https://your-system.com/webhook-receiver"
}
```

---

## Errors

Standard HTTP status codes are used:
- `200/201`: Success
- `400`: Bad Request (Invalid parameters)
- `401`: Unauthorized (Missing or invalid API key)
- `404`: Not Found
- `500`: Internal Server Error

Error responses follow this structure:
```json
{
  "error": "Error description message"
}
```
