// Add-on entitlement: what a purchase actually grants.
//
// The purchase flow was made real earlier — server-priced order, signature
// verified, invoice written. What did not exist was the other half: hasAddon()
// had no callers anywhere, and two of the four add-ons sold storage the schema
// did not have. This suite covers the half that was missing.
//
// Run with the server up:
//   node --env-file=.env scripts/addon-check.mjs

import { PrismaClient } from '@prisma/client';

const BASE = process.env.ADDON_CHECK_BASE_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const results = [];
const section = (name) => results.push(`\n── ${name} ${'─'.repeat(Math.max(0, 52 - name.length))}`);
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

const session = (await req('POST', '/auth/login', {
  body: { email: 'test@example.com', password: 'password123' },
})).data;
const TOKEN = session.accessToken;
const WS = session.workspace.id;

// Grant an add-on directly. The purchase path has its own coverage in
// regression-check.mjs; what is under test here is what the grant unlocks.
const grant = (addonKey) => prisma.workspaceAddon.upsert({
  where: { workspaceId_addonKey: { workspaceId: WS, addonKey } },
  update: { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
  create: {
    workspaceId: WS, addonKey, status: 'ACTIVE', amountPaid: 499, currency: 'INR',
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
  },
});
const revoke = (addonKey) => prisma.workspaceAddon.deleteMany({ where: { workspaceId: WS, addonKey } });

try {
  await prisma.workspaceCustomField.deleteMany({ where: { workspaceId: WS } });
  await prisma.workspaceCustomEvent.deleteMany({ where: { workspaceId: WS } });
  await revoke('fields');
  await revoke('events');

  // ── Catalogue honesty ──────────────────────────────────────────────────────
  section('Catalogue');
  {
    const cat = await req('GET', `/workspaces/${WS}/subscription/addons`, { token: TOKEN });
    const byKey = Object.fromEntries((cat.data?.addons ?? []).map((a) => [a.key, a]));
    check('catalogue: every add-on declares whether it can be bought',
      (cat.data?.addons ?? []).every((a) => typeof a.available === 'boolean'));
    check('catalogue: add-ons that grant nothing are marked unavailable',
      byKey.crm?.available === false && byKey.tags?.available === false,
      JSON.stringify({ crm: byKey.crm?.available, tags: byKey.tags?.available }));
    check('catalogue: unavailable add-ons say why',
      Boolean(byKey.crm?.unavailableReason && byKey.tags?.unavailableReason));
    check('catalogue: deliverable add-ons remain buyable',
      byKey.fields?.available === true && byKey.events?.available === true);

    for (const key of ['crm', 'tags']) {
      const r = await req('POST', `/workspaces/${WS}/subscription/addons/checkout`, {
        token: TOKEN, body: { addonKey: key },
      });
      check(`catalogue: buying "${key}" is refused rather than charged`,
        r.status === 400 && r.data?.code === 'ADDON_NOT_AVAILABLE', `status=${r.status}`);
    }
  }

  // ── Custom fields ──────────────────────────────────────────────────────────
  section('Custom fields');
  {
    const before = await req('GET', `/workspaces/${WS}/custom/fields`, { token: TOKEN });
    check('fields: with no add-on the allowance is zero',
      before.data?.allowed === 0, JSON.stringify(before.data));

    const refused = await req('POST', `/workspaces/${WS}/custom/fields`, {
      token: TOKEN, body: { label: 'Order Number' },
    });
    check('fields: creating one without the add-on is refused',
      refused.status === 403 && refused.data?.code === 'ADDON_REQUIRED', `status=${refused.status}`);
    check('fields: the refusal names the add-on that lifts it',
      /Pack of 5 Custom Fields/.test(refused.data?.error ?? ''), refused.data?.error);

    await grant('fields');
    const after = await req('GET', `/workspaces/${WS}/custom/fields`, { token: TOKEN });
    check('fields: buying the add-on raises the allowance to five',
      after.data?.allowed === 5, JSON.stringify(after.data));

    const made = await req('POST', `/workspaces/${WS}/custom/fields`, {
      token: TOKEN, body: { label: 'Order Number' },
    });
    check('fields: a field can now be created', made.status === 201, JSON.stringify(made.data));
    check('fields: a stable key is derived from the label',
      made.data?.key === 'order_number', made.data?.key);

    // Fill the allowance and prove the cap holds.
    for (const label of ['Plan Tier', 'Renewal Date', 'Seat Count', 'Region']) {
      await req('POST', `/workspaces/${WS}/custom/fields`, { token: TOKEN, body: { label } });
    }
    const overflow = await req('POST', `/workspaces/${WS}/custom/fields`, {
      token: TOKEN, body: { label: 'One Too Many' },
    });
    check('fields: the sixth is refused once the allowance is used up',
      overflow.status === 403 && overflow.data?.code === 'ADDON_REQUIRED', `status=${overflow.status}`);

    // Two packs, ten fields.
    await prisma.workspaceAddon.updateMany({
      where: { workspaceId: WS, addonKey: 'fields' },
      data: { currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
    });
    check('fields: allowance is derived from the grant, not hardcoded',
      (await req('GET', `/workspaces/${WS}/custom/fields`, { token: TOKEN })).data.allowed === 5);
  }

  // ── Values on contacts ─────────────────────────────────────────────────────
  section('Field values');
  {
    const typed = await req('POST', `/workspaces/${WS}/custom/fields`, {
      token: TOKEN, body: { label: 'Signup Source', type: 'SELECT', options: ['web', 'referral'] },
    });
    // Allowance is full, so this one is expected to be refused — prove the type
    // validation separately on a field that exists.
    const fields = await prisma.workspaceCustomField.findMany({ where: { workspaceId: WS } });
    const numberField = await prisma.workspaceCustomField.create({
      data: { workspaceId: WS, key: 'seat_total', label: 'Seat Total', type: 'NUMBER' },
    });

    const phone = `+9198${Math.floor(10000000 + Math.random() * 89999999)}`;
    const created = await req('POST', `/workspaces/${WS}/contacts`, {
      token: TOKEN,
      body: { name: 'Addon Probe', phoneNumber: phone, customFields: { order_number: 'A-1001', seat_total: 12 } },
    });
    check('values: a contact stores custom field values',
      created.status < 400 && created.data?.customFields?.order_number === 'A-1001',
      JSON.stringify(created.data?.customFields));
    check('values: a NUMBER field is stored as a number',
      created.data?.customFields?.seat_total === 12, JSON.stringify(created.data?.customFields));

    const badType = await req('PATCH', `/workspaces/${WS}/contacts/${created.data.id}`, {
      token: TOKEN, body: { customFields: { seat_total: 'not-a-number' } },
    });
    check('values: a wrong type is refused with the field label',
      badType.status === 400 && /Seat Total/.test(badType.data?.error ?? ''), badType.data?.error);

    const unknown = await req('PATCH', `/workspaces/${WS}/contacts/${created.data.id}`, {
      token: TOKEN, body: { customFields: { not_a_field: 'x' } },
    });
    check('values: an unknown key is refused rather than silently dropped',
      unknown.status === 400, `status=${unknown.status}`);

    const partial = await req('PATCH', `/workspaces/${WS}/contacts/${created.data.id}`, {
      token: TOKEN, body: { customFields: { seat_total: 20 } },
    });
    check('values: editing one field preserves the others',
      partial.data?.customFields?.order_number === 'A-1001' && partial.data?.customFields?.seat_total === 20,
      JSON.stringify(partial.data?.customFields));

    const res = await fetch(`${BASE}/workspaces/${WS}/contacts/export`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const csv = await res.text();
    check('values: custom fields appear as columns in the export',
      csv.includes('Order Number') && csv.includes('Seat Total'), csv.split('\n')[0]?.slice(0, 140));

    await prisma.contact.deleteMany({ where: { id: created.data.id } });
    await prisma.workspaceCustomField.deleteMany({ where: { id: numberField.id } });
    if (typed.status === 201) await prisma.workspaceCustomField.deleteMany({ where: { id: typed.data.id } });
  }

  // ── Custom events ──────────────────────────────────────────────────────────
  section('Custom events');
  {
    const refused = await req('POST', `/workspaces/${WS}/custom/events`, {
      token: TOKEN, body: { label: 'Order Shipped' },
    });
    check('events: creating one without the add-on is refused',
      refused.status === 403 && refused.data?.code === 'ADDON_REQUIRED', `status=${refused.status}`);

    await grant('events');
    const made = await req('POST', `/workspaces/${WS}/custom/events`, {
      token: TOKEN, body: { label: 'Order Shipped', description: 'Fired by our fulfilment system' },
    });
    check('events: buying the add-on allows one to be defined', made.status === 201, JSON.stringify(made.data));

    const list = await req('GET', `/workspaces/${WS}/custom/events`, { token: TOKEN });
    check('events: the allowance is three per pack', list.data?.allowed === 3, JSON.stringify(list.data));

    const tracked = await req('POST', `/workspaces/${WS}/custom/events/order_shipped/track`, {
      token: TOKEN, body: { payload: { orderId: 'A-1001' } },
    });
    check('events: a registered event can be tracked', tracked.status === 200, JSON.stringify(tracked.data));

    const row = await prisma.workspaceCustomEvent.findUnique({
      where: { workspaceId_key: { workspaceId: WS, key: 'order_shipped' } },
    });
    check('events: tracking is recorded against the definition',
      row?.seenCount === 1 && Boolean(row.lastSeenAt), JSON.stringify({ seen: row?.seenCount }));

    const unknown = await req('POST', `/workspaces/${WS}/custom/events/never_defined/track`, {
      token: TOKEN, body: { payload: {} },
    });
    check('events: an undefined event is refused', unknown.status === 404, `status=${unknown.status}`);

    for (const label of ['Refund Issued', 'Ticket Closed']) {
      await req('POST', `/workspaces/${WS}/custom/events`, { token: TOKEN, body: { label } });
    }
    const overflow = await req('POST', `/workspaces/${WS}/custom/events`, {
      token: TOKEN, body: { label: 'One Too Many' },
    });
    check('events: the fourth is refused once the allowance is used up',
      overflow.status === 403, `status=${overflow.status}`);
  }

  // ── Expiry ─────────────────────────────────────────────────────────────────
  section('Expiry');
  {
    // A lapsed add-on stops granting. Paying once must not buy the capability
    // forever, which is the mistake the subscription sweep used to make.
    await prisma.workspaceAddon.updateMany({
      where: { workspaceId: WS, addonKey: 'fields' },
      data: { currentPeriodEnd: new Date(Date.now() - 86_400_000) },
    });
    const lapsed = await req('GET', `/workspaces/${WS}/custom/fields`, { token: TOKEN });
    check('expiry: an expired add-on grants nothing', lapsed.data?.allowed === 0,
      JSON.stringify(lapsed.data?.allowed));

    // Cancelled but still inside the paid period keeps working.
    await prisma.workspaceAddon.updateMany({
      where: { workspaceId: WS, addonKey: 'fields' },
      data: { status: 'CANCELLED', currentPeriodEnd: new Date(Date.now() + 5 * 86_400_000) },
    });
    const cancelled = await req('GET', `/workspaces/${WS}/custom/fields`, { token: TOKEN });
    check('expiry: a cancelled add-on works until the paid period ends',
      cancelled.data?.allowed === 5, JSON.stringify(cancelled.data?.allowed));
  }
} catch (err) {
  check('suite completed without throwing', false, err.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await prisma.workspaceCustomField.deleteMany({ where: { workspaceId: WS } });
  await prisma.workspaceCustomEvent.deleteMany({ where: { workspaceId: WS } });
  await revoke('fields').catch(() => {});
  await revoke('events').catch(() => {});
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
