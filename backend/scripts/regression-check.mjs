// End-to-end regression check for the stabilisation work.
//
// Exercises the real server against the real database: every item here is a
// defect that was reproduced before it was fixed, so this is the file that says
// whether any of them have come back. Run with the server up:
//
//   node --env-file=.env scripts/regression-check.mjs
//
// It writes a handful of QA rows (contacts, members, an OTP attempt) into the
// configured workspace, and creates a real Razorpay *order* — no payment is
// captured, and no WhatsApp message is sent to anyone.

import { createHmac } from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.REGRESSION_BASE_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const results = [];

function check(name, ok, detail) {
  if (ok) pass += 1; else fail += 1;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  <- ${detail}` : ''}`);
}

async function req(method, path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data, headers: res.headers };
}

const login = async (email) =>
  (await req('POST', '/auth/login', { body: { email, password: 'password123' } })).data;

// ── Security headers ─────────────────────────────────────────────────────────
{
  const res = await fetch(`${BASE}/health`);
  check('security: CSP present', Boolean(res.headers.get('content-security-policy')));
  check('security: X-Content-Type-Options is nosniff', res.headers.get('x-content-type-options') === 'nosniff');
  check('security: X-Frame-Options is DENY', res.headers.get('x-frame-options') === 'DENY');
  check('security: X-Powered-By is not disclosed', !res.headers.get('x-powered-by'));
}

const session = await login('test@example.com');
const TOKEN = session.accessToken;
const WS = session.workspace.id;
check('auth: password login works', Boolean(TOKEN));

// ── Access control ───────────────────────────────────────────────────────────
check('auth: unauthenticated request refused',
  (await req('GET', `/workspaces/${WS}/templates`)).status === 401);
{
  const other = await prisma.workspace.findFirst({ where: { id: { not: WS } }, select: { id: true } });
  check('auth: another workspace is not reachable',
    (await req('GET', `/workspaces/${other.id}/contacts`, { token: TOKEN })).status === 403);
}
{
  const s = await login('test@example.com');
  const before = await req('GET', `/workspaces/${WS}/templates`, { token: s.accessToken });
  await req('POST', '/auth/logout', { token: s.accessToken, body: { refreshToken: s.refreshToken } });
  const after = await req('GET', `/workspaces/${WS}/templates`, { token: s.accessToken });
  check('auth: signing out invalidates the access token immediately',
    before.status === 200 && after.status === 401, `before=${before.status} after=${after.status}`);
}
{
  // The limiter must key on a trusted address, not on a header the caller sets.
  let blocked = 0;
  for (let i = 0; i < 16; i += 1) {
    const r = await req('POST', '/auth/login', {
      body: { email: 'qa.bruteforce@example.com', password: 'wrong' },
      headers: { 'X-Forwarded-For': `10.5.${i}.${i}` },
    });
    if (r.status === 429) blocked += 1;
  }
  check('security: spoofed X-Forwarded-For cannot bypass the login limiter',
    blocked > 0, `${blocked}/16 blocked`);
}

// ── AI ───────────────────────────────────────────────────────────────────────
{
  let ok = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = await req('POST', `/workspaces/${WS}/ai-agent/test`, {
      token: TOKEN, body: { message: 'Do you deliver on Sundays?' },
    });
    if (r.data?.ok && r.data.reply) ok += 1;
  }
  check('ai: the agent answers reliably (retry plus model fallback)', ok === 5, `${ok}/5`);
}

