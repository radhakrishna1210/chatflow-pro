import axios from 'axios';
import { env } from '../config/env.js';

const BASE = `https://graph.facebook.com/${env.META_API_VERSION}`;

export function metaClient(accessToken) {
  return axios.create({
    baseURL: BASE,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Resolved per call rather than at import time: this module is loaded once at
// boot, so a token captured here would outlive every rotation made from the
// admin screen.
let _systemClient = null;
let _systemToken = null;
function getSystemClient() {
  const token = env.META_SYSTEM_USER_TOKEN;
  if (!_systemClient || _systemToken !== token) {
    _systemClient = metaClient(token);
    _systemToken = token;
  }
  return _systemClient;
}

export const systemClient = new Proxy({}, {
  get(target, prop) {
    const value = getSystemClient()[prop];
    // axios methods are unbound once read off the instance.
    return typeof value === 'function' ? value.bind(getSystemClient()) : value;
  },
});

export async function sendWhatsAppMessage(phoneNumberId, accessToken, to, template) {
  const client = metaClient(accessToken);
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template,
  });
  return data;
}

export async function sendTextMessage(phoneNumberId, accessToken, to, body) {
  const client = metaClient(accessToken);
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  });
  return data;
}

export async function createMetaTemplate(wabaId, templateData, accessToken) {
  const client = accessToken ? metaClient(accessToken) : systemClient;
  const { data } = await client.post(`/${wabaId}/message_templates`, templateData);
  return data;
}

// Media formats Meta accepts in a template header, with its published size
// caps. Anything else is rejected before a byte is uploaded.
export const TEMPLATE_MEDIA_FORMATS = {
  'image/jpeg':      { format: 'IMAGE',    maxBytes: 5 * 1024 * 1024 },
  'image/png':       { format: 'IMAGE',    maxBytes: 5 * 1024 * 1024 },
  'video/mp4':       { format: 'VIDEO',    maxBytes: 16 * 1024 * 1024 },
  'application/pdf': { format: 'DOCUMENT', maxBytes: 100 * 1024 * 1024 },
};

