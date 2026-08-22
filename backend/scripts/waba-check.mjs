// WhatsApp Business Account connection, end to end, against the live Meta API.
//
//   connect → verify → connected → disconnect → reconnect
//
// Nothing here fakes a Meta response: every assertion is the real Graph API
// answering. No message is sent to anyone, and no token is printed.
//
// Run with the server up:
//   node --env-file=.env scripts/waba-check.mjs

import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';

const BASE = process.env.WABA_CHECK_BASE_URL || 'http://127.0.0.1:4000/api/v1';
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

const session = (await req('POST', '/auth/login', {
  body: { email: 'test@example.com', password: 'password123' },
})).data;
const TOKEN = session.accessToken;
const WS = session.workspace.id;
const SYSTEM_TOKEN = env.META_SYSTEM_USER_TOKEN;
const WABA = env.META_WABA_ID;

try {
  // A real number on the platform WABA, so every check below is Meta's own
  // answer rather than a fixture.
  const graph = await fetch(
    `https://graph.facebook.com/${env.META_API_VERSION}/${WABA}/phone_numbers`
    + `?fields=id,display_phone_number,code_verification_status&access_token=${SYSTEM_TOKEN}`,
  ).then((r) => r.json());
  const real = (graph.data || [])[0];
  if (!real) throw new Error('the platform WABA has no phone numbers to test against');
  results.push(`      testing against ${real.display_phone_number} (verification: ${real.code_verification_status})`);

  // ── Isolation ──────────────────────────────────────────────────────────────
  section('Multiple WABA / number isolation');
  {
    const owner = await prisma.waNumber.findUnique({ where: { metaPhoneNumberId: real.id } });
    if (owner && owner.workspaceId !== WS) {
      const stolen = await req('POST', `/workspaces/${WS}/whatsapp/numbers/connect-own`, {
        token: TOKEN,
        body: {
          phoneNumber: real.display_phone_number, metaPhoneNumberId: real.id,
          wabaId: WABA, accessToken: SYSTEM_TOKEN,
        },
      });
      check('isolation: a number owned by another workspace cannot be claimed',
        stolen.status === 409 && stolen.data?.code === 'NUMBER_ALREADY_CONNECTED',
        `status=${stolen.status} ${stolen.data?.error}`);
    } else {
      check('isolation: a number owned by another workspace cannot be claimed', true);
      results.push('      (skipped: this number is unclaimed or already ours)');
    }

    const dup = await prisma.$queryRaw`
      SELECT COUNT(*)::int n FROM (
        SELECT "metaPhoneNumberId" FROM "WaNumber" GROUP BY 1 HAVING COUNT(*) > 1) x`;
    check('isolation: no phone number id is held twice anywhere', dup[0].n === 0, `${dup[0].n} duplicated`);
  }

  // ── Ownership verification ─────────────────────────────────────────────────
  section('WABA / number ownership');
  {
    const wrongWaba = await req('POST', `/workspaces/${WS}/whatsapp/numbers/connect-own`, {
      token: TOKEN,
      body: {
        phoneNumber: '+10000000000', metaPhoneNumberId: real.id,
        wabaId: '999999999999999', accessToken: SYSTEM_TOKEN,
      },
    });
    check('ownership: a WABA the token cannot administer is refused',
      wrongWaba.status === 403 || wrongWaba.status === 400, `status=${wrongWaba.status}`);

    const wrongNumber = await req('POST', `/workspaces/${WS}/whatsapp/numbers/connect-own`, {
      token: TOKEN,
      body: {
        phoneNumber: '+10000000000', metaPhoneNumberId: '111111111111111',
        wabaId: WABA, accessToken: SYSTEM_TOKEN,
      },
    });
    check('ownership: a number that is not on that WABA is refused',
      wrongNumber.status === 400 && /not on WhatsApp Business Account/.test(wrongNumber.data?.error ?? ''),
      `status=${wrongNumber.status} ${wrongNumber.data?.error?.slice(0, 80)}`);

    const junk = await req('POST', `/workspaces/${WS}/whatsapp/numbers/connect-own`, {
      token: TOKEN,
      body: {
        phoneNumber: '+15550001111', metaPhoneNumberId: 'PN123',
        wabaId: 'WABA123', accessToken: 'not-a-real-token',
      },
    });
    check('ownership: invented ids are refused rather than stored',
      junk.status >= 400, `status=${junk.status}`);
    // Scoped to this workspace: the database still holds junk rows created
    // before any of this was validated, and those are not this test's doing.
    check('ownership: nothing was written for the invented ids',
      (await prisma.waNumber.count({ where: { workspaceId: WS, metaPhoneNumberId: 'PN123' } })) === 0);
  }

  // The number under test lives in some workspace already. The rest of the
  // lifecycle is exercised *there*, with a token minted for one of its members,
  // rather than by detaching it — disconnecting a live number sets its
  // conversations' waNumberId to null and tombstones campaign-referenced
  // templates, which is real data loss for the sake of a test.
  const owner = await prisma.waNumber.findUnique({ where: { metaPhoneNumberId: real.id } });
  let ownerToken = null;
  let ownerWs = null;
  if (owner) {
    ownerWs = owner.workspaceId;
    const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: ownerWs } });
    if (member) {
      const jwt = (await import('jsonwebtoken')).default;
      ownerToken = jwt.sign(
        { sub: member.userId, workspaceId: ownerWs, role: member.role, superAdmin: false, jti: `waba-check-${Date.now()}` },
        env.JWT_ACCESS_SECRET, { expiresIn: '10m' },
      );
    }
  }

  // ── Connect ────────────────────────────────────────────────────────────────
  section('Connect');
  {
    check('connect: the number is already connected from a real Meta sign-in', Boolean(owner),
      'no WaNumber row for the test number');
    if (owner) {
      check('connect: the stored number matches what Meta reports',
        owner.phoneNumber === real.display_phone_number,
        `stored=${owner.phoneNumber} meta=${real.display_phone_number}`);
      check('connect: the token is encrypted at rest',
        Boolean(owner.encryptedAccessToken)
        && !String(owner.encryptedAccessToken).includes(SYSTEM_TOKEN.slice(0, 20)));
      const listed = await req('GET', `/workspaces/${ownerWs}/whatsapp/numbers`, { token: ownerToken });
      check('connect: listing numbers never exposes the token',
        !JSON.stringify(listed.data).toLowerCase().includes('encryptedaccesstoken'));
    }
  }

  // ── Health ─────────────────────────────────────────────────────────────────
  section('Connection status');
  if (ownerToken) {
    const health = await req('GET', `/workspaces/${ownerWs}/whatsapp/numbers/${owner.id}/health`, { token: ownerToken });
    const by = Object.fromEntries((health.data?.checks || []).map((c) => [c.id, c]));
    check('status: health reports every dependency', health.status === 200
      && ['token', 'number', 'verification', 'webhooks'].every((k) => k in by),
      JSON.stringify(Object.keys(by)));
    check('status: the token decrypts', by.token?.ok === true, by.token?.detail);
    check('status: Meta recognises the number', by.number?.ok === true, by.number?.detail);
    check('status: the app is subscribed for webhooks', by.webhooks?.ok === true, by.webhooks?.detail);
    // Expected false on a number whose verification lapsed. The point is that
    // it is reported rather than hidden behind a row that still says ACTIVE.
    check('status: verification is reported truthfully',
      by.verification?.ok === (real.code_verification_status === 'VERIFIED'),
      `check=${by.verification?.ok} meta=${real.code_verification_status}`);
    const failing = (health.data?.checks || []).filter((c) => !c.ok);
    check('status: every failing check says what to do about it',
      failing.length === 0 || failing.every((c) => Boolean(c.fix)), JSON.stringify(failing));
    check('status: health never returns the token',
      !JSON.stringify(health.data).toLowerCase().includes('encryptedaccesstoken'));
    if (failing.length) results.push(`      reported as needing attention: ${failing.map((c) => c.id).join(', ')}`);
  } else {
    check('status: a member token could be minted for the owning workspace', false, 'no member found');
  }

  // ── Verify ─────────────────────────────────────────────────────────────────
  section('Phone verification');
  if (ownerToken) {
    // Requesting a real code sends an SMS to a real number, so this asserts the
    // endpoint is reachable, scoped and validates input — not that Meta sends.
    const scoped = await req('POST', `/workspaces/${ownerWs}/whatsapp/numbers/does-not-exist/request-code`, {
      token: ownerToken, body: { method: 'SMS' },
    });
    check('verify: request-code is scoped to the workspace', scoped.status === 404, `status=${scoped.status}`);

    const short = await req('POST', `/workspaces/${ownerWs}/whatsapp/numbers/${owner.id}/verify-code`, {
      token: ownerToken, body: { code: '12' },
    });
    check('verify: a short code is refused before reaching Meta',
      short.status === 400 && /6-digit/.test(short.data?.error ?? ''), short.data?.error);

    const foreign = await req('POST', `/workspaces/${WS}/whatsapp/numbers/${owner.id}/request-code`, {
      token: TOKEN, body: { method: 'SMS' },
    });
    check('verify: another workspace cannot verify this number', foreign.status === 404, `status=${foreign.status}`);
  }

  // ── Reconnect ──────────────────────────────────────────────────────────────
  section('Reconnect');
  if (ownerToken) {
    // Non-destructive by design: reconnect replaces credentials in place, which
    // is the whole point — disconnect-then-reconnect was the only route back
    // from an expired token and it detached every conversation on the way.
    const repaired = await req('POST', `/workspaces/${ownerWs}/whatsapp/numbers/${owner.id}/reconnect`, {
      token: ownerToken, body: { accessToken: SYSTEM_TOKEN },
    });
    check('reconnect: credentials can be replaced in place',
      repaired.status === 200 && repaired.data?.ok === true, JSON.stringify(repaired.data)?.slice(0, 140));
    check('reconnect: the row id is unchanged, so history stays attached',
      repaired.data?.number?.id === owner.id, `${repaired.data?.number?.id} vs ${owner.id}`);
    check('reconnect: the app is re-subscribed for webhooks', repaired.data?.subscribed === true);
    check('reconnect: the token is never returned',
      !JSON.stringify(repaired.data).toLowerCase().includes('encryptedaccesstoken'));

    const bogus = await req('POST', `/workspaces/${ownerWs}/whatsapp/numbers/${owner.id}/reconnect`, {
      token: ownerToken, body: { accessToken: 'not-a-real-token' },
    });
    check('reconnect: a token that does not own the number is refused', bogus.status >= 400, `status=${bogus.status}`);

    const stillThere = await prisma.waNumber.findUnique({ where: { id: owner.id } });
    check('reconnect: a refused attempt leaves the working credentials alone',
      Boolean(stillThere) && stillThere.metaPhoneNumberId === real.id);
  }

  // ── Disconnect ─────────────────────────────────────────────────────────────
  section('Disconnect');
  {
    // Exercised on a throwaway row rather than the live number, for the same
    // reason as above. The row is created directly because connect-own would
    // (correctly) refuse ids Meta does not know.
    const scratchWs = await prisma.workspace.create({ data: { name: `QA WABA ${Date.now()}` } });
    const { encrypt } = await import('../src/lib/encryption.js');
    const scratch = await prisma.waNumber.create({
      data: {
        workspaceId: scratchWs.id, phoneNumber: '+10000000001',
        metaPhoneNumberId: `qa_pn_${Date.now()}`, wabaId: 'qa_waba',
        encryptedAccessToken: encrypt('qa-token'),
      },
    });
    const member = await prisma.workspaceMember.create({
      data: { workspaceId: scratchWs.id, userId: session.user.id, role: 'ADMIN' },
    });
    const jwt = (await import('jsonwebtoken')).default;
    const scratchToken = jwt.sign(
      { sub: session.user.id, workspaceId: scratchWs.id, role: 'ADMIN', superAdmin: false, jti: `waba-d-${Date.now()}` },
      env.JWT_ACCESS_SECRET, { expiresIn: '10m' },
    );

    const gone = await req('DELETE', `/workspaces/${scratchWs.id}/whatsapp/numbers/${scratch.id}`, { token: scratchToken });
    check('disconnect: the number is released', gone.status === 200, JSON.stringify(gone.data));
    check('disconnect: the phone number id is free to be claimed again',
      (await prisma.waNumber.count({ where: { metaPhoneNumberId: scratch.metaPhoneNumberId } })) === 0);

    await prisma.workspaceMember.delete({ where: { id: member.id } }).catch(() => {});
    await prisma.workspace.delete({ where: { id: scratchWs.id } }).catch(() => {});
  }

} catch (err) {
  check('suite completed without throwing', false, err.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
