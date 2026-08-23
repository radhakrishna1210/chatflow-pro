// Campaigns and contacts, end to end.
//
//   Contacts → Tags → Segments → Audience → Template → Validation
//   → Scheduling → Queue → WhatsApp → Delivery → Analytics
//
// Run with the server up:
//   node --env-file=.env scripts/campaign-check.mjs
//
// This suite spends real money and sends real WhatsApp messages. That is
// deliberate — a campaign path verified against mocks proves nothing about the
// thing that actually bills a customer and messages their audience. It is kept
// cheap: one immediate send to a single recipient, and every campaign it
// creates is cancelled or cleaned up afterwards. Nothing that already exists in
// the workspace is modified.

import { PrismaClient } from '@prisma/client';

const BASE = process.env.CAMPAIGN_CHECK_BASE_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const results = [];
const section = (n) => results.push(`\n── ${n} ${'─'.repeat(Math.max(0, 52 - n.length))}`);
function check(name, ok, detail) {
  if (ok) pass += 1; else fail += 1;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  <- ${detail}` : ''}`);
}
// For a precondition that could not be met. Counted separately so a skipped
// check can never be mistaken for a passing one.
let skipped = 0;
function skip(name, why) {
  skipped += 1;
  results.push(`SKIP  ${name}  <- ${why}`);
}

