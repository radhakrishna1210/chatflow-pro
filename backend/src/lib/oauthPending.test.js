import test from 'node:test';
import assert from 'node:assert/strict';
import { redis } from './redis.js';
import { parkOAuthCallback, claimOAuthCallback } from './oauthPending.js';

const ready = () => new Promise((resolve) => {
  if (redis.status === 'ready') return resolve(true);
  const t = setTimeout(() => resolve(false), 2000);
  redis.once('ready', () => { clearTimeout(t); resolve(true); });
});

test('a parked callback is completed only by the user and workspace that started it, once', async (t) => {
  if (!(await ready())) return t.skip('redis unavailable');
  const victimFlow = await parkOAuthCallback({ kind: 'instagram', workspaceId: 'ws_attacker', userId: 'u_attacker', data: { code: 'victim-code' } });
  // The victim's browser lands on the app and completes with the victim's own session.
  await assert.rejects(
    claimOAuthCallback(victimFlow, { kind: 'instagram', workspaceId: 'ws_victim', userId: 'u_victim' }),
    { status: 403, code: 'OAUTH_PENDING_MISMATCH' },
  );
  // Burned by that attempt: the attacker cannot claim it afterwards either.
  await assert.rejects(
    claimOAuthCallback(victimFlow, { kind: 'instagram', workspaceId: 'ws_attacker', userId: 'u_attacker' }),
    { status: 410 },
  );

  const own = await parkOAuthCallback({ kind: 'instagram', workspaceId: 'ws_1', userId: 'u_1', data: { code: 'c1' } });
  await assert.rejects(claimOAuthCallback(own, { kind: 'integration:google', workspaceId: 'ws_1', userId: 'u_1' }), { code: 'OAUTH_PENDING_INVALID' });
  const own2 = await parkOAuthCallback({ kind: 'instagram', workspaceId: 'ws_1', userId: 'u_1', data: { code: 'c2' } });
  assert.deepEqual(await claimOAuthCallback(own2, { kind: 'instagram', workspaceId: 'ws_1', userId: 'u_1' }), { code: 'c2' });
  await assert.rejects(claimOAuthCallback(own2, { kind: 'instagram', workspaceId: 'ws_1', userId: 'u_1' }), { status: 410 });
  // The same workspace but another member is refused too.
  const own3 = await parkOAuthCallback({ kind: 'instagram', workspaceId: 'ws_1', userId: 'u_1', data: {} });
  await assert.rejects(claimOAuthCallback(own3, { kind: 'instagram', workspaceId: 'ws_1', userId: 'u_2' }), { status: 403 });
  await assert.rejects(claimOAuthCallback('x', { kind: 'instagram', workspaceId: 'ws_1', userId: 'u_1' }), { status: 400 });
});

test.after(() => redis.quit().catch(() => {}));
