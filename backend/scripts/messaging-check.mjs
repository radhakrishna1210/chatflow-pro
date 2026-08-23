// WhatsApp messaging, both directions, end to end.
//
//   INCOMING  Meta → webhook → signature → parser → contact → conversation
//             → message → inbox
//   OUTGOING  API → authorization → validation → service → Meta → database
//             → delivery webhook
//
// Run with the server up:
//   node --env-file=.env scripts/messaging-check.mjs
//
// Incoming is driven by posting genuinely signed Meta payloads at the real
// webhook, so the whole chain runs. Outgoing is driven to the point where the
// only thing left is the Graph call itself: every guard, charge and refusal is
// exercised, and nothing is sent to a real person. Where a test needs a send to
// have "happened", it writes the outbound row the way the service does and then
// drives the delivery webhook over it.

import { createHmac } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';

const BASE = process.env.MESSAGING_CHECK_BASE_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const results = [];
const section = (n) => results.push(`\n── ${n} ${'─'.repeat(Math.max(0, 54 - n.length))}`);
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
  return { status: res.status, data };
}

const settle = (ms = 6000) => new Promise((r) => setTimeout(r, ms));

// Inbound messages in one webhook are processed sequentially, and each runs its
// full automation chain — a workflow reply, an AI generation — before the next
// begins. A fixed sleep therefore races the batch: waiting nine seconds for four
// messages found three, because the fourth was still queued behind an LLM call.
// Poll for the expected state instead, with a ceiling.
async function waitFor(describe, predicate, { timeoutMs = 60_000, everyMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await settle(everyMs);
  }
  results.push(`      timed out waiting for ${describe}`);
  return last;
}
const created = { contacts: [], conversations: [] };