// Uploads a header sample to Meta and returns the opaque handle a template
// must carry as example.header_handle.
//
// A template with an IMAGE header cannot be created from a URL — Meta requires
// a handle produced by the Resumable Upload API, which is a two-step dance
// against the *app* (not the WABA): open a session, then post the bytes to
// that session. The second call authenticates with `OAuth <token>` rather than
// the usual Bearer, which is a quirk of this endpoint specifically.
export async function uploadTemplateMedia({ buffer, mimeType, fileName, accessToken }) {
  const spec = TEMPLATE_MEDIA_FORMATS[mimeType];
  if (!spec) {
    const e = new Error(`Unsupported file type "${mimeType}". Use a JPG or PNG image, an MP4 video, or a PDF.`);
    e.status = 400; throw e;
  }
  if (buffer.length > spec.maxBytes) {
    const e = new Error(`That file is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — the limit for ${spec.format.toLowerCase()} headers is ${spec.maxBytes / 1024 / 1024} MB.`);
    e.status = 400; throw e;
  }

  const token = accessToken || env.META_SYSTEM_USER_TOKEN;

  // 1. Open an upload session against the app.
  let sessionId;
  try {
    const { data } = await axios.post(`${BASE}/${env.META_APP_ID}/uploads`, null, {
      params: {
        file_name: fileName || 'header',
        file_length: buffer.length,
        file_type: mimeType,
        access_token: token,
      },
    });
    sessionId = data?.id;
  } catch (err) {
    throw describeUploadError(err, 'could not start the upload');
  }
  if (!sessionId) {
    const e = new Error('Meta did not return an upload session'); e.status = 502; throw e;
  }

  // 2. Post the bytes to the session. Note the OAuth scheme, not Bearer.
  try {
    const { data } = await axios.post(`${BASE}/${sessionId}`, buffer, {
      headers: {
        Authorization: `OAuth ${token}`,
        file_offset: '0',
        'Content-Type': 'application/octet-stream',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    if (!data?.h) {
      const e = new Error('Meta accepted the upload but returned no media handle'); e.status = 502; throw e;
    }
    return { handle: data.h, format: spec.format };
  } catch (err) {
    // Same axios-sets-status caveat as uploadPhoneMedia below: without the
    // isAxiosError check a failed header upload reported only "Request failed
    // with status code 400" instead of what Meta objected to.
    if (err.status && !err.isAxiosError) throw err;
    throw describeUploadError(err, 'the upload failed');
  }
}

// Uploads media to a phone number and returns the id a *message* send uses.
//
// This is a different endpoint and a different id from uploadTemplateMedia
// above: that one produces a `header_handle`, which Meta accepts only as the
// review sample when the template is created and rejects at send time. A
// template with a media header must name real media on every send, which is
// what this returns. The id is scoped to `phoneNumberId` and expires after
// roughly 30 days.
export async function uploadPhoneMedia({ phoneNumberId, accessToken, buffer, mimeType, fileName }) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), fileName || 'header');

  try {
    const { data } = await axios.post(`${BASE}/${phoneNumberId}/media`, form, {
      headers: { Authorization: `Bearer ${accessToken}` },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    if (!data?.id) {
      const e = new Error('Meta accepted the media but returned no id'); e.status = 502; throw e;
    }
    return data.id;
  } catch (err) {
    // `err.status` alone can't tell the two apart: axios ≥1.x sets it on its
    // own errors too, so testing it would rethrow the raw "Request failed with
    // status code 400" and discard Meta's actual reason.
    if (err.status && !err.isAxiosError) throw err;
    throw describeUploadError(err, 'could not accept the header image');
  }
}

function describeUploadError(err, what) {
  const m = err.response?.data?.error;
  const detail = m
    ? `${m.message}${m.error_user_msg ? ' — ' + m.error_user_msg : ''} (code ${m.code}${m.error_subcode ? '/' + m.error_subcode : ''})`
    : err.message;
  const e = new Error(`Meta ${what}: ${detail}`);
  e.status = err.response?.status || 502;
  return e;
}

export async function deleteMetaTemplate(wabaId, templateId, accessToken) {
  const client = accessToken ? metaClient(accessToken) : systemClient;
  const { data } = await client.delete(`/${wabaId}/message_templates`, {
    params: { hsm_id: templateId },
  });
  return data;
}

export async function getWabaPhoneNumbers(wabaId, accessToken) {
  const client = accessToken ? metaClient(accessToken) : systemClient;
  const { data } = await client.get(`/${wabaId}/phone_numbers`, {
    params: { fields: 'id,display_phone_number,verified_name,status,quality_rating' },
  });
  return data.data || [];
}

// WABAs the given user token can access (Embedded Signup creates a WABA owned
// by the customer, so we must enumerate theirs — never the platform's).
export async function getUserWabas(accessToken) {
  const client = metaClient(accessToken);
  const ids = new Set();
  try {
    const { data } = await client.get('/me/businesses', { params: { fields: 'id,name' } });
    for (const biz of data.data || []) {
      const { data: wabas } = await client.get(`/${biz.id}/owned_whatsapp_business_accounts`, { params: { fields: 'id' } });
      for (const w of wabas.data || []) ids.add(w.id);
      const { data: shared } = await client.get(`/${biz.id}/client_whatsapp_business_accounts`, { params: { fields: 'id' } }).catch(() => ({ data: {} }));
      for (const w of shared?.data || []) ids.add(w.id);
    }
  } catch (err) {
    console.error('[Meta] getUserWabas failed:', err.response?.data?.error?.message || err.message);
  }
  return [...ids];
}

export async function getWabaTemplates(wabaId, accessToken) {
  const client = accessToken ? metaClient(accessToken) : systemClient;
  const results = [];
  let afterCursor = null;

  do {
    const params = {
      fields: 'id,name,status,category,language,components',
      limit: 200,
      ...(afterCursor ? { after: afterCursor } : {}),
    };
    const { data } = await client.get(`/${wabaId}/message_templates`, { params });
    if (Array.isArray(data.data)) results.push(...data.data);
    afterCursor = data.paging?.cursors?.after && data.paging?.next ? data.paging.cursors.after : null;
  } while (afterCursor);

  return results;
}

// `accessToken` must be the token that owns the number.
//
// Both of these were hardcoded to META_SYSTEM_USER_TOKEN, which is the
// platform's own system user. That works for numbers in the platform's WABA
// (the super-admin number pool) and cannot work for a customer's own WABA
// created by Embedded Signup — the platform token has no permission there, so
// the request failed and the customer never received a code. Callers now pass
// the number's own token; the system token stays the default so the pool flow
// is unchanged.
export async function requestOtp(phoneNumberId, method = 'SMS', accessToken = null) {
  const client = metaClient(accessToken || env.META_SYSTEM_USER_TOKEN);
  const { data } = await client.post(`/${phoneNumberId}/request_code`, {
    code_method: method,
    language: 'en_US',
  });
  return data;
}

export async function verifyOtp(phoneNumberId, code, accessToken = null) {
  const client = metaClient(accessToken || env.META_SYSTEM_USER_TOKEN);
  const { data } = await client.post(`/${phoneNumberId}/verify_code`, { code });
  return data;
}

// Everything the app needs to know about a number's standing with Meta,
// including `code_verification_status` — which the app never read, so a number
// whose verification had EXPIRED looked perfectly healthy until every send
// failed.
export async function getPhoneNumberStatus(phoneNumberId, accessToken) {
  const client = metaClient(accessToken);
  const { data } = await client.get(`/${phoneNumberId}`, {
    params: {
      fields: 'id,display_phone_number,verified_name,status,quality_rating,code_verification_status,platform_type,throughput',
    },
  });
  return data;
}

export async function exchangeCodeForToken(code, redirectUri) {
  // Meta requires the exact redirect_uri from the initial auth request —
  // omitting it yields "Invalid OAuth redirect_uri" and the exchange fails.
  const { data } = await axios.get(`${BASE}/oauth/access_token`, {
    params: {
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      redirect_uri: redirectUri ?? env.META_REDIRECT_URI,
      code,
    },
  });
  return data;
}

export async function getLongLivedToken(shortToken) {
  const { data } = await axios.get(`${BASE}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      fb_exchange_token: shortToken,
    },
  });
  return data;
}

// ─── Embedded Signup helpers ──────────────────────────────────────────────────

// Exchange the short-lived code returned by the FB.login Embedded Signup dialog
// (response_type=code) for an access token. No redirect_uri is used in the
// Embedded Signup code flow — that's the key difference from the classic OAuth
// redirect exchange above.
export async function exchangeEmbeddedSignupCode(code) {
  const { data } = await axios.get(`${BASE}/oauth/access_token`, {
    params: {
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      code,
    },
  });
  return data;
}

// CRITICAL for the Inbox and all webhooks: subscribe our app to the customer's
// WABA. Until this POST succeeds, Meta delivers NO webhook events (inbound
// messages, delivery/read receipts, template status) for any number on the WABA.
export async function subscribeAppToWaba(wabaId, accessToken) {
  const client = accessToken ? metaClient(accessToken) : systemClient;
  const { data } = await client.post(`/${wabaId}/subscribed_apps`);
  return data;
}

// Confirm the subscription actually registered (diagnostic / verification).
export async function getSubscribedApps(wabaId, accessToken) {
  const client = accessToken ? metaClient(accessToken) : systemClient;
  try {
    const { data } = await client.get(`/${wabaId}/subscribed_apps`);
    return data.data || [];
  } catch (err) {
    console.error('[Meta] getSubscribedApps failed:', err.response?.data?.error?.message || err.message);
    return [];
  }
}

// Register a phone number on Cloud API (required after Embedded Signup before it
// can send). A fresh 6-digit PIN is set for two-step verification. Idempotent-ish:
// a number already registered returns an error we treat as non-fatal.
export async function registerPhoneNumber(phoneNumberId, accessToken, pin) {
  const client = metaClient(accessToken);
  try {
    const { data } = await client.post(`/${phoneNumberId}/register`, {
      messaging_product: 'whatsapp',
      pin: pin || String(Math.floor(100000 + Math.random() * 900000)),
    });
    return data;
  } catch (err) {
    const code = err.response?.data?.error?.code;
    // 133005/133006 → already registered / pin mismatch on already-registered number.
    if (code === 133005 || code === 133006) return { success: true, alreadyRegistered: true };
    throw err;
  }
}

export async function getPhoneNumberById(phoneNumberId, accessToken) {
  const client = metaClient(accessToken);
  const { data } = await client.get(`/${phoneNumberId}`, {
    params: { fields: 'id,display_phone_number,verified_name,status,quality_rating' },
  });
  return data;
}

// ─── App-level webhook subscription ──────────────────────────────────────────
//
// Subscribing the app to a customer's WABA (subscribeAppToWaba, above) decides
// *which accounts* send us events. This decides *which events* — and it is set
// once, on the app itself.
//
// The live app was subscribed to `messages` only, so template approvals and
// re-categorisations never arrived: handleTemplateStatusUpdate() and
// handleTemplateCategoryUpdate() in webhook.service.js could not fire, and a
// template's status went stale the moment it was submitted.

// Everything the webhook handler knows how to process.
export const REQUIRED_WEBHOOK_FIELDS = [
  'messages',
  'message_template_status_update',
  'message_template_category_update',
];

const appAccessToken = () => `${env.META_APP_ID}|${env.META_APP_SECRET}`;

export async function getAppWebhookSubscriptions() {
  const { data } = await axios.get(`${BASE}/${env.META_APP_ID}/subscriptions`, {
    params: { access_token: appAccessToken() },
  });
  return data.data || [];
}

// Reports which of the fields we depend on are actually subscribed, so the
// difference between "no messages are arriving" and "template updates are not
// arriving" is answerable without reading the Meta dashboard.
export async function inspectWebhookSubscription() {
  const subs = await getAppWebhookSubscriptions();
  const waba = subs.find((s) => s.object === 'whatsapp_business_account');
  const subscribed = (waba?.fields || []).map((f) => f.name);
  const expectedCallback = `${env.API_PUBLIC_URL}/api/v1/webhook/meta`;
  return {
    subscribed: Boolean(waba),
    active: waba?.active ?? false,
    callbackUrl: waba?.callback_url ?? null,
    expectedCallbackUrl: expectedCallback,
    callbackMatches: waba?.callback_url === expectedCallback,
    fields: subscribed,
    missingFields: REQUIRED_WEBHOOK_FIELDS.filter((f) => !subscribed.includes(f)),
  };
}

// Rewrites the app's WABA subscription so it carries every field we handle.
// `callbackUrl` must be publicly reachable over HTTPS — Meta verifies it by
// calling GET with hub.challenge before accepting the change.
export async function setAppWebhookSubscription(callbackUrl) {
  const url = callbackUrl || `${env.API_PUBLIC_URL}/api/v1/webhook/meta`;
  if (!url.startsWith('https://')) {
    const e = new Error(
      `Meta only accepts an HTTPS webhook URL, and this server's API_PUBLIC_URL is "${env.API_PUBLIC_URL}". `
      + 'Set API_PUBLIC_URL to the public HTTPS origin of this service (or pass a callbackUrl) before subscribing.',
    );
    e.status = 400; e.expose = true; throw e;
  }
  const { data } = await axios.post(`${BASE}/${env.META_APP_ID}/subscriptions`, null, {
    params: {
      object: 'whatsapp_business_account',
      callback_url: url,
      verify_token: env.META_WEBHOOK_VERIFY_TOKEN,
      fields: REQUIRED_WEBHOOK_FIELDS.join(','),
      access_token: appAccessToken(),
    },
  });
  return { ...data, callbackUrl: url, fields: REQUIRED_WEBHOOK_FIELDS };
}

// Sends a media message (image, video, audio, document) on an open
// conversation.
//
// Inbound media has been parsed and stored for a while; this is the other
// direction, which did not exist — an agent could read a customer's photo and
// had no way to send one back. `mediaId` comes from uploadPhoneMedia above and
// is scoped to the same phone number id.
export async function sendMediaMessage(phoneNumberId, accessToken, to, { mediaId, type, caption, filename }) {
  const client = metaClient(accessToken);
  const media = { id: mediaId };
  // Only documents carry a filename, and only image/video/document accept a
  // caption — Meta rejects the message outright if either is sent where it does
  // not belong.
  if (caption && type !== 'audio') media.caption = caption;
  if (type === 'document' && filename) media.filename = filename;

  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type,
    [type]: media,
  });
  return data;
}

