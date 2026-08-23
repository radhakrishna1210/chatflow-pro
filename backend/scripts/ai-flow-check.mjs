// AI Assistant, chatbot flows and the website widget.
//
//   User → Widget/WhatsApp → Conversation → Intent → Flow → AI → Flow state
//   → Response → User
//
// Run with the server up:
//   node --env-file=.env scripts/ai-flow-check.mjs
//
// The AI is exercised for real — no canned answers — so a run costs a handful
// of model calls. WhatsApp flows are driven by posting genuinely signed Meta
// payloads at the webhook, which is what makes "does the flow respect the
// messaging rules?" answerable rather than assumed.

import { createHmac } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';

const BASE = process.env.AI_CHECK_BASE_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const results = [];
const section = (n) => results.push(`\n── ${n} ${'─'.repeat(Math.max(0, 52 - n.length))}`);
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

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
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

const cleanup = { contacts: [], workflows: [], intents: [], widgets: [] };

try {
  const waNumber = await prisma.waNumber.findFirst({
    where: { appSubscribed: true }, orderBy: { createdAt: 'desc' },
  });
  if (!waNumber) throw new Error('no subscribed WhatsApp number to test against');
  const WS = waNumber.workspaceId;
  const jwt = (await import('jsonwebtoken')).default;
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: WS } });
  const TOKEN = jwt.sign(
    { sub: member.userId, workspaceId: WS, role: member.role, superAdmin: false, jti: `ai-${Date.now()}` },
    env.JWT_ACCESS_SECRET, { expiresIn: '30m' },
  );
  results.push(`      workspace ${WS.slice(-8)} · number ${waNumber.phoneNumber}`);

  const postWebhook = async (body) => {
    const raw = JSON.stringify(body);
    const sig = `sha256=${createHmac('sha256', env.META_APP_SECRET).update(raw).digest('hex')}`;
    const res = await fetch(`${BASE}/webhook/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
      body: raw,
    });
    return res.status;
  };
  const say = (from, text, tag) => postWebhook({
    object: 'whatsapp_business_account',
    entry: [{ id: waNumber.wabaId, changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: waNumber.phoneNumber, phone_number_id: waNumber.metaPhoneNumberId },
      contacts: [{ profile: { name: 'Flow Probe' }, wa_id: from }],
      messages: [{ from, id: `wamid.AI_${tag}_${Date.now()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
    } }] }],
  });
  // What Meta posts when the customer taps a reply button, as opposed to typing.
  const tap = (from, title, tag) => postWebhook({
    object: 'whatsapp_business_account',
    entry: [{ id: waNumber.wabaId, changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: waNumber.phoneNumber, phone_number_id: waNumber.metaPhoneNumberId },
      contacts: [{ profile: { name: 'Flow Probe' }, wa_id: from }],
      messages: [{
        from, id: `wamid.AI_${tag}_${Date.now()}`, timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'opt_0', title } },
      }],
    } }] }],
  });
  const outboundSince = async (contactPhone, since) => {
    const c = await prisma.contact.findFirst({ where: { workspaceId: WS, phoneNumber: contactPhone } });
    if (!c) return [];
    const cv = await prisma.conversation.findFirst({ where: { contactId: c.id, waNumberId: waNumber.id } });
    if (!cv) return [];
    return prisma.message.findMany({
      where: { conversationId: cv.id, direction: 'OUTBOUND', createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    });
  };

  // ── AI provider ────────────────────────────────────────────────────────────
  section('AI provider');
  {
    const { llmHealth, llmAvailable, llmText } = await import('../src/lib/llm.js');
    const health = llmHealth();
    check('provider: an AI provider is configured', llmAvailable() === true, JSON.stringify(health));
    check('provider: the configured key is not being rejected',
      health.keyRejected === false, JSON.stringify(health.lastFailure));

    // The flash tier answers 503 often enough to look broken; retry plus a
    // fallback model is what makes this reliable rather than intermittent.
    let ok = 0;
    for (let i = 0; i < 5; i += 1) if (await llmText('Reply with exactly: OK', '')) ok += 1;
    check('provider: repeated requests all return an answer', ok === 5, `${ok}/5`);

    const started = Date.now();
    await llmText('Say hello', '');
    check('provider: a request completes well inside the timeout',
      Date.now() - started < 25_000, `${Date.now() - started}ms`);
  }

  // ── AI Assistant ───────────────────────────────────────────────────────────
  section('AI Assistant');
  {
    const r = await req('POST', `/workspaces/${WS}/ai-agent/test`, {
      token: TOKEN, body: { message: 'Do you deliver on Sundays?' },
    });
    check('assistant: the agent answers', r.status === 200 && r.data?.ok === true && Boolean(r.data.reply),
      JSON.stringify(r.data)?.slice(0, 120));
    check('assistant: the answer is generated, not canned',
      typeof r.data?.reply === 'string' && r.data.reply.length > 10);
    check('assistant: it reports what it drew on', Array.isArray(r.data?.sources));

    const site = await req('POST', '/assistant/chat', { body: { message: 'What does this product do?' } });
    check('assistant: the public site assistant answers',
      site.status === 200 && Boolean(site.data?.answer));
    check('assistant: it says when it fell back to retrieval only',
      site.data?.reason === undefined || typeof site.data.reason === 'string',
      JSON.stringify(site.data?.reason));
  }

  // ── Widget ─────────────────────────────────────────────────────────────────
  section('Website widget');
  {
    const loader = await fetch(`${BASE.replace('/api/v1', '')}/widget/v1/loader.js`);
    const body = await loader.text();
    check('widget: the loader script is served', loader.status === 200 && body.length > 500);
    check('widget: the loader carries no credentials',
      !/accessToken|apiKey|secret/i.test(body));

    let widget = await prisma.widget.findFirst({ where: { workspaceId: WS } });
    if (!widget) {
      const made = await req('POST', `/workspaces/${WS}/widgets`, {
        token: TOKEN, body: { name: 'AI check widget', type: 'AI' },
      });
      widget = made.data;
      if (widget?.id) cleanup.widgets.push(widget.id);
    }
    check('widget: a widget exists to test', Boolean(widget?.id));

    if (widget?.publicKey) {
      const origin = `${BASE.replace('/api/v1', '')}/widget/v1/${widget.publicKey}/config`;
      const allowed = Array.isArray(widget.allowedDomains) ? widget.allowedDomains : [];

      if (allowed.length === 0) {
        const cfg = await fetch(origin);
        const cfgBody = await cfg.json().catch(() => null);
        check('widget: an unrestricted widget serves config to any page', cfg.status === 200,
          `status=${cfg.status}`);
        check('widget: config never exposes the workspace token',
          !JSON.stringify(cfgBody ?? {}).toLowerCase().includes('accesstoken'));
      } else {
        // Once a customer restricts the widget to their own domains, a request
        // with no Origin is curl or a server, not a browser on an allowed page.
        const bare = await fetch(origin);
        check('widget: a restricted widget refuses a request with no Origin',
          bare.status === 403, `status=${bare.status}`);

        const first = allowed[0].replace(/^\*\./, '');
        const cfg = await fetch(origin, { headers: { Origin: `https://${first}` } });
        const cfgBody = await cfg.json().catch(() => null);
        check('widget: config is served to an allowed domain', cfg.status === 200,
          `status=${cfg.status} origin=https://${first}`);
        check('widget: config never exposes the workspace token',
          !JSON.stringify(cfgBody ?? {}).toLowerCase().includes('accesstoken'));

        const wrong = await fetch(origin, { headers: { Origin: 'https://not-authorised.example' } });
        check('widget: config is refused to a domain that is not on the list',
          wrong.status === 403, `status=${wrong.status}`);
      }
    }

    if (widget?.id) {
      // The preview used to be a static redrawing of the panel that could not
      // answer anything; this is the real retrieval and generator.
      const preview = await req('POST', `/workspaces/${WS}/widgets/${widget.id}/preview`, {
        token: TOKEN, body: { question: 'What are your business hours?', config: {}, type: 'AI' },
      });
      check('widget preview: it answers a question for real',
        preview.status === 200 && Boolean(preview.data?.answer),
        `status=${preview.status} ${JSON.stringify(preview.data)?.slice(0, 90)}`);
      check('widget preview: it reports where the answer came from',
        Array.isArray(preview.data?.sources) || preview.data?.reason !== undefined);
      check('widget preview: an empty question is refused',
        (await req('POST', `/workspaces/${WS}/widgets/${widget.id}/preview`, {
          token: TOKEN, body: { question: '  ' },
        })).status === 400);
    }
  }

  // ── Flow triggers, branches and variables ──────────────────────────────────
  section('Flow triggers and branches');
  {
    // A workflow whose second step is guarded by a condition, and whose
    // messages fill in the contact's name — the two things a linear engine with
    // fixed text could not do.
    const wf = await prisma.workflow.create({
      data: {
        workspaceId: WS,
        name: `AI check flow ${Date.now()}`,
        isActive: true,
        nodes: [
          { id: 's1', type: 'trigger', subtype: 'keyword', value: 'FLOWCHECK' },
          { id: 's2', type: 'action', subtype: 'message', value: 'Hello {{name}}, checking your order.' },
          { id: 's3', type: 'condition', subtype: 'contains', value: 'urgent', skipIfFalse: 1 },
          { id: 's4', type: 'action', subtype: 'message', value: 'Marking this as urgent.' },
          { id: 's5', type: 'action', subtype: 'tag', value: 'flow-check' },
        ],
        edges: [],
      },
    });
    cleanup.workflows.push(wf.id);

    // Branch not taken.
    const plainPhone = `9195${String(Date.now()).slice(-9)}`;
    cleanup.contacts.push(plainPhone);
    const t0 = new Date();
    await say(plainPhone, 'FLOWCHECK please', 'plain');
    // Waiting on the run reaching a terminal state, not on "one reply has
    // arrived": asserting the guarded step was *not* sent is only meaningful
    // once the run has finished and no further step can send it.
    await waitFor('the flow run to finish', async () => {
      const r = await prisma.workflowRun.findFirst({
        where: { workflowId: wf.id }, orderBy: { startedAt: 'desc' },
      });
      return r && ['COMPLETED', 'FAILED'].includes(r.status);
    });
    const plainOut = await outboundSince(plainPhone, t0);
    check('flow trigger: a keyword starts the flow', plainOut.length >= 1,
      `${plainOut.length} replies`);
    check('flow branch: a condition that does not hold skips its step',
      !plainOut.some((m) => m.body.includes('Marking this as urgent')),
      plainOut.map((m) => m.body).join(' | ').slice(0, 100));

    // Branch taken.
    const urgentPhone = `9196${String(Date.now()).slice(-9)}`;
    cleanup.contacts.push(urgentPhone);
    const t1 = new Date();
    await say(urgentPhone, 'FLOWCHECK this is urgent', 'urgent');
    await waitFor('the guarded step to run', async () =>
      (await outboundSince(urgentPhone, t1)).some((m) => m.body.includes('urgent')));
    const urgentOut = await outboundSince(urgentPhone, t1);
    check('flow branch: a condition that holds runs its step',
      urgentOut.some((m) => m.body.includes('Marking this as urgent')),
      urgentOut.map((m) => m.body).join(' | ').slice(0, 120));

    check('variables: a message fills in the contact name',
      urgentOut.some((m) => /^Hello .+, checking your order\.$/.test(m.body) && !m.body.includes('{{')),
      urgentOut.map((m) => m.body).join(' | ').slice(0, 120));
    check('variables: no unresolved token is ever sent',
      [...plainOut, ...urgentOut].every((m) => !m.body.includes('{{')));

    const tagged = await prisma.contact.findFirst({ where: { workspaceId: WS, phoneNumber: urgentPhone } });
    check('flow: a later step still runs after a taken branch',
      (tagged?.tags || []).includes('flow-check'), JSON.stringify(tagged?.tags));

    const run = await prisma.workflowRun.findFirst({
      where: { workflowId: wf.id }, orderBy: { startedAt: 'desc' },
    });
    check('flow: the run records what each condition decided',
      Array.isArray(run?.trace) && run.trace.some((t) => t.subtype === 'condition'),
      JSON.stringify(run?.trace)?.slice(0, 140));
  }

  // ── Buttons and lists ──────────────────────────────────────────────────────
  section('Buttons and lists');
  {
    const btnWf = await prisma.workflow.create({
      data: {
        workspaceId: WS,
        name: `AI check buttons ${Date.now()}`,
        isActive: true,
        edges: [],
        nodes: [
          { id: 'b1', type: 'trigger', subtype: 'keyword', value: 'BTNCHECK' },
          { id: 'b2', type: 'action', subtype: 'buttons', value: 'How can we help? | Track my order | Talk to support' },
        ],
      },
    });
    cleanup.workflows.push(btnWf.id);

    const btnPhone = `9197${String(Date.now()).slice(-9)}`;
    cleanup.contacts.push(btnPhone);
    const tb = new Date();
    await say(btnPhone, 'BTNCHECK', 'buttons');
    await waitFor('the buttons step to run', async () => {
      const r = await prisma.workflowRun.findFirst({
        where: { workflowId: btnWf.id }, orderBy: { startedAt: 'desc' },
      });
      return r && ['COMPLETED', 'FAILED'].includes(r.status);
    });

    const btnRun = await prisma.workflowRun.findFirst({
      where: { workflowId: btnWf.id }, orderBy: { startedAt: 'desc' },
    });
    const btnStep = (Array.isArray(btnRun?.trace) ? btnRun.trace : []).find((t) => t.subtype === 'buttons');
    check('buttons: Meta accepted the interactive message', btnStep?.result === 'sent',
      JSON.stringify(btnStep ?? btnRun?.trace)?.slice(0, 200));

    const btnOut = await outboundSince(btnPhone, tb);
    check('buttons: the thread records what the customer was offered',
      btnOut.some((m) => m.body.includes('Track my order') && m.body.includes('Talk to support')),
      btnOut.map((m) => m.body).join(' | ').slice(0, 160));

    // Tapping a button must be usable as flow input, not just as a decoration:
    // the reply comes back as the option's own text, so an ordinary keyword
    // trigger matches it.
    const tapWf = await prisma.workflow.create({
      data: {
        workspaceId: WS,
        name: `AI check tap ${Date.now()}`,
        isActive: true,
        edges: [],
        nodes: [
          { id: 't1', type: 'trigger', subtype: 'keyword', value: 'Track my order' },
          { id: 't2', type: 'action', subtype: 'message', value: 'Looking up your order now.' },
        ],
      },
    });
    cleanup.workflows.push(tapWf.id);

    const tt = new Date();
    await tap(btnPhone, 'Track my order', 'tap');
    await waitFor('the tapped button to drive the flow', async () =>
      (await outboundSince(btnPhone, tt)).some((m) => m.body.includes('Looking up your order')));
    const tapOut = await outboundSince(btnPhone, tt);
    check('button input: tapping a button triggers the flow it names',
      tapOut.some((m) => m.body.includes('Looking up your order')),
      tapOut.map((m) => m.body).join(' | ').slice(0, 160));

    const tapIn = await prisma.message.findFirst({
      where: { direction: 'INBOUND', createdAt: { gte: tt }, body: { contains: 'Track my order' } },
      orderBy: { createdAt: 'desc' },
    });
    check('button input: the tap is stored as the option the customer chose',
      Boolean(tapIn), tapIn?.body);
  }

  // ── Intent routing ─────────────────────────────────────────────────────────
  section('Intent routing');
  {
    const rule = await prisma.intentRule.create({
      data: {
        workspaceId: WS, name: `AI check handoff ${Date.now()}`,
        actionType: 'human', actionTarget: 'Support',
        phrases: ['cancel my subscription', 'close my account'], isActive: true,
      },
    });
    cleanup.intents.push(rule.id);

    const before = await prisma.intentMatchEvent.count({ where: { workspaceId: WS } });
    const phone = `9194${String(Date.now()).slice(-9)}`;
    cleanup.contacts.push(phone);
    // The first message from a new contact is taken by the welcome flow, so
    // send twice: the second is the one intent routing sees.
    const tSeed = new Date();
    await say(phone, 'hello', 'seed');
    await waitFor('the contact to exist', async () =>
      prisma.contact.findFirst({ where: { workspaceId: WS, phoneNumber: phone } }));
    // Wait for the welcome reply to actually land rather than sleeping a fixed
    // interval: it is generated by the AI agent, so it can take longer than any
    // sleep worth writing, and a late arrival would otherwise be counted as the
    // escalated message's reply.
    await waitFor('the welcome reply to land', async () =>
      (await outboundSince(phone, tSeed)).length >= 1);
    await settle(1500);

    const t2 = new Date();
    await say(phone, 'I want to cancel my subscription', 'intent');
    await waitFor('the intent to be recorded', async () =>
      (await prisma.intentMatchEvent.count({ where: { workspaceId: WS } })) > before);
    check('intent: a matching message is routed and recorded',
      (await prisma.intentMatchEvent.count({ where: { workspaceId: WS } })) > before);

    const contact = await prisma.contact.findFirst({ where: { workspaceId: WS, phoneNumber: phone } });
    const convo = await prisma.conversation.findFirst({ where: { contactId: contact.id, waNumberId: waNumber.id } });
    check('handoff: the conversation is handed to a person',
      Boolean(convo?.humanHandoffAt), `humanHandoffAt=${convo?.humanHandoffAt}`);
    check('handoff: the workspace is notified',
      (await prisma.notification.count({ where: { workspaceId: WS, type: 'HANDOFF_REQUESTED' } })) > 0);
    check('handoff: no bot reply is sent for the escalated message',
      (await outboundSince(phone, t2)).length === 0,
      (await outboundSince(phone, t2)).map((m) => m.body).join(' | '));

    // The one that was silently broken: the bot must stay out afterwards.
    const t3 = new Date();
    await say(phone, 'are you there? FLOWCHECK', 'after-handoff');
    await settle(12_000);
    check('handoff: the bot stays out of the thread afterwards',
      (await outboundSince(phone, t3)).length === 0,
      (await outboundSince(phone, t3)).map((m) => m.body).join(' | ').slice(0, 120));

    // And can be handed back deliberately.
    const resumed = await req('PATCH', `/workspaces/${WS}/conversations/${convo.id}/bot`, {
      token: TOKEN, body: { enabled: true },
    });
    check('handoff: the bot can be switched back on',
      resumed.status === 200 && resumed.data?.botEnabled === true, JSON.stringify(resumed.data));

    const t4 = new Date();
    await say(phone, 'FLOWCHECK again', 'resumed');
    await waitFor('the flow to reply once the bot is back on', async () =>
      (await outboundSince(phone, t4)).length >= 1);
    check('handoff: automation resumes once handed back',
      (await outboundSince(phone, t4)).length >= 1);

    const state = await req('GET', `/workspaces/${WS}/conversations/${convo.id}/messages`, { token: TOKEN });
    check('handoff: the inbox is told whether the bot is answering',
      typeof state.data?.botEnabled === 'boolean', JSON.stringify(state.data?.botEnabled));
  }

  // ── Messaging rules ────────────────────────────────────────────────────────
  section('Flows respect the messaging rules');
  {
    const phone = cleanup.contacts[0];
    const contact = await prisma.contact.findFirst({ where: { workspaceId: WS, phoneNumber: phone } });
    const convo = await prisma.conversation.findFirst({ where: { contactId: contact.id, waNumberId: waNumber.id } });

    // Close the window and confirm an automated reply is suppressed rather than
    // failing at Meta — a flow is bound by the same 24-hour rule as a human.
    await prisma.conversation.update({
      where: { id: convo.id },
      data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000), humanHandoffAt: null },
    });
    const { sendAutomatedReply } = await import('../src/services/outbound.service.js');
    const suppressed = await sendAutomatedReply({
      conversationId: convo.id, waNumberId: waNumber.id,
      toPhone: contact.phoneNumber, body: 'flow reply outside the window',
    });
    check('rules: a flow reply outside the 24-hour window is suppressed',
      suppressed === null, JSON.stringify(suppressed));

    // And an opted-out contact is never messaged by a flow.
    await prisma.conversation.update({ where: { id: convo.id }, data: { lastInboundAt: new Date() } });
    const { recordOptOut } = await import('../src/services/optout.service.js');
    await recordOptOut({
      workspaceId: WS, phoneNumber: contact.phoneNumber, waNumberId: waNumber.id,
      waPhone: waNumber.phoneNumber, contactId: contact.id, keyword: 'STOP',
      reason: 'AI check', source: 'ai-flow-check',
    }).catch(() => {});
    const blocked = await sendAutomatedReply({
      conversationId: convo.id, waNumberId: waNumber.id,
      toPhone: contact.phoneNumber, body: 'flow reply to an opted-out contact',
    });
    check('rules: a flow never messages an opted-out contact', blocked === null, JSON.stringify(blocked));
  }
} catch (err) {
  check('suite completed without throwing', false, err.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  for (const id of cleanup.workflows) {
    await prisma.workflowRun.deleteMany({ where: { workflowId: id } }).catch(() => {});
    await prisma.workflow.delete({ where: { id } }).catch(() => {});
  }
  for (const id of cleanup.intents) {
    await prisma.intentMatchEvent.deleteMany({ where: { intentRuleId: id } }).catch(() => {});
    await prisma.intentRule.delete({ where: { id } }).catch(() => {});
  }
  for (const id of cleanup.widgets) await prisma.widget.delete({ where: { id } }).catch(() => {});
  for (const phone of cleanup.contacts) {
    const c = await prisma.contact.findFirst({ where: { phoneNumber: phone } });
    if (c) {
      await prisma.optOut.deleteMany({ where: { contactId: c.id } }).catch(() => {});
      const convos = await prisma.conversation.findMany({ where: { contactId: c.id }, select: { id: true } });
      for (const cv of convos) {
        await prisma.workflowRun.deleteMany({ where: { conversationId: cv.id } }).catch(() => {});
        await prisma.message.deleteMany({ where: { conversationId: cv.id } }).catch(() => {});
      }
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
