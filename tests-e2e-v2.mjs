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

const { prisma } = await import('./backend/src/lib/prisma.js');

let admin, adminWs, client, superAdmin, superWs;

console.log('\n\u25a0 Cleanup previous fixture data (suite is not run against an ephemeral DB)');
{
  const fixtureEmails = [
    'v2admin@test.dev', 'v2client@test.dev', 'super@chatflow.test', 'otto@test.dev',
    'quota-admin@test.dev', 'quota-member@test.dev', 'pro-admin@test.dev',
    'billing-renew@test.dev', 'billing-cancel@test.dev',
  ];
  const users = await prisma.user.findMany({ where: { email: { in: fixtureEmails } }, include: { workspaceMembers: true } });
  const workspaceIds = [...new Set(users.flatMap(u => u.workspaceMembers.map(m => m.workspaceId)))];
  if (workspaceIds.length) await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.emailOtp.deleteMany({ where: { email: { in: fixtureEmails } } });
  await prisma.user.deleteMany({ where: { email: { in: fixtureEmails } } });
}

console.log('\n\u25a0 Setup');
{
  // Registration no longer creates a workspace — ADMIN comes only from
  // explicitly creating one via POST /workspaces.
  let r = await req('POST', '/auth/register', { body: { name: 'V2 Admin', email: 'v2admin@test.dev', password: 'password123' } });
  check('registration returns no workspace and a null role', r.data.workspace === null && r.data.user.role === null, JSON.stringify(r.data.user));
  r = await req('POST', '/workspaces', { token: r.data.accessToken, body: { name: 'V2 Admin Workspace' } });
  check('creating a workspace grants ADMIN', r.status === 201 && r.data.user.role === 'ADMIN' && r.data.workspace?.id, JSON.stringify(r.data).slice(0, 120));
  admin = r.data; adminWs = r.data.workspace.id;
  // Workspaces default to FREE (auto-provisioned on creation, README §12.4).
  // adminWs is used throughout this suite for unrelated bug-regression checks
  // (integrations, AI onboarding, workflows) that predate plan-gating and
  // assume unrestricted access — upgrade it to PRO so those keep testing what
  // they were written for. FREE-plan limit/feature-gate behavior itself is
  // covered separately below by the dedicated quotaWs/proWs fixtures.
  const proPlanForAdmin = await prisma.plan.findUnique({ where: { key: 'PRO' } });
  await prisma.subscription.update({ where: { workspaceId: adminWs }, data: { planId: proPlanForAdmin.id } });
  r = await req('POST', '/workspaces', { token: admin.accessToken, body: { name: 'Duplicate' } });
  check('second workspace for the same user rejected (409)', r.status === 409, `status=${r.status}`);
  r = await req('POST', '/auth/register', { body: { name: 'V2 Client', email: 'v2client@test.dev', password: 'password123' } });
  client = r.data;
  await req('POST', `/workspaces/${adminWs}/members/invite`, { token: admin.accessToken, body: { email: 'v2client@test.dev', role: 'CLIENT' } });
  r = await req('POST', '/auth/login', { body: { email: 'v2client@test.dev', password: 'password123' } });
  check('invited user logs in as CLIENT of the inviter workspace', r.data.user.role === 'CLIENT' && r.data.workspace?.id === adminWs, JSON.stringify(r.data.user));
  client = r.data;
  r = await req('POST', '/auth/register', { body: { name: 'Super', email: 'super@chatflow.test', password: 'password123' } });
  superAdmin = r.data;
  check('super admin registration flags superAdmin', superAdmin.user.superAdmin === true, JSON.stringify(superAdmin.user));
  r = await req('POST', '/workspaces', { token: superAdmin.accessToken, body: { name: 'Super Workspace' } });
  superAdmin = { ...superAdmin, ...r.data }; superWs = r.data.workspace.id;
  await prisma.subscription.update({ where: { workspaceId: superWs }, data: { planId: proPlanForAdmin.id } });
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
  r = await req('POST', '/auth/register/verify', { body: { email: 'otto@test.dev', code: knownCode } });
  check('correct OTP creates account + returns session without a workspace', r.status === 201 && r.data.accessToken && r.data.workspace === null && r.data.user.role === null, JSON.stringify(r.data).slice(0,120));
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
// NOTE: this fixture's "super admin" email doesn't match this environment's
// ADMIN_EMAIL (a real address, not the sandbox's super@chatflow.test), so
// isPlatformAdmin() never flags it and every super-admin-only call below
// legitimately 403s \u2014 pre-existing environment mismatch, unrelated to this
// phase's work. Wrapped in try/catch so its cascading failures (unguarded
// property access on 403 bodies) don't stop the rest of the suite from running.
try {
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
} catch (err) {
  fail++; failures.push('Super Admin platform section threw (pre-existing ADMIN_EMAIL mismatch)');
  console.log(`  \u2718 Super Admin platform section threw: ${err.message}`);
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

console.log('\n\u25a0 Subscription quota + wallet overage (README \u00a712.2/\u00a712.4)');
{
  const { consumeMessageCredit } = await import('./backend/src/services/subscription.service.js');
  const { encrypt } = await import('./backend/src/lib/encryption.js');

  let r = await req('POST', '/auth/register', { body: { name: 'Quota Admin', email: 'quota-admin@test.dev', password: 'password123' } });
  r = await req('POST', '/workspaces', { token: r.data.accessToken, body: { name: 'Quota Test Workspace' } });
  const quotaAdmin = r.data;
  const quotaWs = r.data.workspace.id;

  // Workspace creation now auto-provisions a FREE Subscription + UsageCounter
  // (README \u00a712.4) \u2014 just read what's already there.
  const freePlan = await prisma.plan.findUnique({ where: { key: 'FREE' } });
  const quotaSub = await prisma.subscription.findUnique({ where: { workspaceId: quotaWs } });
  const periodStart = quotaSub.currentPeriodStart;
  const periodEnd = quotaSub.currentPeriodEnd;

  const waNumber = await prisma.waNumber.create({
    data: { workspaceId: quotaWs, phoneNumber: '+15559990001', metaPhoneNumberId: 'PN_QUOTA', wabaId: 'WABA_QUOTA', encryptedAccessToken: encrypt('fake-token') },
  });
  const contact = await prisma.contact.create({
    data: { workspaceId: quotaWs, name: 'Quota Contact', phoneNumber: '+15559990002' },
  });
  const conversation = await prisma.conversation.create({
    data: { workspaceId: quotaWs, contactId: contact.id, waNumberId: waNumber.id },
  });

  // (a) FREE plan, messagesUsed at quota, wallet empty \u2192 manual send is blocked
  // before ever reaching Meta, since consumeMessageCredit runs first.
  await prisma.usageCounter.update({ where: { workspaceId_periodStart: { workspaceId: quotaWs, periodStart } }, data: { messagesUsed: freePlan.messageQuota } });
  r = await req('POST', `/workspaces/${quotaWs}/conversations/${conversation.id}/messages`, { token: quotaAdmin.accessToken, body: { type: 'text', body: 'hello' } });
  check('quota + wallet exhausted \u2192 manual send rejected (403)', r.status === 403 && /quota/i.test(r.data.error), JSON.stringify(r.data));
  const usageAfterA = await prisma.usageCounter.findUnique({ where: { workspaceId_periodStart: { workspaceId: quotaWs, periodStart } } });
  check('rejected send does not increment messagesUsed', usageAfterA.messagesUsed === freePlan.messageQuota, `messagesUsed=${usageAfterA.messagesUsed}`);

  // (b) After a wallet recharge, the same exhausted-quota workspace can pay
  // overage out of the wallet. The full HTTP path would still hit the real
  // Meta API past this point (no live WhatsApp credentials in this dev stack),
  // so this exercises consumeMessageCredit directly \u2014 the actual unit this
  // phase adds \u2014 rather than the network send that follows it.
  r = await req('POST', `/workspaces/${quotaWs}/wallet/recharge`, { token: quotaAdmin.accessToken, body: { amount: 10 } });
  check('wallet recharge for overage test succeeds', r.status === 200 && Number(r.data.balance) === 10, JSON.stringify(r.data));

  const creditB = await consumeMessageCredit(quotaWs, { reason: 'Message overage' });
  check('quota exhausted + wallet funded \u2192 consumeMessageCredit overflows to wallet', creditB.ok === true && creditB.source === 'WALLET', JSON.stringify(creditB));
  const walletDebitRow = await prisma.walletTransaction.findFirst({ where: { workspaceId: quotaWs, type: 'DEBIT' }, orderBy: { createdAt: 'desc' } });
  check('a WalletTransaction DEBIT row exists for the overage', !!walletDebitRow && Number(walletDebitRow.amount) === Number(freePlan.overageRatePerMsg), JSON.stringify(walletDebitRow));
  const wsAfterB = await prisma.workspace.findUnique({ where: { id: quotaWs }, select: { walletBalance: true } });
  check('wallet balance decremented by exactly the overage rate', Number(wsAfterB.walletBalance) === 10 - Number(freePlan.overageRatePerMsg), `balance=${wsAfterB.walletBalance}`);

  // (c) Quota not yet exhausted \u2192 consumes from the free quota, wallet untouched.
  await prisma.usageCounter.update({ where: { workspaceId_periodStart: { workspaceId: quotaWs, periodStart } }, data: { messagesUsed: 0 } });
  const creditC = await consumeMessageCredit(quotaWs, { reason: 'Message overage' });
  check('quota available \u2192 consumeMessageCredit draws from QUOTA', creditC.ok === true && creditC.source === 'QUOTA', JSON.stringify(creditC));
  const usageAfterC = await prisma.usageCounter.findUnique({ where: { workspaceId_periodStart: { workspaceId: quotaWs, periodStart } } });
  check('messagesUsed incremented', usageAfterC.messagesUsed === 1, `messagesUsed=${usageAfterC.messagesUsed}`);
  const wsAfterC = await prisma.workspace.findUnique({ where: { id: quotaWs }, select: { walletBalance: true } });
  check('wallet untouched when quota covers the send', Number(wsAfterC.walletBalance) === Number(wsAfterB.walletBalance), `balance=${wsAfterC.walletBalance}`);

  // \u2500\u2500 Plan limits + feature gating (README \u00a712.4) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Reuses quotaWs/quotaAdmin (FREE plan: memberLimit 1, contactLimit 100).

  // Member limit: quotaWs already has exactly 1 member (its ADMIN).
  r = await req('POST', '/auth/register', { body: { name: 'Quota Member', email: 'quota-member@test.dev', password: 'password123' } });
  r = await req('POST', `/workspaces/${quotaWs}/members/invite`, { token: quotaAdmin.accessToken, body: { email: 'quota-member@test.dev', role: 'CLIENT' } });
  check('FREE workspace at member limit \u2192 invite rejected (403)', r.status === 403 && r.data.code === 'PLAN_LIMIT_REACHED', JSON.stringify(r.data));

  // Contact limit: seed straight to the FREE cap (100) instead of 100 API calls.
  await prisma.contact.createMany({
    data: Array.from({ length: freePlan.contactLimit }, (_, i) => ({
      workspaceId: quotaWs, name: `Bulk ${i}`, phoneNumber: `+1555100${String(i).padStart(4, '0')}`,
    })),
  });
  r = await req('POST', `/workspaces/${quotaWs}/contacts`, { token: quotaAdmin.accessToken, body: { name: 'One Too Many', phoneNumber: '+15559998888' } });
  check('contact create past plan limit \u2192 rejected (403)', r.status === 403 && r.data.code === 'PLAN_LIMIT_REACHED', JSON.stringify(r.data));

  // Feature gating: FREE has no `workflows` feature flag.
  r = await req('GET', `/workspaces/${quotaWs}/workflows`, { token: quotaAdmin.accessToken });
  check('workflows endpoint on FREE \u2192 403 PLAN_FEATURE_LOCKED', r.status === 403 && r.data.code === 'PLAN_FEATURE_LOCKED' && r.data.feature === 'workflows', JSON.stringify(r.data));

  // Same endpoint on a PRO workspace (features.workflows === true) \u2192 allowed.
  r = await req('POST', '/auth/register', { body: { name: 'Pro Admin', email: 'pro-admin@test.dev', password: 'password123' } });
  r = await req('POST', '/workspaces', { token: r.data.accessToken, body: { name: 'Pro Test Workspace' } });
  const proAdmin = r.data;
  const proWs = r.data.workspace.id;
  const proPlan = await prisma.plan.findUnique({ where: { key: 'PRO' } });
  // Auto-provisioned as FREE on creation — upgrade to PRO for this check.
  await prisma.subscription.update({ where: { workspaceId: proWs }, data: { planId: proPlan.id } });

  r = await req('GET', `/workspaces/${proWs}/workflows`, { token: proAdmin.accessToken });
  check('workflows endpoint on PRO \u2192 200', r.status === 200, JSON.stringify(r.data));
}

console.log('\n\u25a0 Billing-cycle reset sweep (README \u00a712.6)');
{
  const { runBillingCycleSweep } = await import('./backend/src/services/subscription.service.js');
  const proPlan = await prisma.plan.findUnique({ where: { key: 'PRO' } });

  // \u2500\u2500 Renewal path, with a pending plan change applied on rollover \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  let r = await req('POST', '/auth/register', { body: { name: 'Billing Renew', email: 'billing-renew@test.dev', password: 'password123' } });
  r = await req('POST', '/workspaces', { token: r.data.accessToken, body: { name: 'Billing Renew Workspace' } });
  const renewWs = r.data.workspace.id;

  const subBefore = await prisma.subscription.findUnique({ where: { workspaceId: renewWs } });
  const oldPeriodStart = subBefore.currentPeriodStart;
  const oldPeriodEnd = subBefore.currentPeriodEnd;
  const cycleMs = oldPeriodEnd.getTime() - oldPeriodStart.getTime();
  const pastEnd = new Date(Date.now() - 60_000); // 1 minute in the past \u2192 due for rollover
  await prisma.subscription.update({
    where: { workspaceId: renewWs },
    data: { currentPeriodEnd: pastEnd, pendingPlanId: proPlan.id },
  });

  let result = await runBillingCycleSweep();
  check('sweep processed the overdue renewal subscription', result.processed >= 1 && result.renewed >= 1, JSON.stringify(result));

  const subAfter = await prisma.subscription.findUnique({ where: { workspaceId: renewWs } });
  check('period rolled forward by one cycle', subAfter.currentPeriodStart.getTime() === pastEnd.getTime()
    && subAfter.currentPeriodEnd.getTime() === pastEnd.getTime() + cycleMs, `start=${subAfter.currentPeriodStart} end=${subAfter.currentPeriodEnd}`);
  check('pending plan applied and cleared', subAfter.planId === proPlan.id && subAfter.pendingPlanId === null, JSON.stringify(subAfter));
  check('subscription stays ACTIVE after renewal', subAfter.status === 'ACTIVE');

  const newUsage = await prisma.usageCounter.findUnique({
    where: { workspaceId_periodStart: { workspaceId: renewWs, periodStart: subAfter.currentPeriodStart } },
  });
  check('a fresh UsageCounter exists for the new period', !!newUsage && newUsage.messagesUsed === 0, JSON.stringify(newUsage));

  const wsRenew = await prisma.workspace.findUnique({ where: { id: renewWs }, select: { walletBalance: true } });
  check('wallet balance untouched by renewal', Number(wsRenew.walletBalance) === 0, `balance=${wsRenew.walletBalance}`);

  // Idempotency: running the sweep again must not re-process this subscription.
  const resultAgain = await runBillingCycleSweep();
  const subAfterTwice = await prisma.subscription.findUnique({ where: { workspaceId: renewWs } });
  check('re-running the sweep is a no-op for an already-renewed subscription',
    subAfterTwice.currentPeriodStart.getTime() === subAfter.currentPeriodStart.getTime()
    && subAfterTwice.currentPeriodEnd.getTime() === subAfter.currentPeriodEnd.getTime(),
    JSON.stringify(resultAgain));

  // \u2500\u2500 Cancellation path \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  r = await req('POST', '/auth/register', { body: { name: 'Billing Cancel', email: 'billing-cancel@test.dev', password: 'password123' } });
  r = await req('POST', '/workspaces', { token: r.data.accessToken, body: { name: 'Billing Cancel Workspace' } });
  const cancelAdmin = r.data;
  const cancelWs = r.data.workspace.id;

  await prisma.subscription.update({
    where: { workspaceId: cancelWs },
    data: { currentPeriodEnd: new Date(Date.now() - 60_000), cancelAtPeriodEnd: true },
  });

  result = await runBillingCycleSweep();
  check('sweep processed the cancel-at-period-end subscription', result.cancelled >= 1, JSON.stringify(result));

  const cancelSub = await prisma.subscription.findUnique({ where: { workspaceId: cancelWs } });
  check('cancelAtPeriodEnd \u2192 status CANCELLED (no renewal)', cancelSub.status === 'CANCELLED', JSON.stringify(cancelSub));

  r = await req('GET', `/workspaces/${cancelWs}/contacts`, { token: cancelAdmin.accessToken });
  check('CANCELLED subscription blocks workspace access (403 SUBSCRIPTION_INACTIVE)', r.status === 403 && r.data.code === 'SUBSCRIPTION_INACTIVE', JSON.stringify(r.data));

  r = await req('GET', `/workspaces/${cancelWs}/subscription`, { token: cancelAdmin.accessToken });
  check('but GET /subscription stays reachable when cancelled', r.status === 200, JSON.stringify(r.data));
}

console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n  V2 PASSED: ${pass}   FAILED: ${fail}`);
if (failures.length) { console.log('  Failures:'); failures.forEach(f => console.log('   -', f)); }
_server.close();
process.exit(fail ? 1 : 0);
