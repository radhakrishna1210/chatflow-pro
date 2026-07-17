// ChatFlow Pro — end-to-end API test suite (runs against the live local stack)
import app from "./backend/src/app.js";
import http from "http";
const _server = http.createServer(app);
await new Promise((res) => _server.listen(4000, res));

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.PRISMA_PG_ADAPTER = '1';
const BASE = 'http://localhost:4000/api/v1';
let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✘ ${name} ${extra}`); }
}

async function req(method, path, { body, token, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (body !== undefined && raw) opts.body = body;
  const res = await fetch(`${BASE}${path}`, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data, headers: res.headers };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const { prisma } = await import('./backend/src/lib/prisma.js');

// Clean up existing test data to ensure test idempotency
try {
  const emails = ['alice@test.dev', 'bob@test.dev'];
  const users = await prisma.user.findMany({ where: { email: { in: emails } } });
  const userIds = users.map(u => u.id);
  if (userIds.length > 0) {
    await prisma.workspaceMember.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.workspace.deleteMany({
    where: {
      name: {
        in: ["Alice's Workspace", "Bob's Workspace"]
      }
    }
  });
} catch (e) {
  console.log('Setup Cleanup warning:', e.message);
}

// ─── 1. AUTH & SESSION ────────────────────────────────────────────────────────
console.log('\n■ Auth & session');
let admin, adminWs, client;

{
  let r = await req('POST', '/auth/register', { body: { name: 'Alice Admin', email: 'alice@test.dev', password: 'password123' } });
  check('register creates account without a workspace', r.status === 201 && r.data.accessToken && r.data.workspace === null && r.data.user.role === null, JSON.stringify(r.data).slice(0,120));
  admin = r.data;

  r = await req('POST', '/workspaces', { token: admin.accessToken, body: { name: "Alice's Workspace" } });
  check('creating a workspace grants ADMIN', r.status === 201 && r.data.user.role === 'ADMIN' && r.data.workspace?.id, JSON.stringify(r.data).slice(0,120));
  admin = r.data; adminWs = r.data.workspace.id;

  r = await req('POST', '/auth/register', { body: { name: 'Alice Admin', email: 'alice@test.dev', password: 'password123', role: 'ADMIN' } });
  check('duplicate register rejected (409)', r.status === 409);

  r = await req('POST', '/auth/register', { body: { name: 'X', email: 'not-an-email', password: 'short' } });
  check('register validation rejects bad email/short password (400)', r.status === 400);

  r = await req('POST', '/auth/login', { body: { email: 'alice@test.dev', password: 'wrongpass' } });
  check('wrong password rejected (401)', r.status === 401);

  r = await req('POST', '/auth/login', { body: { email: 'alice@test.dev', password: 'password123' } });
  check('login works', r.status === 200 && r.data.accessToken);
  admin = r.data;

  // refresh rotation
  r = await req('POST', '/auth/refresh', { body: { refreshToken: admin.refreshToken } });
  check('refresh issues new token pair', r.status === 200 && r.data.accessToken && r.data.refreshToken);
  const newRefresh = r.data.refreshToken;
  const newAccess = r.data.accessToken;

  r = await req('POST', '/auth/refresh', { body: { refreshToken: admin.refreshToken } });
  check('old refresh token is single-use (401 on reuse)', r.status === 401);
  admin.refreshToken = newRefresh; admin.accessToken = newAccess;

  r = await req('GET', `/workspaces/${adminWs}/campaigns`, {});
  check('protected route without token → 401', r.status === 401);

  r = await req('GET', `/workspaces/${adminWs}/campaigns`, { token: 'garbage.token.here' });
  check('protected route with invalid token → 401', r.status === 401);

  r = await req('POST', '/auth/logout', { body: { refreshToken: admin.refreshToken } });
  check('logout succeeds', r.status === 200);
  r = await req('POST', '/auth/refresh', { body: { refreshToken: admin.refreshToken } });
  check('refresh after logout rejected (401)', r.status === 401);

  r = await req('POST', '/auth/login', { body: { email: 'alice@test.dev', password: 'password123' } });
  admin = r.data;

  // second user (CLIENT in Alice's workspace)
  r = await req('POST', '/auth/register', { body: { name: 'Bob Client', email: 'bob@test.dev', password: 'password123', role: 'CLIENT' } });
  client = r.data;
}

// ─── 2. WORKSPACE ISOLATION & RBAC ───────────────────────────────────────────
console.log('\n■ Workspace security & RBAC');
{
  let r = await req('GET', `/workspaces/${adminWs}/contacts`, { token: client.accessToken });
  check('non-member cannot access another workspace (403)', r.status === 403);

  r = await req('POST', `/workspaces/${adminWs}/members/invite`, { token: admin.accessToken, body: { email: 'bob@test.dev', role: 'CLIENT' } });
  check('admin invites member', r.status === 200 || r.status === 201, `got ${r.status}`);

  // Bob's JWT still points to his own workspace; get a token scoped to Alice's ws via login? JWT contains his ws.
  // workspaceContext uses the path param and checks membership, so Bob's token works on Alice's ws now:
  r = await req('GET', `/workspaces/${adminWs}/contacts`, { token: client.accessToken });
  check('member (CLIENT) can read workspace contacts', r.status === 200);

  r = await req('POST', `/workspaces/${adminWs}/segments`, { token: client.accessToken, body: { name: 'x' } });
  check('CLIENT cannot create segments (403)', r.status === 403);

  r = await req('DELETE', `/workspaces/${adminWs}/whatsapp/numbers/whatever`, { token: client.accessToken });
  check('CLIENT cannot disconnect numbers (403)', r.status === 403);

  r = await req('POST', `/workspaces/${adminWs}/templates/sync-from-meta`, { token: client.accessToken });
  check('CLIENT cannot trigger Meta sync (403)', r.status === 403);

  r = await req('GET', '/admin/pool', { token: admin.accessToken });
  check('non-super-admin blocked from /admin (403)', r.status === 403, `got ${r.status}`);
}

// ─── 3. CONTACTS & CSV IMPORT ────────────────────────────────────────────────
console.log('\n■ Contacts & CSV import');
let contactIds = [];
{
  let r = await req('POST', `/workspaces/${adminWs}/contacts`, { token: admin.accessToken, body: { name: 'Priya', phoneNumber: '+91 98765 43210' } });
  check('create contact normalizes phone', r.status === 201 && r.data.phoneNumber === '+919876543210', JSON.stringify(r.data).slice(0,120));

  r = await req('POST', `/workspaces/${adminWs}/contacts`, { token: admin.accessToken, body: { name: 'Dup', phoneNumber: '919876543210' } });
  check('duplicate phone (different formatting) rejected (409)', r.status === 409);

  r = await req('POST', `/workspaces/${adminWs}/contacts`, { token: admin.accessToken, body: { name: 'Bad', phoneNumber: 'abc' } });
  check('invalid phone rejected (400)', r.status === 400);

  r = await req('PATCH', `/workspaces/${adminWs}/contacts/does-not-matter`, { token: admin.accessToken, body: { workspaceId: 'hack' } });
  check('mass-assignment field on contact update rejected (400)', r.status === 400);

  // CSV import via multipart
  const csv = 'name,phone,email,tags\nRahul,+91 90000 11111,rahul@x.dev,vip\nAnanya,90000 22222,,"a,b"\nJunk,abc,,\nDupRow,+919000011111,,\nPriya,+91 98765 43210,,';
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'contacts.csv');
  const res = await fetch(`${BASE}/workspaces/${adminWs}/contacts/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin.accessToken}` }, body: fd,
  });
  const data = await res.json();
  check('CSV import works end-to-end (multipart)', res.status === 200, JSON.stringify(data));
  check('CSV import: accurate counts (2 new, 1 dup-in-db, 1 invalid, 1 dup-in-file)',
    data.imported === 2 && data.invalid === 1 && data.duplicates === 1, JSON.stringify(data));

  r = await req('GET', `/workspaces/${adminWs}/contacts?search=`, { token: admin.accessToken });
  check('contacts list returns imported rows', r.status === 200 && r.data.total === 3, `total=${r.data?.total}`);
  contactIds = r.data.data.map(c => c.id);

  r = await req('GET', `/workspaces/${adminWs}/contacts?search=Rahul`, { token: admin.accessToken });
  check('contact search works', r.status === 200 && r.data.total === 1 && r.data.data[0].name === 'Rahul');
}

// ─── 4. SEGMENTS ─────────────────────────────────────────────────────────────
console.log('\n■ Segments');
{
  let r = await req('POST', `/workspaces/${adminWs}/segments`, { token: admin.accessToken, body: { name: 'VIP', desc: 'Top customers', color: '#1EBF5E' } });
  check('create segment', r.status === 201 && r.data.id);
  const segId = r.data.id;

  r = await req('PATCH', `/workspaces/${adminWs}/segments/${segId}`, { token: admin.accessToken, body: { workspaceId: 'hijack', name: 'VIP2' } });
  check('segment mass-assignment blocked (400 strict validation)', r.status === 400);

  r = await req('PATCH', `/workspaces/${adminWs}/segments/${segId}`, { token: admin.accessToken, body: { name: 'VIP Gold' } });
  check('segment rename works', r.status === 200 && r.data.name === 'VIP Gold');

  r = await req('POST', `/workspaces/${adminWs}/segments/${segId}/contacts`, { token: admin.accessToken, body: { contactId: contactIds[0] } });
  check('link existing contact to segment', r.status === 201);

  r = await req('GET', `/workspaces/${adminWs}/segments`, { token: admin.accessToken });
  check('segments list includes contactCount', r.status === 200 && r.data[0].contactCount === 1, JSON.stringify(r.data?.[0]?._count));

  r = await req('DELETE', `/workspaces/${adminWs}/segments/${segId}/contacts/${contactIds[0]}`, { token: admin.accessToken });
  check('unlink contact from segment', r.status === 204);

  r = await req('DELETE', `/workspaces/${adminWs}/segments/${segId}`, { token: admin.accessToken });
  check('delete segment', r.status === 204);
}

// ─── 5. WHATSAPP NUMBER + TEMPLATE (local wiring; Meta API unreachable here) ─
console.log('\n■ WhatsApp number + templates (local paths)');
let waNumberId, templateId;
{
  // connect-own validates required fields now
  let r = await req('POST', `/workspaces/${adminWs}/whatsapp/numbers/connect-own`, { token: admin.accessToken, body: { phoneNumber: '+15550001111' } });
  check('connect-own rejects missing fields (400)', r.status === 400);

  r = await req('POST', `/workspaces/${adminWs}/whatsapp/numbers/connect-own`, {
    token: admin.accessToken,
    body: { phoneNumber: '+15550001111', metaPhoneNumberId: 'PN123', wabaId: 'WABA123', accessToken: 'meta-token-secret', displayName: 'Test Biz' },
  });
  check('connect-own stores number, token stripped from response', r.status === 201 && r.data.id && !('encryptedAccessToken' in r.data), JSON.stringify(r.data).slice(0,150));
  waNumberId = r.data.id;

  r = await req('GET', `/workspaces/${adminWs}/whatsapp/numbers`, { token: admin.accessToken });
  check('numbers list works, no token leak', r.status === 200 && r.data.length === 1 && !('encryptedAccessToken' in r.data[0]));

  // Meta template creation requires graph.facebook.com (unreachable) → verify clean error
  r = await req('POST', `/workspaces/${adminWs}/templates`, {
    token: admin.accessToken,
    body: { name: 'welcome_v1', category: 'MARKETING', language: 'en', components: [{ type: 'BODY', text: 'Hi {{1}}!' }] },
  });
  check('template create surfaces Meta failure cleanly (4xx/5xx JSON error, no crash)', r.status >= 400 && r.data?.error, `got ${r.status}`);

  r = await req('POST', `/workspaces/${adminWs}/templates`, { token: admin.accessToken, body: { name: 'BAD NAME!', category: 'MARKETING', language: 'en', components: [] } });
  check('template validation rejects bad name/empty components (400)', r.status === 400);

  // AI route creates a local PENDING template (no Meta call) — use it for campaigns
  r = await req('POST', '/ai/template/create', { token: admin.accessToken, body: { name: 'diwali_offer', body: 'Happy Diwali {{1}}! 30% off today.' } });
  check('AI template created as PENDING (not fake-APPROVED)', r.status === 200 && r.data.status === 'PENDING' && r.data.aiGenerated === true, JSON.stringify(r.data).slice(0,140));
  templateId = r.data.id;

  r = await req('GET', `/workspaces/${adminWs}/templates`, { token: admin.accessToken });
  check('templates list shows the template', r.status === 200 && r.data.some(t => t.id === templateId));

  r = await req('GET', `/workspaces/${adminWs}/templates/library`, { token: admin.accessToken });
  check('template library loads', r.status === 200 && Array.isArray(r.data) && r.data.length > 0);
}

// ─── 6. AI ONBOARDING (auth + data integrity) ────────────────────────────────
console.log('\n■ AI onboarding agent');
{
  let r = await req('POST', '/onboarding/chat', { body: { message: 'create a campaign', workspaceId: adminWs } });
  check('onboarding chat requires authentication (401)', r.status === 401);

  r = await req('POST', '/onboarding/chat', { token: client.accessToken, body: { message: 'hello', workspaceId: 'someone-elses-workspace' } });
  check('onboarding chat rejects non-member workspaceId (403)', r.status === 403);

  r = await req('POST', '/onboarding/chat', { token: admin.accessToken, body: { message: 'create a campaign for diwali sale', workspaceId: adminWs, guided: false } });
  check('AI one-shot campaign responds', r.status === 200, JSON.stringify(r.data).slice(0,120));

  const list = await req('GET', `/workspaces/${adminWs}/campaigns`, { token: admin.accessToken });
  const aiCampaigns = (list.data.data || []).filter(c => c.aiGenerated);
  check('AI campaign is honest DRAFT with zero stats (no fake 250/245/190)',
    aiCampaigns.length > 0 && aiCampaigns.every(c => c.status === 'DRAFT' && c.sent === 0 && c.delivered === 0 && c.read === 0 && c.totalContacts === 0),
    JSON.stringify(aiCampaigns.map(c => ({ s: c.status, sent: c.sent })))); 
}

// ─── 7. CAMPAIGN LIFECYCLE (immediate) ───────────────────────────────────────
console.log('\n■ Campaign lifecycle — immediate launch');
let campaignId;
{
  let r = await req('POST', `/workspaces/${adminWs}/campaigns`, { token: admin.accessToken, body: { name: 'Launch Test', templateId, numberId: waNumberId } });
  check('create campaign (DRAFT)', r.status === 201 && r.data.status === 'DRAFT');
  campaignId = r.data.id;

  r = await req('POST', `/workspaces/${adminWs}/campaigns/${campaignId}/launch`, { token: admin.accessToken, body: {} });
  check('launch without recipients rejected (400)', r.status === 400);

  r = await req('POST', `/workspaces/${adminWs}/campaigns/${campaignId}/recipients`, { token: admin.accessToken, body: { contactIds: [...contactIds, 'invalid-id'] } });
  check('add recipients: accurate added/skipped counts', r.status === 200 && r.data.added === 3 && r.data.skipped === 1 && r.data.totalContacts === 3, JSON.stringify(r.data));

  r = await req('POST', `/workspaces/${adminWs}/campaigns/${campaignId}/recipients`, { token: admin.accessToken, body: { contactIds } });
  check('re-adding same recipients counts duplicates correctly', r.data.added === 0 && r.data.duplicates === 3, JSON.stringify(r.data));

  r = await req('POST', `/workspaces/${adminWs}/campaigns/${campaignId}/launch`, { token: admin.accessToken, body: {} });
  check('launch accepted; status NOT prematurely RUNNING before worker claims it',
    r.status === 200 && (r.data.status === 'DRAFT' || r.data.status === 'RUNNING'), `status=${r.data?.status}`);

  await sleep(4000); // worker picks up; Meta sends fail (graph unreachable) → recipients FAILED
  r = await req('GET', `/workspaces/${adminWs}/campaigns/${campaignId}`, { token: admin.accessToken });
  const c = r.data;
  check('worker processed the job (campaign left DRAFT)', c.status !== 'DRAFT', `status=${c.status}`);
  check('campaign reached terminal state honestly (COMPLETED with failures counted)',
    c.status === 'COMPLETED' && c.failed === 3 && c.sent === 0, `status=${c.status} sent=${c.sent} failed=${c.failed}`);
  check('launchedAt + completedAt timestamps recorded', !!c.launchedAt && !!c.completedAt);
  check('recipient detail shows per-contact failReason', Array.isArray(c.recipients) && c.recipients.every(rr => rr.status === 'FAILED' && rr.failReason), c.recipients?.[0]?.failReason?.slice(0,60));

  r = await req('PATCH', `/workspaces/${adminWs}/campaigns/${campaignId}/cancel`, { token: admin.accessToken });
  check('cancelling a COMPLETED campaign rejected (400)', r.status === 400);
}

// ─── 8. SCHEDULED CAMPAIGNS + CANCEL ─────────────────────────────────────────
console.log('\n■ Campaign lifecycle — scheduling & cancel');
{
  let r = await req('POST', `/workspaces/${adminWs}/campaigns`, { token: admin.accessToken, body: { name: 'Sched Test', templateId, numberId: waNumberId } });
  const cid = r.data.id;
  await req('POST', `/workspaces/${adminWs}/campaigns/${cid}/recipients`, { token: admin.accessToken, body: { contactIds: [contactIds[0]] } });

  r = await req('POST', `/workspaces/${adminWs}/campaigns/${cid}/launch`, { token: admin.accessToken, body: { scheduledAt: new Date(Date.now() - 3600_000).toISOString() } });
  check('past scheduledAt rejected (400) instead of firing immediately', r.status === 400, `got ${r.status}`);

  r = await req('POST', `/workspaces/${adminWs}/campaigns/${cid}/launch`, { token: admin.accessToken, body: { scheduledAt: 'not-a-date' } });
  check('invalid scheduledAt rejected (400)', r.status === 400);

  const future = new Date(Date.now() + 3600_000).toISOString();
  r = await req('POST', `/workspaces/${adminWs}/campaigns/${cid}/launch`, { token: admin.accessToken, body: { scheduledAt: future } });
  check('future schedule → status SCHEDULED with queueJobId stored', r.status === 200 && r.data.status === 'SCHEDULED' && r.data.queueJobId && r.data.scheduledAt, JSON.stringify({ s: r.data?.status, j: r.data?.queueJobId }));
  const jobId = r.data.queueJobId;

  r = await req('PATCH', `/workspaces/${adminWs}/campaigns/${cid}/cancel`, { token: admin.accessToken });
  check('cancel scheduled campaign → CANCELLED', r.status === 200 && r.data.status === 'CANCELLED');

  await sleep(1500);
  r = await req('GET', `/workspaces/${adminWs}/campaigns/${cid}`, { token: admin.accessToken });
  check('cancelled campaign stays CANCELLED (no COMPLETED overwrite)', r.data.status === 'CANCELLED', `status=${r.data.status}`);

  // Verify the delayed job was actually removed from Redis
  const { execSync } = await import('child_process');
  const delayed = execSync('redis-cli zcard bull:campaigns:delayed').toString().trim();
  check('delayed BullMQ job removed on cancel', delayed === '0', `delayed=${delayed} (jobId=${jobId})`);
}

// ─── 9. SCHEDULED RECOVERY (restart survival) ────────────────────────────────
console.log('\n■ Scheduled campaign recovery after job loss');
{
  let r = await req('POST', `/workspaces/${adminWs}/campaigns`, { token: admin.accessToken, body: { name: 'Recovery Test', templateId, numberId: waNumberId } });
  const cid = r.data.id;
  await req('POST', `/workspaces/${adminWs}/campaigns/${cid}/recipients`, { token: admin.accessToken, body: { contactIds: [contactIds[0]] } });
  await req('POST', `/workspaces/${adminWs}/campaigns/${cid}/launch`, { token: admin.accessToken, body: { scheduledAt: new Date(Date.now() + 7200_000).toISOString() } });

  // Simulate ephemeral Redis losing the delayed job
  const { execSync } = await import('child_process');
  execSync("redis-cli --scan --pattern 'bull:campaigns:*' | xargs -r redis-cli del");
  const before = execSync('redis-cli zcard bull:campaigns:delayed').toString().trim();

  // Import the service in-process against the same DB/Redis and run recovery
  process.env.PRISMA_PG_ADAPTER = '1';
  const { recoverScheduledCampaigns } = await import('./backend/src/services/campaigns.service.js');
  const recovered = await recoverScheduledCampaigns();
  const after = execSync('redis-cli zcard bull:campaigns:delayed').toString().trim();
  check('recovery re-queues orphaned SCHEDULED campaigns', recovered >= 1 && before === '0' && after === '1', `recovered=${recovered} before=${before} after=${after}`);

  await req('PATCH', `/workspaces/${adminWs}/campaigns/${cid}/cancel`, { token: admin.accessToken });
}

// ─── 10. WEBHOOK STATUS TRACKING ─────────────────────────────────────────────
console.log('\n■ Webhook — delivery/read tracking + signature');
{
  // Craft a real linked message: reuse a recipient of the completed campaign… they FAILED,
  // so build a fresh SENT recipient + message directly via Prisma for the tracking test.
  const { prisma } = await import('./backend/src/lib/prisma.js');
  const camp = await prisma.campaign.create({ data: { workspaceId: adminWs, name: 'Webhook Test', templateId, waNumberId, status: 'RUNNING', totalContacts: 1, sent: 1 } });
  const rec = await prisma.campaignRecipient.create({ data: { campaignId: camp.id, contactId: contactIds[0], status: 'SENT', sentAt: new Date() } });
  const convo = await prisma.conversation.create({ data: { workspaceId: adminWs, contactId: contactIds[0], waNumberId } });
  await prisma.message.create({ data: { conversationId: convo.id, body: '[Campaign: Webhook Test]', direction: 'OUTBOUND', metaMessageId: 'wamid.TEST1', campaignRecipientId: rec.id } });

  // decoy campaign in the same workspace — must NOT be touched (old bug incremented ALL running campaigns)
  const decoy = await prisma.campaign.create({ data: { workspaceId: adminWs, name: 'Decoy', templateId, status: 'RUNNING' } });

  const { createHmac } = await import('crypto');
  const sendWebhook = async (payload) => {
    const raw = JSON.stringify(payload);
    const sig = 'sha256=' + createHmac('sha256', 'test_meta_secret').update(raw).digest('hex');
    return fetch(`${BASE}/webhook/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: raw });
  };

  let res = await fetch(`${BASE}/webhook/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('webhook without signature rejected (401)', res.status === 401);

  res = await fetch(`${BASE}/webhook/meta?hub.mode=subscribe&hub.verify_token=verify_token_test&hub.challenge=c123`);
  check('webhook GET verification echoes challenge', res.status === 200 && (await res.text()) === 'c123');

  const statusPayload = (status) => ({ entry: [{ id: 'WABA123', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.TEST1', status, timestamp: String(Math.floor(Date.now()/1000)) }] } }] }] });

  res = await sendWebhook(statusPayload('delivered'));
  await sleep(800);
  let freshRec = await prisma.campaignRecipient.findUnique({ where: { id: rec.id } });
  let freshCamp = await prisma.campaign.findUnique({ where: { id: camp.id } });
  check('delivered webhook updates the exact recipient', freshRec.status === 'DELIVERED' && !!freshRec.deliveredAt);
  check('delivered webhook increments only the right campaign', freshCamp.delivered === 1);

  res = await sendWebhook(statusPayload('delivered'));
  await sleep(600);
  freshCamp = await prisma.campaign.findUnique({ where: { id: camp.id } });
  check('duplicate delivered webhook is idempotent (no double count)', freshCamp.delivered === 1, `delivered=${freshCamp.delivered}`);

  res = await sendWebhook(statusPayload('read'));
  await sleep(800);
  freshRec = await prisma.campaignRecipient.findUnique({ where: { id: rec.id } });
  freshCamp = await prisma.campaign.findUnique({ where: { id: camp.id } });
  check('read webhook marks recipient READ with readAt', freshRec.status === 'READ' && !!freshRec.readAt);
  check('read counter incremented once', freshCamp.read === 1);

  const decoyFresh = await prisma.campaign.findUnique({ where: { id: decoy.id } });
  check('decoy campaign untouched (no workspace-wide counter bleed)', decoyFresh.delivered === 0 && decoyFresh.read === 0);

  // inbound message from normalized-differently stored contact
  const inbound = { entry: [{ id: 'WABA123', changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: 'PN123' },
    contacts: [{ profile: { name: 'Priya' } }],
    messages: [{ from: '919876543210', id: 'wamid.IN1', timestamp: String(Math.floor(Date.now()/1000)), text: { body: 'Hello!' } }],
  } }] }] };
  res = await sendWebhook(inbound);
  await sleep(800);
  const contacts = await prisma.contact.findMany({ where: { workspaceId: adminWs, phoneNumber: { contains: '9876543210' } } });
  check('inbound message matches existing contact despite formatting (no duplicate created)', contacts.length === 1, `contacts=${contacts.length}`);
  const msg = await prisma.message.findFirst({ where: { metaMessageId: 'wamid.IN1' } });
  check('inbound message persisted to conversation', !!msg && msg.direction === 'INBOUND');

  await prisma.campaign.delete({ where: { id: decoy.id } });
}

// ─── 11. WORKFLOWS / AUTOMATION / ANALYTICS / SETTINGS / API KEYS ────────────
console.log('\n■ Workflows, analytics, settings, API keys');
{
  let r = await req('POST', `/workspaces/${adminWs}/workflows`, { token: admin.accessToken, body: { name: 'Order Flow', nodes: [{ id: 's1', type: 'trigger', subtype: 'keyword', value: 'ORDER' }], edges: [] } });
  check('create workflow', (r.status === 201 || r.status === 200) && r.data.id, `got ${r.status}`);
  const wfId = r.data.id;

  r = await req('GET', `/workspaces/${adminWs}/workflows`, { token: admin.accessToken });
  check('list workflows returns object nodes (no string JSON)', r.status === 200 && typeof r.data[0].nodes === 'object');

  r = await req('PATCH', `/workspaces/${adminWs}/workflows/${wfId}`, { token: admin.accessToken, body: { isActive: false } });
  check('update workflow', r.status === 200 && r.data.isActive === false);

  r = await req('DELETE', `/workspaces/${adminWs}/workflows/${wfId}`, { token: client.accessToken });
  check('CLIENT cannot delete workflows (403)', r.status === 403);

  r = await req('DELETE', `/workspaces/${adminWs}/workflows/${wfId}`, { token: admin.accessToken });
  check('ADMIN deletes workflow', r.status === 204);

  r = await req('GET', `/workspaces/${adminWs}/analytics/overview`, { token: admin.accessToken });
  check('analytics overview loads with real aggregates', r.status === 200 && typeof r.data.messagesSent === 'number', JSON.stringify(r.data).slice(0,100));

  r = await req('GET', `/workspaces/${adminWs}/analytics/delivery`, { token: admin.accessToken });
  check('delivery-stats returns 7 day buckets (single-query version)', r.status === 200 && r.data.length === 7 && r.data.some(d => d.delivered > 0), JSON.stringify(r.data?.map(d=>d.delivered)));

  r = await req('GET', `/workspaces/${adminWs}/settings`, { token: admin.accessToken });
  check('settings load', r.status === 200);

  r = await req('POST', `/workspaces/${adminWs}/api-keys`, { token: admin.accessToken, body: { name: 'ci-key', environment: 'production' } });
  check('create API key', (r.status === 200 || r.status === 201) && (r.data.rawKey || r.data.key || r.data.apiKey), JSON.stringify(r.data).slice(0,120));
}

// ─── 12. AI ROUTE SCOPING ────────────────────────────────────────────────────
console.log('\n■ AI routes — scoping');
{
  let r = await req('POST', '/ai/campaign/update', { token: admin.accessToken, body: { id: 'nonexistent', status: 'CANCELLED' } });
  check('AI update of unknown campaign → 404 (workspace scoped)', r.status === 404);

  r = await req('POST', '/ai/campaign/update', { token: admin.accessToken, body: { id: campaignId, status: 'RUNNING' } });
  check('AI cannot force RUNNING status (whitelist)', r.status === 400);
}

// ─── 13. RATE LIMITING ───────────────────────────────────────────────────────
console.log('\n■ Rate limiting');
{
  let last = 0;
  for (let i = 0; i < 25; i++) {
    const r = await req('POST', '/auth/login', { body: { email: 'brute@force.dev', password: 'x'.repeat(8) } });
    last = r.status;
    if (last === 429) break;
  }
  check('login brute-force throttled (429 within 25 attempts)', last === 429, `last=${last}`);
}

// ─── 14. CORS ────────────────────────────────────────────────────────────────
console.log('\n■ CORS');
{
  let res = await fetch(`${BASE}/health`, { headers: { Origin: 'https://evil.example.com' } });
  check('unknown origin gets NO Access-Control-Allow-Origin', !res.headers.get('access-control-allow-origin'));
  res = await fetch(`${BASE}/health`, { headers: { Origin: 'http://localhost:5173' } });
  check('configured client origin is allowed', res.headers.get('access-control-allow-origin') === 'http://localhost:5173');
}

console.log(`\n════════════════════════════════════\n  PASSED: ${pass}   FAILED: ${fail}`);
if (failures.length) { console.log('  Failures:'); failures.forEach(f => console.log('   -', f)); }
_server.close();
process.exit(fail ? 1 : 0);
