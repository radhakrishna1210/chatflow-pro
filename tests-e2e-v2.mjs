// ChatFlow Pro — v2 end-to-end suite (new features from BUGS-v2)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.PRISMA_PG_ADAPTER = '1';
import app from "./backend/src/app.js";
import http from "http";
const _server = http.createServer(app);
await new Promise((res) => _server.listen(4000, res));

const BASE = 'http://localhost:4000/api/v1';
let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  \u2714 ${name}`); }
  else { fail++; failures.push(name); console.log(`  \u2718 ${name} ${extra}`); }
}
async function req(method, path, { body, token, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, opts);
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

import { env } from './backend/src/config/env.js';
let adminEmail = env.ADMIN_EMAIL || 'super@chatflow.test';

const { prisma } = await import('./backend/src/lib/prisma.js');

// Clean up existing test data to ensure test idempotency
try {
  const emails = ['v2admin@test.dev', 'v2client@test.dev', 'otto@test.dev', adminEmail];
  const users = await prisma.user.findMany({ where: { email: { in: emails } } });
  const userIds = users.map(u => u.id);
  if (userIds.length > 0) {
    await prisma.workspaceMember.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.workspace.deleteMany({
    where: {
      name: {
        in: ["V2's Workspace", "Super's Workspace", "Otto's Workspace"]
      }
    }
  });
} catch (e) {
  console.log('Setup Cleanup warning:', e.message);
}

let admin, adminWs, client, superAdmin, superWs;

console.log('\n\u25a0 Setup');
{
  let r = await req('POST', '/auth/register', { body: { name: 'V2 Admin', email: 'v2admin@test.dev', password: 'password123', role: 'ADMIN' } });
  admin = r.data; adminWs = r.data.workspace.id;
  r = await req('POST', '/auth/register', { body: { name: 'V2 Client', email: 'v2client@test.dev', password: 'password123', role: 'CLIENT' } });
  client = r.data;
  await req('POST', `/workspaces/${adminWs}/members/invite`, { token: admin.accessToken, body: { email: 'v2client@test.dev', role: 'CLIENT' } });
  r = await req('POST', '/auth/register', { body: { name: 'Super', email: adminEmail, password: 'password123', role: 'ADMIN' } });
  superAdmin = r.data; superWs = r.data.workspace.id;
  check('super admin registration flags superAdmin', superAdmin.user.superAdmin === true, JSON.stringify(superAdmin.user));
}

console.log('\n\u25a0 OTP signup (bug #11)');
{
  let r = await req('POST', '/auth/register/start', { body: { name: 'Otto', email: 'otto@test.dev', password: 'password123' } });
  check('signup/start returns 200 without creating a user', r.status === 200, JSON.stringify(r.data));
  const userYet = await prisma.user.findUnique({ where: { email: 'otto@test.dev' } });
  check('no User row exists before verification', !userYet);
  const otpRow = await prisma.emailOtp.findFirst({ where: { email: 'otto@test.dev', consumed: false }, orderBy: { createdAt: 'desc' } });
  check('EmailOtp row created with hashed code + stashed passwordHash', !!otpRow && !!otpRow.codeHash && !!otpRow.passwordHash);

  r = await req('POST', '/auth/register/verify', { body: { email: 'otto@test.dev', code: '000000' } });
  check('wrong OTP code rejected (400)', r.status === 400);
  const afterWrong = await prisma.emailOtp.findUnique({ where: { id: otpRow.id } });
  check('failed attempt increments attempts counter', afterWrong.attempts === 1, `attempts=${afterWrong.attempts}`);

  const { createHash } = await import('crypto');
  const knownCode = '424242';
  await prisma.emailOtp.update({ where: { id: otpRow.id }, data: { codeHash: createHash('sha256').update(knownCode).digest('hex'), attempts: 0 } });
  r = await req('POST', '/auth/register/verify', { body: { email: 'otto@test.dev', code: knownCode, role: 'ADMIN' } });
  check('correct OTP creates account + returns session', r.status === 201 && r.data.accessToken && r.data.workspace?.id, JSON.stringify(r.data).slice(0,120));
  const userNow = await prisma.user.findUnique({ where: { email: 'otto@test.dev' } });
  check('User row now exists after verification', !!userNow);
  const otpConsumed = await prisma.emailOtp.findUnique({ where: { id: otpRow.id } });
  check('OTP consumed (single-use)', otpConsumed.consumed === true);
  r = await req('POST', '/auth/register/verify', { body: { email: 'otto@test.dev', code: knownCode } });
  check('reusing a consumed OTP rejected', r.status === 400);
}

console.log('\n\u25a0 Wallet ledger (bug #10)');
{
  let r = await req('GET', `/workspaces/${adminWs}/wallet`, { token: admin.accessToken });
  check('wallet starts at 0 with empty ledger', r.status === 200 && Number(r.data.balance) === 0 && r.data.transactions.length === 0, JSON.stringify(r.data));
  r = await req('POST', `/workspaces/${adminWs}/wallet/recharge`, { token: client.accessToken, body: { amount: 500 } });
  check('CLIENT cannot recharge (admin-only, 403)', r.status === 403);
  r = await req('POST', `/workspaces/${adminWs}/wallet/recharge`, { token: admin.accessToken, body: { amount: -5 } });
  check('negative recharge rejected (400)', r.status === 400);
  r = await req('POST', `/workspaces/${adminWs}/wallet/recharge`, { token: admin.accessToken, body: { amount: 2000 } });
  check('recharge credits server-side balance', r.status === 200 && Number(r.data.balance) === 2000, JSON.stringify(r.data).slice(0,120));
  const ws = await prisma.workspace.findUnique({ where: { id: adminWs }, select: { walletBalance: true } });
  check('DB walletBalance matches (server-authoritative)', Number(ws.walletBalance) === 2000, `db=${ws.walletBalance}`);
  r = await req('GET', `/workspaces/${adminWs}/wallet`, { token: admin.accessToken });
  check('ledger records CREDIT with balanceAfter', r.data.transactions.length === 1 && r.data.transactions[0].type === 'CREDIT' && Number(r.data.transactions[0].balanceAfter) === 2000);
  r = await req('POST', `/workspaces/${adminWs}/wallet/recharge`, { token: admin.accessToken, body: { amount: 999999 } });
  check('recharge above cap rejected (400)', r.status === 400);
}

console.log('\n\u25a0 Integrations backend (bug #7)');
{
  let r = await req('GET', `/workspaces/${adminWs}/integrations`, { token: admin.accessToken });
  check('integrations list starts empty', r.status === 200 && r.data.length === 0);
  r = await req('POST', `/workspaces/${adminWs}/integrations/shopify`, { token: client.accessToken, body: { type: 'apikey', credentials: { key: 'x' } } });
  check('CLIENT cannot connect integrations (403)', r.status === 403);
  r = await req('POST', `/workspaces/${adminWs}/integrations/shopify`, { token: admin.accessToken, body: { type: 'apikey', credentials: { apiKey: 'super-secret-key', store: 'acme' } } });
  check('admin connects an apikey integration', r.status === 201 && r.data.provider === 'shopify' && r.data.hasCredentials === true, JSON.stringify(r.data));
  check('response never leaks raw credentials', !('encryptedCredentials' in r.data) && !('credentials' in r.data));
  const row = await prisma.workspaceIntegration.findFirst({ where: { workspaceId: adminWs, provider: 'shopify' } });
  check('credentials stored encrypted (not plaintext)', row.encryptedCredentials && !row.encryptedCredentials.includes('super-secret-key') && row.encryptedCredentials.includes(':'));
  r = await req('GET', `/workspaces/${superWs}/integrations`, { token: superAdmin.accessToken });
  check('integrations are workspace-scoped (isolation)', r.status === 200 && r.data.length === 0);
  r = await req('DELETE', `/workspaces/${adminWs}/integrations/shopify`, { token: admin.accessToken });
  check('admin disconnects integration', r.status === 200 && r.data.ok === true);
  r = await req('GET', `/workspaces/${adminWs}/integrations`, { token: admin.accessToken });
  check('integration removed after disconnect', r.data.length === 0);
}

console.log('\n\u25a0 Support tickets (bug #9)');
let ticketId;
{
  let r = await req('POST', `/workspaces/${adminWs}/support`, { token: admin.accessToken, body: { subject: 'Cannot connect number', message: 'Meta signup fails at step 2', category: 'TECHNICAL' } });
  check('member can create a support ticket', r.status === 201 && r.data.id && r.data.status === 'OPEN', JSON.stringify(r.data).slice(0,120));
  ticketId = r.data.id;
  r = await req('POST', `/workspaces/${adminWs}/support`, { token: admin.accessToken, body: { subject: '', message: '' } });
  check('empty ticket rejected (400)', r.status === 400);
  r = await req('GET', `/workspaces/${adminWs}/support`, { token: admin.accessToken });
  check('workspace lists its own tickets', r.status === 200 && r.data.some(t => t.id === ticketId));
}

console.log('\n\u25a0 Super Admin platform (bug #9)');
{
  let r = await req('GET', '/admin/platform/stats', { token: admin.accessToken });
  check('non-super-admin blocked from platform stats (403)', r.status === 403);
  r = await req('GET', '/admin/platform/stats', { token: superAdmin.accessToken });
  check('super admin sees platform-wide stats', r.status === 200 && r.data.totals && r.data.totals.workspaces >= 3, JSON.stringify(r.data.totals));
  check('platform stats include open ticket count', r.data.totals.openTickets >= 1, `openTickets=${r.data.totals.openTickets}`);
  r = await req('GET', '/admin/platform/workspaces', { token: superAdmin.accessToken });
  check('super admin lists all workspaces with counts + owner', r.status === 200 && r.data.length >= 3 && r.data[0].counts && ('owner' in r.data[0]));
  r = await req('PATCH', `/admin/platform/workspaces/${adminWs}/suspend`, { token: superAdmin.accessToken, body: { suspended: true, reason: 'Test' } });
  check('super admin can suspend a workspace', r.status === 200 && r.data.suspended === true);
  r = await req('GET', `/workspaces/${adminWs}/campaigns`, { token: admin.accessToken });
  check('suspended workspace blocks its own members (403)', r.status === 403 && r.data.suspended === true, JSON.stringify(r.data));
  r = await req('PATCH', `/admin/platform/workspaces/${adminWs}/suspend`, { token: superAdmin.accessToken, body: { suspended: false } });
  check('super admin can reinstate a workspace', r.status === 200 && r.data.suspended === false);
  r = await req('GET', `/workspaces/${adminWs}/campaigns`, { token: admin.accessToken });
  check('reinstated workspace regains access', r.status === 200);
  r = await req('GET', '/admin/platform/tickets', { token: superAdmin.accessToken });
  check('super admin sees support queue with workspace names', r.status === 200 && r.data.some(t => t.id === ticketId && t.workspace?.name));
  r = await req('PATCH', `/admin/platform/tickets/${ticketId}`, { token: superAdmin.accessToken, body: { status: 'RESOLVED', adminNote: 'Fixed' } });
  check('super admin can resolve a ticket', r.status === 200 && r.data.status === 'RESOLVED');
}

console.log('\n\u25a0 Per-number templates (bug #3)');
{
const { encrypt } = await import('./backend/src/lib/encryption.js');
  const enc = encrypt('fake-token');
  const numA = await prisma.waNumber.create({ data: { workspaceId: adminWs, phoneNumber: '+15551110001', metaPhoneNumberId: 'PN_A', wabaId: 'WABA_A', encryptedAccessToken: enc, displayName: 'Number A' } });
  const numB = await prisma.waNumber.create({ data: { workspaceId: adminWs, phoneNumber: '+15551110002', metaPhoneNumberId: 'PN_B', wabaId: 'WABA_B', encryptedAccessToken: enc, displayName: 'Number B' } });
  const tA = await prisma.template.create({ data: { workspaceId: adminWs, waNumberId: numA.id, name: 'welcome_a', category: 'MARKETING', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'A' }] } });
  const tB = await prisma.template.create({ data: { workspaceId: adminWs, waNumberId: numB.id, name: 'welcome_b', category: 'MARKETING', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'B' }] } });

  let r = await req('GET', `/workspaces/${adminWs}/templates?waNumberId=${numA.id}`, { token: admin.accessToken });
  check('templates filtered to number A only', r.status === 200 && r.data.length === 1 && r.data[0].id === tA.id, `got ${r.data.map(t=>t.name)}`);
  r = await req('GET', `/workspaces/${adminWs}/templates?waNumberId=${numB.id}`, { token: admin.accessToken });
  check('templates filtered to number B only', r.status === 200 && r.data.length === 1 && r.data[0].id === tB.id);
  r = await req('GET', `/workspaces/${adminWs}/templates`, { token: admin.accessToken });
  check('unfiltered list returns both numbers templates', r.data.length >= 2);
  r = await req('POST', `/workspaces/${adminWs}/campaigns`, { token: admin.accessToken, body: { name: 'X', templateId: tA.id, numberId: numB.id } });
  check('campaign rejects template/number mismatch (400)', r.status === 400, JSON.stringify(r.data));
  r = await req('POST', `/workspaces/${adminWs}/campaigns`, { token: admin.accessToken, body: { name: 'Y', templateId: tA.id, numberId: numA.id } });
  check('campaign accepts matching template/number', r.status === 201);
}

console.log('\n\u25a0 Campaign advanced config (bug #5)');
{
  const num = await prisma.waNumber.findFirst({ where: { workspaceId: adminWs } });
  const tpl = await prisma.template.findFirst({ where: { workspaceId: adminWs, waNumberId: num.id } });
  const r = await req('POST', `/workspaces/${adminWs}/campaigns`, {
    token: admin.accessToken,
    body: { name: 'Config Test', templateId: tpl.id, numberId: num.id,
      replyRules: [{ id: 'r1', triggerType: 'contains', keyword: 'STOP', actionType: 'optout' }],
      retryConfig: { active: true, pattern: 'smart' }, trackingConfig: { utmEnabled: true, utm: { source: 'wa' } } },
  });
  check('campaign create accepts advanced config', r.status === 201);
  const camp = await prisma.campaign.findUnique({ where: { id: r.data.id } });
  check('replyRules persisted', Array.isArray(camp.replyRules) && camp.replyRules[0].keyword === 'STOP');
  check('retryConfig persisted', camp.retryConfig?.pattern === 'smart');
  check('trackingConfig persisted', camp.trackingConfig?.utmEnabled === true);
}

console.log('\n\u25a0 AI onboarding (bug #1)');
{
  let r = await req('POST', '/onboarding/chat', { token: admin.accessToken, body: { message: 'build a workflow that replies HELP when someone says HELP', workspaceId: adminWs, guided: false } });
  check('AI workflow intent returns Workflow Created card', r.status === 200 && r.data.card?.title === 'Workflow Created', JSON.stringify(r.data).slice(0,160));
  const wf = await prisma.workflow.findFirst({ where: { workspaceId: adminWs }, orderBy: { createdAt: 'desc' } });
  check('a real Workflow row was created', !!wf && Array.isArray(wf.nodes) && wf.nodes.length >= 2);
  const trig = await prisma.automationTrigger.findFirst({ where: { workspaceId: adminWs } });
  check('a real AutomationTrigger registered for the keyword', !!trig && trig.keyword);
  r = await req('POST', '/onboarding/chat', { token: admin.accessToken, body: { message: 'create a template for abandoned cart', workspaceId: adminWs, guided: false } });
  check('AI one-shot template responds', r.status === 200);
  const aiTpl = await prisma.template.findFirst({ where: { workspaceId: adminWs, aiGenerated: true, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
  check('AI template is PENDING (never fake-APPROVED)', !!aiTpl && aiTpl.status === 'PENDING');
}

console.log('\n\u25a0 Workflow simulation (bug #8)');
{
  const wf = await prisma.workflow.findFirst({ where: { workspaceId: adminWs }, orderBy: { createdAt: 'desc' } });
  let r = await req('POST', '/ai/workflow/execute', { token: admin.accessToken, body: { workflowId: wf.id, sampleMessage: 'random unrelated text' } });
  check('non-matching message reports ran:false honestly', r.status === 200 && r.data.ran === false && r.data.reason, JSON.stringify(r.data).slice(0,160));
  const empty = await prisma.workflow.create({ data: { workspaceId: adminWs, name: 'Empty', nodes: [], edges: [] } });
  r = await req('POST', '/ai/workflow/execute', { token: admin.accessToken, body: { workflowId: empty.id } });
  check('empty workflow simulation is honest (ran:false)', r.status === 200 && r.data.ran === false);
  r = await req('POST', '/ai/workflow/execute', { token: admin.accessToken, body: { workflowId: 'nonexistent' } });
  check('simulating unknown workflow → 404', r.status === 404);
}

console.log('\n\u25a0 Embedded Signup config (bug #2)');
{
  let r = await req('GET', `/workspaces/${adminWs}/whatsapp/embedded-signup/config`, { token: admin.accessToken });
  check('config endpoint returns appId + graphVersion', r.status === 200 && r.data.appId && r.data.graphVersion, JSON.stringify(r.data));
  r = await req('POST', `/workspaces/${adminWs}/whatsapp/embedded-signup`, { token: client.accessToken, body: { code: 'x', wabaId: 'w', phoneNumberId: 'p' } });
  check('CLIENT cannot complete embedded signup (403)', r.status === 403);
  r = await req('POST', `/workspaces/${adminWs}/whatsapp/embedded-signup`, { token: admin.accessToken, body: { code: 'x' } });
  check('embedded signup validates required fields (400)', r.status === 400);
}

console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n  V2 PASSED: ${pass}   FAILED: ${fail}`);
if (failures.length) { console.log('  Failures:'); failures.forEach(f => console.log('   -', f)); }
_server.close();
process.exit(fail ? 1 : 0);
