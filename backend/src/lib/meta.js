import axios from 'axios';
import { env } from '../config/env.js';

const BASE = `https://graph.facebook.com/${env.META_API_VERSION}`;

export function metaClient(accessToken) {
  return axios.create({
    baseURL: BASE,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export const systemClient = metaClient(env.META_SYSTEM_USER_TOKEN);

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

export async function requestOtp(phoneNumberId, method = 'SMS') {
  const client = metaClient(env.META_SYSTEM_USER_TOKEN);
  const { data } = await client.post(`/${phoneNumberId}/request_code`, {
    code_method: method,
    language: 'en_US',
  });
  return data;
}

export async function verifyOtp(phoneNumberId, code) {
  const client = metaClient(env.META_SYSTEM_USER_TOKEN);
  const { data } = await client.post(`/${phoneNumberId}/verify_code`, { code });
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
