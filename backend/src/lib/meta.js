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

export async function getWabaPhoneNumbers(wabaId) {
  const { data } = await systemClient.get(`/${wabaId}/phone_numbers`, {
    params: { fields: 'id,display_phone_number,verified_name,status' },
  });
  return data.data || [];
}

// ── Provisioning helpers (Option 1: platform-hosted sub-WABA per number) ──

// Create a new WABA owned by the platform's main business.
export async function createOwnedWaba(name) {
  const { data } = await systemClient.post(`/${env.META_BUSINESS_ID}/owned_whatsapp_business_accounts`, {
    name,
  });
  return data; // { id }
}

// Add a phone number to a WABA. cc = country calling code, phoneNumber = national number.
export async function addPhoneNumberToWaba(wabaId, { cc, phoneNumber, verifiedName }) {
  const { data } = await systemClient.post(`/${wabaId}/phone_numbers`, {
    cc,
    phone_number: phoneNumber,
    verified_name: verifiedName,
  });
  return data; // { id }
}

// Register a phone number for Cloud API with a two-step-verification PIN.
// accessToken is used for customer-owned WABAs (Embedded Signup); defaults to the system user.
export async function registerPhoneNumber(phoneNumberId, pin, accessToken) {
  const client = accessToken ? metaClient(accessToken) : systemClient;
  const { data } = await client.post(`/${phoneNumberId}/register`, {
    messaging_product: 'whatsapp',
    pin,
  });
  return data;
}

// Subscribe our app to a WABA so inbound messages and statuses reach our webhook.
export async function subscribeAppToWaba(wabaId, accessToken) {
  const client = accessToken ? metaClient(accessToken) : systemClient;
  const { data } = await client.post(`/${wabaId}/subscribed_apps`);
  return data;
}

// Fetch a single phone number's details.
export async function getPhoneNumberById(phoneNumberId, accessToken) {
  const client = accessToken ? metaClient(accessToken) : systemClient;
  const { data } = await client.get(`/${phoneNumberId}`, {
    params: { fields: 'display_phone_number,verified_name,quality_rating,status' },
  });
  return data;
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

export async function exchangeCodeForToken(code) {
  const { data } = await axios.get(`${BASE}/oauth/access_token`, {
    params: {
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
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