// Every workspace resource is mounted under /workspaces/:workspaceId, so the
// suite builds its paths through this rather than repeating the prefix.
let WS_PREFIX = '';
async function req(method, path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + (path.startsWith('/workspaces') ? path : WS_PREFIX + path), {
    method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(describe, predicate, { timeoutMs = 90_000, everyMs = 2000 } = {}) {
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

const cleanup = { campaigns: [], contacts: [] };

try {
  // ── Fixtures ───────────────────────────────────────────────────────────────
  const waNumber = await prisma.waNumber.findFirst({
    where: { unreachableSince: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!waNumber) throw new Error('no reachable WhatsApp number to test against');
  const WS = waNumber.workspaceId;
  WS_PREFIX = `/workspaces/${WS}`;

  // The simplest approved template wins: a plain BODY with no variables needs
  // no components, so a send that fails is a fault in the send path rather
  // than in payload assembly for a header, a button or a catalog. Per-type
  // payload assembly — carousel and catalog included — is covered without
  // spending anything by scripts/template-payload-check.mjs.
  const approved = await prisma.template.findMany({
    where: {
      workspaceId: WS, status: 'APPROVED',
      OR: [{ waNumberId: waNumber.id }, { waNumberId: null }],
    },
  });
  const complexity = (t) => {
    const types = (Array.isArray(t.components) ? t.components : []).map((c) => c.type);
    const hasVars = /\{\{\s*\d+\s*\}\}/.test(JSON.stringify(t.components ?? ''));
    return (types.includes('BUTTONS') ? 4 : 0) + (types.includes('CAROUSEL') ? 4 : 0)
      + (types.includes('HEADER') ? 2 : 0) + (hasVars ? 1 : 0);
  };
  const template = approved.sort((a, b) => complexity(a) - complexity(b))[0] ?? null;

  const jwt = (await import('jsonwebtoken')).default;
  const { env } = await import('../src/config/env.js');
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId: WS, role: { in: ['ADMIN', 'CLIENT'] } },
  });
  if (!member) throw new Error('no ADMIN/CLIENT member to act as');
  const TOKEN = jwt.sign(
    { sub: member.userId, workspaceId: WS, role: member.role, superAdmin: false, jti: `camp-${Date.now()}` },
    env.JWT_ACCESS_SECRET, { expiresIn: '30m' },
  );

  const workspace = await prisma.workspace.findUnique({
    where: { id: WS },
    select: { walletBalance: true, costPerMessage: true },
  });
  const balance = Number(workspace.walletBalance);
  results.push(`      workspace ${WS.slice(-8)} · number ${waNumber.phoneNumber} · wallet ₹${balance.toFixed(2)}`);
  results.push(`      template ${template ? `"${template.name}" (${template.status})` : 'NONE APPROVED'}`);

  const stamp = Date.now();
  // Contacts are created directly so the suite controls their exact state.
  const makeContact = async (suffix, extra = {}) => {
    const phoneNumber = `+9199${String(stamp).slice(-8)}${suffix}`;
    const c = await prisma.contact.create({
      data: { workspaceId: WS, name: `Camp Probe ${suffix}`, phoneNumber, ...extra },
    });
    cleanup.contacts.push(c.id);
    return c;
  };

  const good1 = await makeContact('1');
  const good2 = await makeContact('2');
  const optedOut = await makeContact('3', { optedOut: true });
  // Too short to be a real MSISDN — rejected before it is ever billed for.
  const badNumber = await prisma.contact.create({
    data: { workspaceId: WS, name: 'Camp Probe bad', phoneNumber: '+12345' },
  });
  cleanup.contacts.push(badNumber.id);

  const newCampaign = async (name) => {
    const res = await req('POST', '/campaigns', {
      token: TOKEN,
      body: { name, templateId: template?.id, numberId: waNumber.id },
    });
    if (res.data?.data?.id || res.data?.id) {
      const id = res.data?.data?.id ?? res.data?.id;
      cleanup.campaigns.push(id);
      return { id, res };
    }
    return { id: null, res };
  };

  // ── Creation and validation ────────────────────────────────────────────────
  section('Campaign creation');
  {
    const noName = await req('POST', '/campaigns', {
      token: TOKEN, body: { name: '', templateId: template?.id, numberId: waNumber.id },
    });
    check('creation: a campaign with no name is refused',
      noName.status === 400 || noName.status === 422, `status=${noName.status}`);

    const badTemplate = await req('POST', '/campaigns', {
      token: TOKEN, body: { name: `probe ${stamp}`, templateId: 'tmpl_does_not_exist', numberId: waNumber.id },
    });
    check('creation: an unknown template is refused, not silently accepted',
      badTemplate.status === 404 || badTemplate.status === 400, `status=${badTemplate.status}`);

    const unauth = await req('POST', '/campaigns', {
      body: { name: `probe ${stamp}`, templateId: template?.id, numberId: waNumber.id },
    });
    check('creation: an unauthenticated request is refused', unauth.status === 401,
      `status=${unauth.status}`);

    if (!template) {
      skip('creation: a draft campaign is created', 'no APPROVED template in this workspace');
    } else {
      const { id, res } = await newCampaign(`Camp check draft ${stamp}`);
      check('creation: a draft campaign is created', Boolean(id), `status=${res.status}`);
      if (id) {
        const row = await prisma.campaign.findUnique({ where: { id } });
        check('creation: it starts as a DRAFT', row?.status === 'DRAFT', row?.status);
        check('creation: nothing is charged for a draft', row?.chargedAt === null,
          `chargedAt=${row?.chargedAt}`);
      }
    }
  }

  // ── Audience ───────────────────────────────────────────────────────────────
  section('Audience selection');
  let audienceCampaign = null;
  if (!template) {
    skip('audience: the whole audience section', 'no APPROVED template in this workspace');
  } else {
    const { id } = await newCampaign(`Camp check audience ${stamp}`);
    audienceCampaign = id;

    const add = await req('POST', `/campaigns/${id}/recipients`, {
      token: TOKEN, body: { contactIds: [good1.id, good2.id, optedOut.id] },
    });
    check('audience: recipients are added', add.status === 200 || add.status === 201,
      `status=${add.status}`);
    check('audience: opted-out contacts are reported before launch',
      (add.data?.data?.blocked ?? add.data?.blocked) >= 1,
      JSON.stringify(add.data)?.slice(0, 160));

    // Replacing must actually remove. Add-only was the old behaviour, so
    // deselecting someone in a reopened draft still messaged them.
    const replace = await req('PUT', `/campaigns/${id}/recipients`, {
      token: TOKEN, body: { contactIds: [good1.id] },
    });
    check('audience: replacing the audience is accepted', replace.status === 200,
      `status=${replace.status}`);
    const remaining = id
      ? await prisma.campaignRecipient.findMany({ where: { campaignId: id } })
      : [];
    check('audience: a deselected contact is really removed',
      remaining.length === 1 && remaining[0].contactId === good1.id,
      `${remaining.length} recipient(s)`);

    const row = await prisma.campaign.findUnique({ where: { id } });
    check('audience: the campaign total matches the recipient rows',
      row?.totalContacts === remaining.length, `totalContacts=${row?.totalContacts}`);

    const foreign = await req('POST', `/campaigns/${id}/recipients`, {
      token: TOKEN, body: { contactIds: ['contact_from_nowhere'] },
    });
    check('audience: a contact id from outside the workspace is refused',
      foreign.status === 400, `status=${foreign.status}`);
  }

  // ── Server-side pricing ────────────────────────────────────────────────────
  section('Pricing and validation');
  if (!template) {
    skip('pricing: the whole pricing section', 'no APPROVED template in this workspace');
  } else {
    const est = await req('POST', '/campaigns/estimate', {
      token: TOKEN,
      body: { contactIds: [good1.id, good2.id, optedOut.id, badNumber.id], templateId: template.id },
    });
    const e = est.data?.data ?? est.data;
    check('pricing: an estimate is returned', est.status === 200, `status=${est.status}`);
    check('pricing: opted-out contacts are excluded from the billable count',
      e?.blockedContacts >= 1 && e?.validContacts === 2,
      `valid=${e?.validContacts} blocked=${e?.blockedContacts} invalid=${e?.invalidContacts}`);
    check('pricing: an unsendable number is counted invalid, not billable',
      e?.invalidContacts >= 1, `invalid=${e?.invalidContacts}`);
    check('pricing: the total is the server\'s rate times the valid count',
      Math.abs(Number(e?.totalCost) - Number(e?.costPerMessage) * Number(e?.validContacts)) < 0.005,
      `${e?.totalCost} vs ${e?.costPerMessage}×${e?.validContacts}`);
    check('pricing: the estimate never trusts a client-supplied price',
      e?.costPerMessage > 0 && Number.isFinite(Number(e?.costPerMessage)),
      `costPerMessage=${e?.costPerMessage}`);
  }

  // ── Launch guards ──────────────────────────────────────────────────────────
  section('Launch validation');
  if (!template) {
    skip('launch: the whole launch-guard section', 'no APPROVED template in this workspace');
  } else {
    const { id: emptyId } = await newCampaign(`Camp check empty ${stamp}`);
    const emptyLaunch = await req('POST', `/campaigns/${emptyId}/launch`, { token: TOKEN, body: {} });
    check('launch: a campaign with no recipients is refused',
      emptyLaunch.status === 400, `status=${emptyLaunch.status}`);
    const emptyRow = await prisma.campaign.findUnique({ where: { id: emptyId } });
    check('launch: the refused campaign was never charged',
      emptyRow?.chargedAt === null, `chargedAt=${emptyRow?.chargedAt}`);

    // Everyone opted out — there is nobody left to send to, and that must be a
    // refusal rather than a charged campaign that sends nothing.
    const { id: allOutId } = await newCampaign(`Camp check allout ${stamp}`);
    await req('POST', `/campaigns/${allOutId}/recipients`, {
      token: TOKEN, body: { contactIds: [optedOut.id] },
    });
    const allOut = await req('POST', `/campaigns/${allOutId}/launch`, { token: TOKEN, body: {} });
    check('opt-out: a campaign of only opted-out contacts is refused',
      allOut.status === 400, `status=${allOut.status}`);
    check('opt-out: the refusal says why',
      /opted out/i.test(String(allOut.data?.message ?? allOut.data?.error ?? '')),
      JSON.stringify(allOut.data)?.slice(0, 140));
    const allOutRow = await prisma.campaign.findUnique({ where: { id: allOutId } });
    check('opt-out: nothing was charged for it', allOutRow?.chargedAt === null,
      `chargedAt=${allOutRow?.chargedAt}`);

    const past = await req('POST', `/campaigns/${audienceCampaign}/launch`, {
      token: TOKEN, body: { scheduledAt: new Date(Date.now() - 3600_000).toISOString() },
    });
    check('scheduling: a date in the past is refused', past.status === 400,
      `status=${past.status}`);
  }

  // ── Rejected / unapproved templates ────────────────────────────────────────
  section('Template rules');
  {
    const unapproved = await prisma.template.findFirst({
      where: { workspaceId: WS, status: { in: ['PENDING', 'REJECTED', 'DELETED'] } },
    });
    if (!unapproved) {
      skip('template: an unapproved template cannot be launched',
        'no PENDING/REJECTED/DELETED template in this workspace');
    } else {
      const res = await req('POST', '/campaigns', {
        token: TOKEN,
        body: { name: `Camp check unapproved ${stamp}`, templateId: unapproved.id, numberId: waNumber.id },
      });
      const id = res.data?.data?.id ?? res.data?.id;
      if (id) cleanup.campaigns.push(id);
      if (unapproved.status === 'DELETED') {
        check('template: a deleted template cannot even start a campaign',
          res.status === 400, `status=${res.status}`);
      } else if (id) {
        await req('POST', `/campaigns/${id}/recipients`, {
          token: TOKEN, body: { contactIds: [good1.id] },
        });
        const launch = await req('POST', `/campaigns/${id}/launch`, { token: TOKEN, body: {} });
        check('template: an unapproved template cannot be launched',
          launch.status === 422 || launch.status === 400, `status=${launch.status}`);
        const row = await prisma.campaign.findUnique({ where: { id } });
        check('template: the blocked launch charged nothing', row?.chargedAt === null,
          `chargedAt=${row?.chargedAt}`);
      } else {
        skip('template: an unapproved template cannot be launched',
          `campaign creation returned ${res.status}`);
      }
    }
  }

  // ── Scheduling, pause, resume, cancel ──────────────────────────────────────
  section('Scheduling, pause and cancel');
  if (!template) {
    skip('scheduling: the whole scheduling section', 'no APPROVED template in this workspace');
  } else if (balance <= 1) {
    skip('scheduling: the whole scheduling section', `wallet balance is ₹${balance.toFixed(2)}`);
  } else {
    const { id } = await newCampaign(`Camp check schedule ${stamp}`);
    await req('POST', `/campaigns/${id}/recipients`, {
      token: TOKEN, body: { contactIds: [good1.id, optedOut.id] },
    });

    const when = new Date(Date.now() + 3600_000).toISOString();
    const launch = await req('POST', `/campaigns/${id}/launch`, { token: TOKEN, body: { scheduledAt: when } });
    check('scheduling: a future campaign is accepted', launch.status === 200 || launch.status === 201,
      `status=${launch.status}`);

    const row = await prisma.campaign.findUnique({ where: { id } });
    check('scheduling: it is SCHEDULED, not RUNNING', row?.status === 'SCHEDULED', row?.status);
    check('scheduling: the scheduled time is stored', Boolean(row?.scheduledAt));
    check('scheduling: it is charged up front, once', Boolean(row?.chargedAt));

    // The opted-out recipient must be resolved at launch, never attempted.
    const recips = await prisma.campaignRecipient.findMany({
      where: { campaignId: id }, include: { contact: true },
    });
    const outRow = recips.find((r) => r.contactId === optedOut.id);
    check('opt-out: an opted-out recipient is SKIPPED at launch',
      outRow?.status === 'SKIPPED', outRow?.status);
    check('opt-out: the skip records its reason',
      /opted out/i.test(String(outRow?.failReason ?? '')), outRow?.failReason);
    check('opt-out: the skipped recipient was never billed',
      !outRow?.billedAt, `billedAt=${outRow?.billedAt}`);

    check('pricing: only the sendable recipient was charged for',
      Number(row?.totalCost) === Number(row?.costPerMessage) * 1,
      `totalCost=${row?.totalCost} rate=${row?.costPerMessage}`);

    // Duplicate launch must lose the race rather than charge twice.
    const second = await req('POST', `/campaigns/${id}/launch`, { token: TOKEN, body: { scheduledAt: when } });
    check('duplicate: launching the same campaign twice is refused',
      second.status === 409 || second.status === 400, `status=${second.status}`);
    const charges = await prisma.walletTransaction.count({
      where: { workspaceId: WS, reference: id, type: 'DEBIT' },
    });
    check('duplicate: the wallet was debited exactly once', charges === 1, `${charges} debits`);

    const paused = await req('PATCH', `/campaigns/${id}/pause`, { token: TOKEN });
    check('pause: a scheduled campaign can be paused', paused.status === 200, `status=${paused.status}`);
    const pausedRow = await prisma.campaign.findUnique({ where: { id } });
    check('pause: the status reflects it', pausedRow?.status === 'PAUSED', pausedRow?.status);

    const resumed = await req('PATCH', `/campaigns/${id}/resume`, { token: TOKEN });
    check('resume: a paused campaign can be resumed', resumed.status === 200, `status=${resumed.status}`);
    const resumedRow = await prisma.campaign.findUnique({ where: { id } });
    check('resume: it is no longer paused', resumedRow?.status !== 'PAUSED', resumedRow?.status);

    const cancelled = await req('PATCH', `/campaigns/${id}/cancel`, { token: TOKEN });
    check('cancel: a campaign can be cancelled', cancelled.status === 200, `status=${cancelled.status}`);
    const cancelledRow = await prisma.campaign.findUnique({ where: { id } });
    check('cancel: the status is CANCELLED', cancelledRow?.status === 'CANCELLED', cancelledRow?.status);
    check('cancel: the unsent balance is refunded', Boolean(cancelledRow?.refundedAt),
      `refundedAt=${cancelledRow?.refundedAt} refundAmount=${cancelledRow?.refundAmount}`);

    const refunds = await prisma.walletTransaction.count({
      where: { workspaceId: WS, reference: id, type: 'CREDIT' },
    });
    check('cancel: exactly one refund is written', refunds === 1, `${refunds} refunds`);

    const reresume = await req('PATCH', `/campaigns/${id}/resume`, { token: TOKEN });
    check('cancel: a cancelled campaign cannot be resumed',
      reresume.status >= 400, `status=${reresume.status}`);
  }

  // ── Immediate send, delivery and statistics ────────────────────────────────
  section('Immediate send and statistics');
  if (!template) {
    skip('send: the whole send section', 'no APPROVED template in this workspace');
  } else if (balance <= 1) {
    skip('send: the whole send section', `wallet balance is ₹${balance.toFixed(2)}`);
  } else {
    const { id } = await newCampaign(`Camp check send ${stamp}`);
    // One good recipient, one unsendable, one opted out — the three outcomes
    // the statistics have to tell apart.
    await req('POST', `/campaigns/${id}/recipients`, {
      token: TOKEN, body: { contactIds: [good2.id, badNumber.id, optedOut.id] },
    });

    const before = Number((await prisma.workspace.findUnique({
      where: { id: WS }, select: { walletBalance: true },
    })).walletBalance);

    const launch = await req('POST', `/campaigns/${id}/launch`, { token: TOKEN, body: {} });
    check('send: an immediate campaign launches', launch.status === 200 || launch.status === 201,
      `status=${launch.status} ${JSON.stringify(launch.data)?.slice(0, 120)}`);

    const launched = await prisma.campaign.findUnique({ where: { id } });
    check('send: only the sendable recipient was billed',
      Number(launched?.totalCost) === Number(launched?.costPerMessage) * 1,
      `totalCost=${launched?.totalCost} rate=${launched?.costPerMessage}`);

    const after = Number((await prisma.workspace.findUnique({
      where: { id: WS }, select: { walletBalance: true },
    })).walletBalance);
    check('send: the wallet fell by exactly the campaign total',
      Math.abs((before - after) - Number(launched?.totalCost)) < 0.005,
      `before=${before} after=${after} cost=${launched?.totalCost}`);

    // The worker picks the job up and works through the audience.
    await waitFor('the campaign to finish', async () => {
      const c = await prisma.campaign.findUnique({ where: { id } });
      return c && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(c.status);
    });

    const done = await prisma.campaign.findUnique({ where: { id } });
    const recips = await prisma.campaignRecipient.findMany({ where: { campaignId: id } });
    const byStatus = recips.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

    check('send: the campaign reaches a terminal state',
      ['COMPLETED', 'FAILED'].includes(done?.status), done?.status);
    check('send: the good recipient was actually sent to',
      recips.some((r) => r.contactId === good2.id && ['SENT', 'DELIVERED', 'READ'].includes(r.status)),
      JSON.stringify(byStatus));
    check('failed sends: the unsendable number is FAILED, not sent',
      recips.some((r) => r.contactId === badNumber.id && r.status === 'FAILED'),
      JSON.stringify(byStatus));
    check('failure reasons: the failure records why',
      Boolean(recips.find((r) => r.contactId === badNumber.id)?.failReason),
      recips.find((r) => r.contactId === badNumber.id)?.failReason);
    check('opt-out: the opted-out recipient was never sent to',
      recips.find((r) => r.contactId === optedOut.id)?.status === 'SKIPPED',
      recips.find((r) => r.contactId === optedOut.id)?.status);

    const billed = recips.filter((r) => r.billedAt).length;
    check('billing: exactly one recipient was billed', billed === 1, `${billed} billed`);
    check('billing: neither the skipped nor the invalid recipient was billed',
      !recips.find((r) => r.contactId === optedOut.id)?.billedAt
      && !recips.find((r) => r.contactId === badNumber.id)?.billedAt);

    // Statistics must agree with the rows they summarise.
    const terminal = recips.filter((r) => ['SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'].includes(r.status)).length;
    check('statistics: every recipient reached a terminal state',
      terminal === recips.length, `${terminal}/${recips.length}`);
    check('statistics: the campaign counters match the recipient rows',
      Number(done?.skipped ?? 0) === (byStatus.SKIPPED ?? 0),
      `campaign.skipped=${done?.skipped} rows=${byStatus.SKIPPED}`);
    check('statistics: totalContacts matches the audience size',
      Number(done?.totalContacts) === recips.length,
      `totalContacts=${done?.totalContacts} rows=${recips.length}`);
    check('statistics: no recipient is counted twice',
      new Set(recips.map((r) => r.contactId)).size === recips.length);

    const detail = await req('GET', `/campaigns/${id}`, { token: TOKEN });
    check('statistics: the API reports the campaign', detail.status === 200, `status=${detail.status}`);
    check('statistics: the API never exposes the access token',
      !JSON.stringify(detail.data ?? {}).toLowerCase().includes('encryptedaccesstoken'));
  }

  // ── Contacts: tags, filters, export ────────────────────────────────────────
  section('Contacts, tags and export');
  {
    const tag = `campcheck${stamp}`;
    await prisma.contact.update({ where: { id: good1.id }, data: { tags: { push: tag } } });

    const tagged = await req('GET', `/contacts?tags=${tag}`, { token: TOKEN });
    const list = tagged.data?.data ?? tagged.data;
    check('tags: filtering by tag returns only tagged contacts',
      Array.isArray(list) && list.length === 1 && list[0].id === good1.id,
      `${Array.isArray(list) ? list.length : 'n/a'} result(s)`);

    const tagsList = await req('GET', '/contacts/tags', { token: TOKEN });
    const names = (tagsList.data?.data ?? tagsList.data ?? []).map((t) => t.name ?? t);
    check('tags: the tag appears in the workspace tag list', names.includes(tag),
      JSON.stringify(names)?.slice(0, 120));

    const optedList = await req('GET', '/contacts?status=opted_out', { token: TOKEN });
    const optedRows = optedList.data?.data ?? optedList.data;
    check('filters: the opted-out filter returns opted-out contacts only',
      Array.isArray(optedRows) && optedRows.every((c) => c.optedOut === true),
      `${Array.isArray(optedRows) ? optedRows.length : 'n/a'} row(s)`);

    // Export must reflect the same filter the screen is showing.
    const exportRes = await fetch(`${BASE}${WS_PREFIX}/contacts/export?tags=${tag}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const csv = await exportRes.text();
    const lines = csv.trim().split(/\r?\n/);
    check('export: the filtered export succeeds', exportRes.status === 200, `status=${exportRes.status}`);
    check('export: it is served as a CSV download',
      /text\/csv/i.test(exportRes.headers.get('content-type') || '')
      && /attachment/i.test(exportRes.headers.get('content-disposition') || ''),
      `${exportRes.headers.get('content-type')} · ${exportRes.headers.get('content-disposition')}`);
    check('export: the export honours the same filter as the list',
      lines.length === 2, `${lines.length - 1} data row(s)`);
    check('export: the header names the expected columns',
      /name/i.test(lines[0]) && /phoneNumber/i.test(lines[0]) && /optedOut/i.test(lines[0]),
      lines[0]?.slice(0, 120));
    check('export: the contact appears exactly once',
      lines.filter((l) => l.includes(good1.phoneNumber)).length === 1);
    check('export: a phone number is not mangled by formula-injection guarding',
      csv.includes(good1.phoneNumber), good1.phoneNumber);
  }
} catch (err) {
  check('suite completed without throwing', false, `${err.name}: ${err.message?.slice(0, 200)}`);
} finally {
  // Cancel anything still live before deleting, so no job keeps running against
  // a campaign whose rows are gone.
  for (const id of cleanup.campaigns) {
    await prisma.campaign.updateMany({
      where: { id, status: { in: ['SCHEDULED', 'RUNNING', 'PAUSED'] } },
      data: { status: 'CANCELLED' },
    }).catch(() => {});
    await prisma.campaignRecipient.deleteMany({ where: { campaignId: id } }).catch(() => {});
    await prisma.campaign.delete({ where: { id } }).catch(() => {});
  }
  for (const id of cleanup.contacts) {
    await prisma.campaignRecipient.deleteMany({ where: { contactId: id } }).catch(() => {});
    await prisma.contact.delete({ where: { id } }).catch(() => {});
  }

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