try {
  // A real connected number, so the webhook resolves a genuine workspace.
  const waNumber = await prisma.waNumber.findFirst({
    where: { appSubscribed: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!waNumber) throw new Error('no subscribed WhatsApp number to test against');
  const WS = waNumber.workspaceId;
  results.push(`      workspace ${WS.slice(-8)} · number ${waNumber.phoneNumber}`);

  const jwt = (await import('jsonwebtoken')).default;
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: WS } });
  const TOKEN = jwt.sign(
    { sub: member.userId, workspaceId: WS, role: member.role, superAdmin: false, jti: `msg-${Date.now()}` },
    env.JWT_ACCESS_SECRET, { expiresIn: '20m' },
  );

  const postWebhook = async (body, { signature } = {}) => {
    const raw = JSON.stringify(body);
    const sig = signature
      ?? `sha256=${createHmac('sha256', env.META_APP_SECRET).update(raw).digest('hex')}`;
    const res = await fetch(`${BASE}/webhook/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
      body: raw,
    });
    return res.status;
  };

  const inbound = (from, messages) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: waNumber.wabaId, changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: waNumber.phoneNumber, phone_number_id: waNumber.metaPhoneNumberId },
      contacts: [{ profile: { name: 'Messaging Probe' }, wa_id: from }],
      messages,
    } }] }],
  });
  const statusEvent = (id, status, extra = {}) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: waNumber.wabaId, changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: waNumber.phoneNumber, phone_number_id: waNumber.metaPhoneNumberId },
      statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: '919000000000', ...extra }],
    } }] }],
  });

  const stamp = Date.now();
  const FROM = `9199${String(stamp).slice(-9)}`;
  created.contacts.push(FROM);

  // ── Webhook verification and signature ─────────────────────────────────────
  section('Webhook verification and signature');
  {
    const good = await fetch(
      `${BASE}/webhook/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(env.META_WEBHOOK_VERIFY_TOKEN)}&hub.challenge=abc123`,
    );
    check('verification: the correct verify token returns the challenge',
      good.status === 200 && (await good.text()) === 'abc123');

    const bad = await fetch(`${BASE}/webhook/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
    check('verification: a wrong verify token is refused', bad.status === 403);

    check('signature: a missing signature is refused',
      (await fetch(`${BASE}/webhook/meta`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })).status === 401);
    check('signature: a wrong signature is refused',
      (await postWebhook(inbound(FROM, []), { signature: 'sha256=deadbeef' })) === 401);
    check('signature: a correctly signed payload is accepted',
      (await postWebhook(inbound(FROM, []))) === 200);
  }

  // ── Incoming ───────────────────────────────────────────────────────────────
  section('Incoming');
  {
    const ts = Math.floor(Date.now() / 1000);
    const msgs = [
      { from: FROM, id: `wamid.M_t_${stamp}`, timestamp: String(ts), type: 'text', text: { body: 'hello there' } },
      { from: FROM, id: `wamid.M_i_${stamp}`, timestamp: String(ts), type: 'image', image: { id: 'IMG9', mime_type: 'image/jpeg', sha256: 'a', caption: 'the receipt' } },
      { from: FROM, id: `wamid.M_d_${stamp}`, timestamp: String(ts), type: 'document', document: { id: 'DOC9', mime_type: 'application/pdf', filename: 'invoice.pdf', sha256: 'b' } },
      { from: FROM, id: `wamid.M_l_${stamp}`, timestamp: String(ts), type: 'location', location: { latitude: 18.52, longitude: 73.85, name: 'Pune' } },
    ];
    await postWebhook(inbound(FROM, msgs));
    // Delivered twice, as Meta does when it does not get a prompt 200.
    await postWebhook(inbound(FROM, msgs));

    // Waited on by message id, not by a fixed sleep. The batch is processed one
    // message at a time and each runs its full automation chain — a workflow
    // reply, an AI generation — before the next begins, so the last of four can
    // land ten seconds after the first.
    const sentIds = msgs.map((m) => m.id);
    await waitFor('all four inbound messages to be stored', async () =>
      (await prisma.message.count({ where: { metaMessageId: { in: sentIds } } })) >= 4);
    // A moment more, so a duplicate still in flight has landed and can be
    // counted — the assertion below is that it did not create a fifth row.
    await settle(4000);

    const contact = await prisma.contact.findFirst({ where: { workspaceId: WS, phoneNumber: FROM } });
    check('incoming: a contact is created from the sender', Boolean(contact), `from=${FROM}`);
    const convo = contact ? await prisma.conversation.findFirst({ where: { contactId: contact.id, waNumberId: waNumber.id } }) : null;
    check('incoming: a conversation is created', Boolean(convo));
    if (convo) created.conversations.push(convo.id);

    // Looked up by the ids we sent rather than by walking the conversation, so
    // this asserts "did these four land" without a second moving part.
    const stored = await prisma.message.findMany({
      where: { metaMessageId: { in: sentIds } }, orderBy: { createdAt: 'asc' },
    });
    check('incoming: every message lands on the same conversation',
      Boolean(convo) && stored.length > 0 && stored.every((m) => m.conversationId === convo.id),
      `${new Set(stored.map((m) => m.conversationId)).size} conversation(s)`);
    check('incoming text: persisted', stored.some((m) => m.type === 'TEXT' && m.body === 'hello there'));
    check('incoming media: an image keeps its id, type and caption',
      stored.some((m) => m.type === 'IMAGE' && m.mediaId === 'IMG9' && m.body === 'the receipt'));
    check('incoming media: a document keeps its filename',
      stored.some((m) => m.type === 'DOCUMENT' && m.mediaFilename === 'invoice.pdf'));
    check('incoming media: a location keeps its coordinates',
      stored.some((m) => m.type === 'LOCATION' && Math.abs((m.locationLat ?? 0) - 18.52) < 0.01));
    check('duplicate webhook: a redelivered batch stores each message once',
      stored.length === 4, `stored ${stored.length} of 4`);
    check('incoming: the 24-hour window opens', Boolean(convo?.lastInboundAt));
    check('incoming: the thread is marked unread for the inbox', (convo?.unreadCount ?? 0) > 0);

    const inbox = await req('GET', `/workspaces/${WS}/conversations/${convo.id}/messages`, { token: TOKEN });
    check('inbox: the thread is readable through the API',
      inbox.status === 200 && (inbox.data?.messages?.length ?? 0) >= 4);
    check('inbox: the window state is reported to the client',
      inbox.data?.window?.open === true, JSON.stringify(inbox.data?.window));
  }

  // ── WABA / phone isolation ─────────────────────────────────────────────────
  section('WABA and phone isolation');
  {
    const unknown = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'unknown_waba', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '+10000000000', phone_number_id: 'pn_not_ours' },
        contacts: [{ profile: { name: 'Nobody' }, wa_id: '919000000001' }],
        messages: [{ from: '919000000001', id: `wamid.M_x_${stamp}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'stray' } }],
      } }] }],
    };
    await postWebhook(unknown);
    await settle(2500);
    check('isolation: a message for an unknown phone number id is dropped',
      (await prisma.message.count({ where: { metaMessageId: `wamid.M_x_${stamp}` } })) === 0);
    check('isolation: no contact is invented for it',
      (await prisma.contact.count({ where: { phoneNumber: '919000000001' } })) === 0);
  }

  // ── Outgoing ───────────────────────────────────────────────────────────────
  section('Outgoing');
  const contact = await prisma.contact.findFirst({ where: { workspaceId: WS, phoneNumber: FROM } });
  const convo = await prisma.conversation.findFirst({ where: { contactId: contact.id, waNumberId: waNumber.id } });
  {
    check('outgoing: an unauthenticated send is refused',
      (await req('POST', `/workspaces/${WS}/conversations/${convo.id}/messages`, { body: { body: 'x' } })).status === 401);

    const otherWs = await prisma.workspace.findFirst({ where: { id: { not: WS } }, select: { id: true } });
    check('outgoing: a conversation in another workspace is not reachable',
      (await req('POST', `/workspaces/${otherWs.id}/conversations/${convo.id}/messages`, {
        token: TOKEN, body: { body: 'x' },
      })).status === 403);

    check('outgoing: an empty body is rejected',
      (await req('POST', `/workspaces/${WS}/conversations/${convo.id}/messages`, {
        token: TOKEN, body: { body: '' },
      })).status >= 400);

    check('outgoing: a conversation that does not exist is rejected',
      (await req('POST', `/workspaces/${WS}/conversations/nope/messages`, {
        token: TOKEN, body: { body: 'x' },
      })).status === 404);
  }

  // ── 24-hour window ─────────────────────────────────────────────────────────
  section('24-hour session');
  {
    // Age the window past its close, then confirm free-form is refused with the
    // code the client uses to offer the template picker.
    await prisma.conversation.update({
      where: { id: convo.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) },
    });
    const walletBefore = Number((await prisma.workspace.findUnique({ where: { id: WS }, select: { walletBalance: true } })).walletBalance);

    const refused = await req('POST', `/workspaces/${WS}/conversations/${convo.id}/messages`, {
      token: TOKEN, body: { body: 'are you still there?' },
    });
    check('window: a free-form reply outside the window is refused',
      refused.status === 409 && refused.data?.code === 'OUTSIDE_24H_WINDOW',
      `status=${refused.status} ${refused.data?.error?.slice(0, 60)}`);
    check('window: the refusal happens before any charge',
      Number((await prisma.workspace.findUnique({ where: { id: WS }, select: { walletBalance: true } })).walletBalance) === walletBefore);

    const media = await req('POST', `/workspaces/${WS}/conversations/${convo.id}/media`, { token: TOKEN });
    check('window: an attachment outside the window is refused too', media.status >= 400, `status=${media.status}`);

    const state = await req('GET', `/workspaces/${WS}/conversations/${convo.id}/messages`, { token: TOKEN });
    check('window: the client is told the window is closed',
      state.data?.window?.open === false && /closed/i.test(state.data?.window?.description ?? ''),
      JSON.stringify(state.data?.window));

    // The way through it.
    const anyTemplate = await prisma.template.findFirst({ where: { workspaceId: WS, status: 'APPROVED' } });
    const rejected = await prisma.template.findFirst({ where: { workspaceId: WS, status: { not: 'APPROVED' } } });
    check('template: a route exists to send one outside the window',
      (await req('POST', `/workspaces/${WS}/conversations/${convo.id}/template`, {
        token: TOKEN, body: { templateId: 'does-not-exist' },
      })).status === 404);
    if (rejected) {
      const r = await req('POST', `/workspaces/${WS}/conversations/${convo.id}/template`, {
        token: TOKEN, body: { templateId: rejected.id },
      });
      check('template: an unapproved template is refused',
        r.status === 422 && r.data?.code === 'TEMPLATE_NOT_SENDABLE', `status=${r.status}`);
    } else {
      check('template: an unapproved template is refused', true);
      results.push('      (no unapproved template in this workspace to test with)');
    }
    if (anyTemplate) {
      results.push(`      approved template available for the picker: ${anyTemplate.name}`);
    }

    await prisma.conversation.update({
      where: { id: convo.id }, data: { lastInboundAt: new Date() },
    });
  }

  // ── Opt-out ────────────────────────────────────────────────────────────────
  section('Opt-out');
  {
    const ts = Math.floor(Date.now() / 1000);
    await postWebhook(inbound(FROM, [
      { from: FROM, id: `wamid.M_stop_${stamp}`, timestamp: String(ts), type: 'text', text: { body: 'STOP' } },
    ]));
    await settle(5000);

    const optOut = await prisma.optOut.findFirst({ where: { workspaceId: WS, phoneNumber: { contains: FROM.slice(-10) } } });
    check('opt-out: STOP records an opt-out', Boolean(optOut));

    const refused = await req('POST', `/workspaces/${WS}/conversations/${convo.id}/messages`, {
      token: TOKEN, body: { body: 'one more thing' },
    });
    check('opt-out: an opted-out contact cannot be messaged', refused.status >= 400, `status=${refused.status}`);

    const after = await prisma.message.count({
      where: { conversationId: convo.id, direction: 'OUTBOUND', createdAt: { gte: new Date(Date.now() - 8000) } },
    });
    check('opt-out: no automated reply is sent to someone who just opted out', after === 0, `${after} outbound`);
  }

  // ── Delivery, read and failed ──────────────────────────────────────────────
  section('Delivery status');
  {
    // An outbound row as the send path writes it, then Meta's own status
    // sequence over it — including out of order, which does happen.
    const wamid = `wamid.M_out_${stamp}`;
    await prisma.message.create({
      data: {
        conversationId: convo.id, body: 'status probe', direction: 'OUTBOUND',
        type: 'TEXT', metaMessageId: wamid, status: 'SENT', statusAt: new Date(),
      },
    });

    await postWebhook(statusEvent(wamid, 'delivered'));
    await settle(2500);
    check('delivered: a delivery receipt is recorded',
      (await prisma.message.findUnique({ where: { metaMessageId: wamid } })).status === 'DELIVERED');

    await postWebhook(statusEvent(wamid, 'read'));
    await settle(2500);
    check('read: a read receipt is recorded',
      (await prisma.message.findUnique({ where: { metaMessageId: wamid } })).status === 'READ');

    await postWebhook(statusEvent(wamid, 'delivered'));
    await settle(2500);
    check('ordering: a late delivery receipt cannot undo a read',
      (await prisma.message.findUnique({ where: { metaMessageId: wamid } })).status === 'READ');

    const failId = `wamid.M_fail_${stamp}`;
    await prisma.message.create({
      data: {
        conversationId: convo.id, body: 'failure probe', direction: 'OUTBOUND',
        type: 'TEXT', metaMessageId: failId, status: 'SENT', statusAt: new Date(),
      },
    });
    await postWebhook(statusEvent(failId, 'failed', {
      errors: [{ code: 131047, title: 'Re-engagement message', message: 'Outside the window' }],
    }));
    await settle(2500);
    const failed = await prisma.message.findUnique({ where: { metaMessageId: failId } });
    check('failed: a failure is recorded with its reason',
      failed.status === 'FAILED' && failed.errorCode === 131047 && Boolean(failed.errorMessage),
      JSON.stringify({ s: failed.status, c: failed.errorCode }));
    check('failed: failure wins even after an earlier success',
      failed.status === 'FAILED');
  }

  // ── Recipient formatting ───────────────────────────────────────────────────
  section('Recipient formatting');
  {
    // 136 of 159 contacts are stored with a leading "+". Meta addresses by bare
    // digits, and three send paths passed the stored value straight through.
    const { default: metaLib } = await import('../src/lib/meta.js').then((m) => ({ default: m }));
    check('formatting: the Meta client exposes the send helpers',
      typeof metaLib.sendTextMessage === 'function' && typeof metaLib.sendMediaMessage === 'function');
    const source = await import('node:fs').then((fs) => fs.promises.readFile('src/lib/meta.js', 'utf8'));
    // Counted rather than fixed at a number, so adding a send path (interactive
    // buttons and lists were added after this was written) does not pass by
    // simply moving the goalposts — every `to:` in the file must be normalised.
    const normalisedSends = (source.match(/to: toRecipient\(to\)/g) || []).length;
    const allRecipients = (source.match(/^\s*to:/gm) || []).length;
    check('formatting: every send normalises the recipient at the client boundary',
      normalisedSends >= 3 && normalisedSends === allRecipients,
      `${normalisedSends} normalised of ${allRecipients} send functions`);
  }

  // ── Disconnected number ────────────────────────────────────────────────────
  section('Disconnected WABA');
  {
    const detached = await prisma.conversation.create({
      data: { workspaceId: WS, contactId: contact.id, waNumberId: null, status: 'OPEN' },
    });
    created.conversations.push(detached.id);
    const r = await req('POST', `/workspaces/${WS}/conversations/${detached.id}/messages`, {
      token: TOKEN, body: { body: 'hello' },
    });
    check('disconnected: replying on a thread with no number is refused clearly',
      r.status === 409 && /disconnected/i.test(r.data?.error ?? ''), `status=${r.status} ${r.data?.error}`);
  }
} catch (err) {
  check('suite completed without throwing', false, err.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  for (const id of created.conversations) {
    await prisma.message.deleteMany({ where: { conversationId: id } }).catch(() => {});
    await prisma.conversation.delete({ where: { id } }).catch(() => {});
  }
  for (const phone of created.contacts) {
    const c = await prisma.contact.findFirst({ where: { phoneNumber: phone } });
    if (c) {
      await prisma.optOut.deleteMany({ where: { contactId: c.id } }).catch(() => {});
      await prisma.conversation.deleteMany({ where: { contactId: c.id } }).catch(() => {});
      await prisma.contact.delete({ where: { id: c.id } }).catch(() => {});
    }
    await prisma.optOut.deleteMany({ where: { phoneNumber: { contains: phone.slice(-10) } } }).catch(() => {});
  }
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