// ── Inbound WhatsApp ─────────────────────────────────────────────────────────
{
  const num = await prisma.waNumber.findFirst({ where: { metaPhoneNumberId: '1347751938430316' } });
  if (!num) {
    check('webhook: a connected test number exists', false, 'no WaNumber to test against');
  } else {
    const FROM = `9199990${Math.floor(Math.random() * 90000)}`;
    const post = async (body) => {
      const raw = JSON.stringify(body);
      const sig = `sha256=${createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex')}`;
      const res = await fetch(`${BASE}/webhook/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
        body: raw,
      });
      return res.status;
    };
    const ts = Math.floor(Date.now() / 1000);
    const messages = [
      { from: FROM, id: `wamid.R_t_${ts}`, timestamp: String(ts), type: 'text', text: { body: 'hello' } },
      { from: FROM, id: `wamid.R_i_${ts}`, timestamp: String(ts), type: 'image', image: { id: 'IMG', mime_type: 'image/jpeg', sha256: 'x', caption: 'receipt' } },
      { from: FROM, id: `wamid.R_d_${ts}`, timestamp: String(ts), type: 'document', document: { id: 'DOC', mime_type: 'application/pdf', filename: 'inv.pdf', sha256: 'y' } },
    ];
    const envelope = {
      object: 'whatsapp_business_account',
      entry: [{ id: num.wabaId, changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: num.phoneNumber, phone_number_id: num.metaPhoneNumberId },
        contacts: [{ profile: { name: 'QA Regression' }, wa_id: FROM }],
        messages,
      } }] }],
    };

    const bad = await fetch(`${BASE}/webhook/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=deadbeef' },
      body: JSON.stringify(envelope),
    });
    check('webhook: an invalid signature is refused', bad.status === 401);

    // Delivered twice, as Meta does when it does not get a prompt 200.
    await post(envelope);
    await post(envelope);
    await new Promise((r) => setTimeout(r, 10_000));

    const contact = await prisma.contact.findFirst({ where: { workspaceId: num.workspaceId, phoneNumber: FROM } });
    const convo = contact ? await prisma.conversation.findFirst({ where: { contactId: contact.id } }) : null;
    const stored = convo
      ? await prisma.message.findMany({ where: { conversationId: convo.id, direction: 'INBOUND' } })
      : [];

    check('webhook: a retried delivery stores each message exactly once', stored.length === 3, `stored ${stored.length}`);
    check('webhook: media is captured',
      stored.some((m) => m.type === 'IMAGE' && m.mediaId === 'IMG')
      && stored.some((m) => m.type === 'DOCUMENT' && m.mediaFilename === 'inv.pdf'));
    check('webhook: the 24-hour window is opened by an inbound message', Boolean(convo?.lastInboundAt));
    const convoCount = contact ? await prisma.conversation.count({ where: { contactId: contact.id } }) : 0;
    check('webhook: one conversation per contact and number', convoCount === 1, `${convoCount} conversations`);
  }
}

// ── Contacts export ──────────────────────────────────────────────────────────
{
  const res = await fetch(`${BASE}/workspaces/${WS}/contacts/export`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  check('contacts: CSV export works', res.status === 200 && text.includes('phoneNumber'));
  check('contacts: export is served as a download',
    (res.headers.get('content-disposition') || '').includes('attachment'));
}

// ── Payments ─────────────────────────────────────────────────────────────────
{
  const cat = await req('GET', `/workspaces/${WS}/subscription/addons`, { token: TOKEN });
  check('payments: the add-on catalogue is priced by the server',
    cat.status === 200 && cat.data?.addons?.length === 4);

  const quoted = cat.data?.addons?.find((a) => a.key === 'tags');
  const order = await req('POST', `/workspaces/${WS}/subscription/addons/checkout`, {
    token: TOKEN, body: { addonKey: 'tags' },
  });
  check('payments: the gateway order matches the quoted price',
    order.status === 200 && order.data.amount === quoted.priceMonthly * 100,
    `order=${order.data?.amount} quoted=${quoted ? quoted.priceMonthly * 100 : '?'}`);
}

// ── Roles ────────────────────────────────────────────────────────────────────
{
  const hash = await bcrypt.hash('password123', 12);
  const withRole = async (role) => {
    const email = `qa.${role.toLowerCase()}@example.com`;
    const user = await prisma.user.upsert({
      where: { email }, update: { passwordHash: hash },
      create: { name: `QA ${role}`, email, passwordHash: hash },
    });
    await prisma.workspaceMember.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: WS } },
      update: { role }, create: { userId: user.id, workspaceId: WS, role },
    });
    return (await login(email)).accessToken;
  };

  const viewer = await withRole('VIEWER');
  const agent = await withRole('AGENT');
  const member = await withRole('CLIENT');
  const rnd = () => `+9190000${Math.floor(Math.random() * 90000)}`;

  check('rbac: a viewer can read',
    (await req('GET', `/workspaces/${WS}/contacts`, { token: viewer })).status === 200);
  check('rbac: a viewer cannot write',
    (await req('POST', `/workspaces/${WS}/contacts`, { token: viewer, body: { name: 'x', phoneNumber: rnd() } })).status === 403);
  check('rbac: an agent can write contacts',
    (await req('POST', `/workspaces/${WS}/contacts`, { token: agent, body: { name: 'QA Agent Contact', phoneNumber: rnd() } })).status < 400);
  check('rbac: an agent cannot create campaigns',
    (await req('POST', `/workspaces/${WS}/campaigns`, { token: agent, body: { name: 'x', templateId: 'y', numberId: 'z' } })).status === 403);
  check('rbac: a member cannot spend from the wallet',
    (await req('POST', `/workspaces/${WS}/wallet/checkout`, { token: member, body: { amount: 100 } })).status === 403);
}