// Meta's own limits for a *message* attachment, which differ from the template
// header limits in TEMPLATE_MEDIA_FORMATS above.
export const OUTBOUND_MEDIA_TYPES = {
  'image/jpeg':      { type: 'image',    maxBytes: 5 * 1024 * 1024 },
  'image/png':       { type: 'image',    maxBytes: 5 * 1024 * 1024 },
  'video/mp4':       { type: 'video',    maxBytes: 16 * 1024 * 1024 },
  'audio/mpeg':      { type: 'audio',    maxBytes: 16 * 1024 * 1024 },
  'audio/ogg':       { type: 'audio',    maxBytes: 16 * 1024 * 1024 },
  'application/pdf': { type: 'document', maxBytes: 100 * 1024 * 1024 },
};

// ─── Connection verification ─────────────────────────────────────────────────
//
// Embedded Signup hands the browser a waba_id and a phone_number_id over
// postMessage, and the browser sends them here. They are client input: nothing
// stops a caller posting somebody else's ids alongside their own valid code.
// These confirm the token actually owns what it claims before anything is
// stored against a workspace.

// The WABAs a token can administer, as Meta reports them.
export async function assertTokenOwnsWaba(wabaId, accessToken) {
  const client = metaClient(accessToken);
  try {
    // Reading the WABA itself is the check: a token with no role on it is
    // refused by Meta, which is exactly the answer we need.
    const { data } = await client.get(`/${wabaId}`, {
      params: { fields: 'id,name,currency,timezone_id,account_review_status' },
    });
    if (String(data?.id) !== String(wabaId)) {
      const e = new Error('WhatsApp returned a different business account than the one requested.');
      e.status = 400; e.expose = true; throw e;
    }
    return data;
  } catch (err) {
    if (err.status && !err.isAxiosError) throw err;
    const meta = err.response?.data?.error;
    const e = new Error(
      `This account does not have access to WhatsApp Business Account ${wabaId}`
      + `${meta ? ` — ${meta.message} (code ${meta.code})` : ''}. `
      + 'Finish the sign-up in the Meta window and try again.',
    );
    e.status = 403; e.expose = true; throw e;
  }
}

