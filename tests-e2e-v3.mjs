import app from "./backend/src/app.js";
import http from "http";
const _server = http.createServer(app);
await new Promise((res) => _server.listen(4000, res));

// ChatFlow Pro — v3 suite: the 4 previously-"Coming Soon" features
const BASE = 'http://localhost:4000/api/v1';
let pass = 0, fail = 0; const failures = [];
function check(n, c, x = '') { if (c) { pass++; console.log(`  \u2714 ${n}`); } else { fail++; failures.push(n); console.log(`  \u2718 ${n} ${x}`); } }
async function req(m, p, { body, token } = {}) {
  const o = { method: m, headers: {} };
  if (token) o.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${p}`, o); let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
process.env.PRISMA_PG_ADAPTER = '1';
const { prisma } = await import('./backend/src/lib/prisma.js');
const { encrypt } = await import('./backend/src/lib/encryption.js');

let admin, adminWs, client;
console.log('\n\u25a0 Setup');
{
  let r = await req('POST', '/auth/register', { body: { name: 'V3 Admin', email: 'v3admin@test.dev', password: 'password123', role: 'ADMIN' } });
  admin = r.data; adminWs = r.data.workspace.id;
  r = await req('POST', '/auth/register', { body: { name: 'V3 Client', email: 'v3client@test.dev', password: 'password123', role: 'CLIENT' } });
  client = r.data;
  await req('POST', `/workspaces/${adminWs}/members/invite`, { token: admin.accessToken, body: { email: 'v3client@test.dev', role: 'CLIENT' } });
  check('setup ok', !!admin.accessToken && !!client.accessToken);
}

// ── 1. WhatsApp AI Agent ──
console.log('\n\u25a0 WhatsApp AI Agent');
{
  let r = await req('GET', `/workspaces/${adminWs}/ai-agent/config`, { token: admin.accessToken });
  check('agent config returns defaults + llmAvailable flag', r.status === 200 && typeof r.data.aiAgentEnabled === 'boolean' && 'llmAvailable' in r.data, JSON.stringify(r.data).slice(0,120));
  const llm = r.data.llmAvailable;

  r = await req('PATCH', `/workspaces/${adminWs}/ai-agent/config`, { token: client.accessToken, body: { name: 'X' } });
  check('CLIENT cannot edit agent config (403)', r.status === 403);

  r = await req('PATCH', `/workspaces/${adminWs}/ai-agent/config`, { token: admin.accessToken, body: { name: 'Supportbot', systemPrompt: 'You are a friendly support agent for an Ayurvedic store. Answer briefly.', knowledge: 'Hours: 9-6. Returns within 7 days.' } });
  check('admin can save agent config', r.status === 200 && r.data.aiAgentName === 'Supportbot' && r.data.aiAgentPrompt.includes('Ayurvedic'));

  // Deploy behaviour depends on whether an LLM is configured — both paths are honest.
  r = await req('POST', `/workspaces/${adminWs}/ai-agent/deploy`, { token: admin.accessToken });
  if (llm) {
    check('deploy succeeds when LLM configured', r.status === 200 && r.data.aiAgentEnabled === true, JSON.stringify(r.data));
    const ws = await prisma.workspace.findUnique({ where: { id: adminWs }, select: { aiAgentEnabled: true, aiAgentDeployedAt: true } });
    check('deploy persists enabled + deployedAt', ws.aiAgentEnabled === true && !!ws.aiAgentDeployedAt);
    r = await req('POST', `/workspaces/${adminWs}/ai-agent/undeploy`, { token: admin.accessToken });
    check('undeploy works', r.status === 200 && r.data.aiAgentEnabled === false);
  } else {
    check('deploy REFUSES honestly without an LLM (400, not fake success)', r.status === 400 && /GEMINI|LLM/i.test(r.data.error || ''), JSON.stringify(r.data));
  }

  // Deploy must refuse an empty prompt regardless
  await prisma.workspace.update({ where: { id: adminWs }, data: { aiAgentPrompt: '' } });
  r = await req('POST', `/workspaces/${adminWs}/ai-agent/deploy`, { token: admin.accessToken });
  check('deploy refuses an empty system prompt (400)', r.status === 400);
  await prisma.workspace.update({ where: { id: adminWs }, data: { aiAgentPrompt: 'You are a helpful agent for testing.' } });

  // Test endpoint is honest about missing LLM
  r = await req('POST', `/workspaces/${adminWs}/ai-agent/test`, { token: admin.accessToken, body: { message: 'What are your hours?' } });
  check('test endpoint responds (ok reply or honest reason)', r.status === 200 && ('ok' in r.data), JSON.stringify(r.data).slice(0,120));
  if (!llm) check('test reports no-LLM honestly (ok:false + reason)', r.data.ok === false && r.data.reason, JSON.stringify(r.data));

  r = await req('POST', `/workspaces/${adminWs}/ai-agent/test`, { token: admin.accessToken, body: { message: '' } });
  check('test rejects empty message (400)', r.status === 400);
}

// ── 2. AI Intent Matching ──
console.log('\n\u25a0 AI Intent Matching');
{
  let r = await req('PATCH', `/workspaces/${adminWs}/ai-agent/intent-matching`, { token: client.accessToken, body: { enabled: true } });
  check('CLIENT cannot toggle intent matching (403)', r.status === 403);

  r = await req('PATCH', `/workspaces/${adminWs}/ai-agent/intent-matching`, { token: admin.accessToken, body: { enabled: true, threshold: 0.5 } });
  check('admin enables intent matching + sets threshold', r.status === 200 && r.data.intentMatchingEnabled === true && r.data.intentMatchThreshold === 0.5, JSON.stringify(r.data));

  const ws = await prisma.workspace.findUnique({ where: { id: adminWs }, select: { intentMatchingEnabled: true, intentMatchThreshold: true } });
  check('intent settings persisted to DB', ws.intentMatchingEnabled === true && ws.intentMatchThreshold === 0.5);

  // Seed a keyword trigger and verify the deterministic matcher routes a fuzzy message to it
  await prisma.automationTrigger.create({ data: { workspaceId: adminWs, keyword: 'shipping', responseTemplate: 'Your order ships in 2-4 days.', isActive: true } });
  const { matchIntent } = await import('./backend/src/services/aiAgent.service.js');
  const hit = await matchIntent(adminWs, 'when will my shipping arrive');
  check('deterministic intent matcher routes fuzzy message to the trigger', !!hit && hit.trigger.keyword === 'shipping', JSON.stringify(hit));
  const miss = await matchIntent(adminWs, 'completely unrelated gibberish xyz');
  check('intent matcher returns null for unrelated message (no false positive)', miss === null);

  r = await req('PATCH', `/workspaces/${adminWs}/ai-agent/intent-matching`, { token: admin.accessToken, body: { enabled: false } });
  check('admin disables intent matching', r.status === 200 && r.data.intentMatchingEnabled === false);
  const off = await matchIntent(adminWs, 'when will my shipping arrive');
  check('disabled intent matching returns null', off === null);
}

// ── 3. Campaign fallback channels ──
console.log('\n\u25a0 Campaign Fallback Channels');
{
  let r = await req('GET', `/workspaces/${adminWs}/campaigns/fallback-capabilities`, { token: admin.accessToken });
  check('fallback-capabilities reports sms + email availability', r.status === 200 && 'sms' in r.data && 'email' in r.data, JSON.stringify(r.data));

  // Seed number + template + contact, create a campaign WITH fallbackConfig
  const num = await prisma.waNumber.create({ data: { workspaceId: adminWs, phoneNumber: '+15550001', metaPhoneNumberId: 'PNX', wabaId: 'WBX', encryptedAccessToken: encrypt('t'), displayName: 'N' } });
  const tpl = await prisma.template.create({ data: { workspaceId: adminWs, waNumberId: num.id, name: 'fb_t', category: 'MARKETING', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'hi' }] } });
  r = await req('POST', `/workspaces/${adminWs}/campaigns`, { token: admin.accessToken, body: {
    name: 'Fallback Camp', templateId: tpl.id, numberId: num.id,
    fallbackConfig: { smsEnabled: true, smsFrom: '+14155550000', smsText: 'Hi {{1}}, check WhatsApp!', emailEnabled: true, emailSubject: 'Msg', emailText: 'Hi {{1}}' },
  }});
  check('campaign create accepts fallbackConfig', r.status === 201, JSON.stringify(r.data).slice(0,120));
  const camp = await prisma.campaign.findUnique({ where: { id: r.data.id } });
  check('fallbackConfig persisted to campaign', camp.fallbackConfig?.smsEnabled === true && camp.fallbackConfig?.emailEnabled === true && camp.fallbackConfig.smsFrom === '+14155550000');

  // Directly exercise the fallback runner with a contact missing email → honest recorded reason
  const { runFallbackForRecipient } = await import('./backend/src/services/fallback.service.js');
  const contact = await prisma.contact.create({ data: { workspaceId: adminWs, phoneNumber: '+15559999', name: 'NoEmail' } });
  const recipient = await prisma.campaignRecipient.create({ data: { campaignId: camp.id, contactId: contact.id, status: 'FAILED', failReason: 'wa failed' } });
  const result = await runFallbackForRecipient(camp, recipient, contact);
  check('fallback runner attempts configured channels', !!result && Array.isArray(result.attempts) && result.attempts.length === 2, JSON.stringify(result?.attempts));
  const emailAttempt = result.attempts.find(a => a.channel === 'email');
  check('email fallback honestly fails for contact without email', emailAttempt && emailAttempt.ok === false && /email/i.test(emailAttempt.reason), JSON.stringify(emailAttempt));
  const updated = await prisma.campaignRecipient.findUnique({ where: { id: recipient.id }, select: { failReason: true } });
  check('fallback outcome appended to recipient failReason (honest record)', updated.failReason.includes('fallback'), updated.failReason);

  // Campaign with NO fallbackConfig → runner is a no-op
  const camp2 = await prisma.campaign.create({ data: { workspaceId: adminWs, name: 'NoFB', templateId: tpl.id, waNumberId: num.id, status: 'DRAFT' } });
  const noop = await runFallbackForRecipient(camp2, recipient, contact);
  check('no fallbackConfig → runner is a no-op (null)', noop === null);
}

// ── 4. Per-provider integration OAuth ──
console.log('\n\u25a0 Per-provider Integration OAuth');
{
  let r = await req('GET', `/workspaces/${adminWs}/integrations/oauth/providers`, { token: admin.accessToken });
  check('oauth providers list returns registry with configured flags', r.status === 200 && Array.isArray(r.data) && r.data.some(p => p.id === 'google' && 'configured' in p), JSON.stringify(r.data).slice(0,160));
  const google = r.data.find(p => p.id === 'google');
  const hubspot = r.data.find(p => p.id === 'hubspot');

  r = await req('POST', `/workspaces/${adminWs}/integrations/oauth/google/start`, { token: client.accessToken });
  check('CLIENT cannot start OAuth (403)', r.status === 403);

  // Google has real creds in .env → returns a real authorize URL
  r = await req('POST', `/workspaces/${adminWs}/integrations/oauth/google/start`, { token: admin.accessToken });
  if (google?.configured) {
    check('configured provider (google) returns a real authorize URL', r.status === 200 && typeof r.data.url === 'string' && r.data.url.includes('accounts.google.com') && r.data.url.includes('state='), r.data.url?.slice(0,80));
    check('authorize URL carries our redirect_uri to the callback route', decodeURIComponent(r.data.url).includes('/api/v1/integrations/oauth/google/callback'));
  } else {
    check('unconfigured google returns honest 400 with env hint', r.status === 400 && /CLIENT_ID/.test(r.data.error || ''), JSON.stringify(r.data));
  }

  // A provider without creds → honest "not configured" 400
  r = await req('POST', `/workspaces/${adminWs}/integrations/oauth/hubspot/start`, { token: admin.accessToken });
  if (!hubspot?.configured) {
    check('unconfigured provider returns honest 400 (configured:false + env hint)', r.status === 400 && r.data.configured === false && /HUBSPOT_CLIENT_ID/.test(r.data.error || ''), JSON.stringify(r.data));
  } else {
    check('configured hubspot returns url', r.status === 200 && r.data.url);
  }

  // Non-OAuth provider id → 404
  r = await req('POST', `/workspaces/${adminWs}/integrations/oauth/not-a-provider/start`, { token: admin.accessToken });
  check('unknown provider → 404', r.status === 404);

  // Shopify requires a shop domain → 400 without it
  r = await req('POST', `/workspaces/${adminWs}/integrations/oauth/shopify/start`, { token: admin.accessToken, body: {} });
  check('shopify start without shop domain → 400 (or not-configured 400)', r.status === 400);

  // Callback with a bad state redirects with an error (never crashes)
  const cbRes = await fetch(`${BASE}/integrations/oauth/google/callback?code=abc&state=tampered`, { redirect: 'manual' });
  check('OAuth callback with invalid state redirects to error (302/303), not 500', [301,302,303,307,308].includes(cbRes.status), `status=${cbRes.status}`);
  const loc = cbRes.headers.get('location') || '';
  check('callback error redirect points at integrations with oauth_error', loc.includes('oauth_error'), loc.slice(0,90));
}

console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n  V3 PASSED: ${pass}   FAILED: ${fail}`);
if (failures.length) { console.log('  Failures:'); failures.forEach(f => console.log('   -', f)); }
_server.close(); process.exit(fail ? 1 : 0);