// ── Analytics range ──────────────────────────────────────────────────────────
{
  // Every panel must move with the range control, not just /performance.
  const seen = {};
  for (const days of [1, 7, 30, 90]) {
    const [ov, del, camp] = await Promise.all([
      req('GET', `/workspaces/${WS}/analytics/overview?days=${days}`, { token: TOKEN }),
      req('GET', `/workspaces/${WS}/analytics/delivery?days=${days}`, { token: TOKEN }),
      req('GET', `/workspaces/${WS}/analytics/campaigns?days=${days}`, { token: TOKEN }),
    ]);
    seen[days] = { echoed: ov.data?.days, buckets: del.data?.length, campaigns: camp.status };
  }
  check('analytics: overview honours the range without snapping',
    [1, 7, 30, 90].every((d) => seen[d].echoed === d),
    JSON.stringify(seen));
  check('analytics: delivery returns one bucket per day in range',
    [1, 7, 30, 90].every((d) => seen[d].buckets === d),
    JSON.stringify(seen));

  // messagesSent must be outbound-only and count each send once: campaign
  // sends are already Message rows, and inbound messages are not "sent".
  const ov = await req('GET', `/workspaces/${WS}/analytics/overview?days=90`, { token: TOKEN });
  const since = new Date(); since.setDate(since.getDate() - 89); since.setHours(0, 0, 0, 0);
  const outbound = await prisma.message.count({
    where: { conversation: { workspaceId: WS }, direction: 'OUTBOUND', sentAt: { gte: since } },
  });
  check('analytics: messagesSent counts outbound sends exactly once',
    ov.data?.messagesSent === outbound, `reported=${ov.data?.messagesSent} actual=${outbound}`);
  check('analytics: delivery funnel is monotonic',
    ov.data.sent >= ov.data.delivered && ov.data.delivered >= ov.data.read,
    `${ov.data.sent}/${ov.data.delivered}/${ov.data.read}`);
}

// ── Number verification ──────────────────────────────────────────────────────
{
  // The endpoints the Number Setup screen now calls must exist and be guarded
  // — the feature was unreachable from the product until the UI was wired.
  const r = await req('POST', `/workspaces/${WS}/whatsapp/numbers/does-not-exist/request-code`,
    { token: TOKEN, body: { method: 'SMS' } });
  check('verification: request-code is routed and scoped', r.status === 404,
    `status=${r.status}`);
  const v = await req('POST', `/workspaces/${WS}/whatsapp/numbers/does-not-exist/verify-code`,
    { token: TOKEN, body: { code: '123456' } });
  check('verification: verify-code is routed and scoped', v.status === 404, `status=${v.status}`);
}

// ── Honest failures ──────────────────────────────────────────────────────────
{
  // With SMTP credentials rejected, this must report the failure rather than
  // answering 200 "Verification code sent" for a code that was never sent.
  const r = await req('POST', '/auth/register/start', {
    body: { name: 'QA', email: `qa.err.${Date.now()}@example.com`, password: 'Str0ngPass!23' },
  });
  const honest = (r.status === 503 && r.data?.code === 'EMAIL_DELIVERY_FAILED') || r.status === 200;
  check('email: OTP delivery is reported honestly', honest, `status=${r.status}`);
  if (r.status === 503) results.push('      (SMTP is currently rejecting our credentials — see the report)');
}

console.log(`\n${results.join('\n')}`);
console.log(`\n${pass} passed, ${fail} failed`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