// Confirms the phone number is on that WABA, and returns Meta's own record of
// it. Checking membership rather than trusting the id is what stops one
// workspace attaching a number that belongs to another business.
export async function assertNumberOnWaba(wabaId, phoneNumberId, accessToken) {
  const numbers = await getWabaPhoneNumbers(wabaId, accessToken).catch(() => []);
  const match = numbers.find((n) => String(n.id) === String(phoneNumberId));
  if (!match) {
    const e = new Error(
      `That phone number is not on WhatsApp Business Account ${wabaId}. `
      + (numbers.length
        ? `The numbers on it are: ${numbers.map((n) => n.display_phone_number).join(', ')}.`
        : 'It has no phone numbers yet — add one in the Meta window first.'),
    );
    e.status = 400; e.expose = true; throw e;
  }
  return match;
}

// Turns a Meta failure during connection into something the person clicking
// "Connect" can act on. Their raw messages name Graph objects and error codes
// and say nothing about what to do.
export function describeConnectionError(err, stage) {
  if (err.status && !err.isAxiosError) return err;
  const meta = err.response?.data?.error;
  const code = Number(meta?.code);
  const raw = meta ? `${meta.message} (code ${meta.code}${meta.error_subcode ? `/${meta.error_subcode}` : ''})` : err.message;

  const known = {
    190: 'The Meta sign-in expired before we could finish. Start the connection again.',
    100: 'Meta did not recognise one of the ids returned by sign-up. Start the connection again.',
    200: 'This account is missing a permission the connection needs (whatsapp_business_management). '
       + 'Re-run the sign-up and accept every permission it asks for.',
    10:  'The app is not approved for this action yet. Check the app is Live and has WhatsApp permissions granted.',
    368: 'Meta has temporarily blocked this action on the account. Try again later.',
  }[code];

  const e = new Error(known ? `${known} (${raw})` : `WhatsApp connection failed while ${stage}: ${raw}`);
  e.status = err.response?.status === 403 ? 403 : 400;
  e.expose = true;
  return e;
}
