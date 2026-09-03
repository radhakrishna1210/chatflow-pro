// Regression test for the cross-tenant OTP verification leak.
//
// verifyAuthenticationTransaction used to look a pending transaction up by
// phone alone, so two workspaces that had both sent an OTP to the same number
// shared one pool: whichever called /verify first consumed the other's, and a
// code issued by workspace A would verify inside workspace B.
//
// Run with:  npm run test:otp
// (prisma is mocked, so this needs no database.)

import { test, mock } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const hash = (c) => createHash('sha256').update(c).digest('hex');
const PHONE = '+919999999999';

let rows;
const reset = () => {
  rows = [
    { id: 'txn-A', workspaceId: 'ws-A', phone: PHONE, source: 'CHATFLOW',
      status: 'PENDING', attempts: 0, expiresAt: new Date(Date.now() + 60000),
      otpHash: hash('111111') },
    { id: 'txn-B', workspaceId: 'ws-B', phone: PHONE, source: 'CHATFLOW',
      status: 'PENDING', attempts: 0, expiresAt: new Date(Date.now() + 60000),
      otpHash: hash('222222') },
  ];
};
reset();

const prisma = {
  authenticationTransaction: {
    findFirst: async ({ where }) => rows.find((r) =>
      r.phone === where.phone &&
      r.source === where.source &&
      r.status === where.status &&
      (where.workspaceId === undefined || r.workspaceId === where.workspaceId)
    ) ?? null,
    update: async ({ where, data }) =>
      Object.assign(rows.find((r) => r.id === where.id), data),
    updateMany: async () => ({ count: 0 }),
  },
};

mock.module(
  pathToFileURL(path.resolve(import.meta.dirname, '../src/lib/prisma.js')).href,
  { namedExports: { prisma } }
);

const { verifyAuthenticationTransaction } =
  await import('../src/authentication/otp.service.js');

test('workspace B cannot verify with workspace A code (cross-tenant)', async () => {
  reset();
  const r = await verifyAuthenticationTransaction({
    workspaceId: 'ws-B', phone: PHONE, code: '111111',
  });
  assert.strictEqual(r.verified, false);
  assert.strictEqual(rows.find((x) => x.id === 'txn-A').status, 'PENDING',
    "workspace A's transaction must be untouched");
});

test('workspace A verifies with its own code', async () => {
  reset();
  const r = await verifyAuthenticationTransaction({
    workspaceId: 'ws-A', phone: PHONE, code: '111111',
  });
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.transactionId, 'txn-A');
});

test('wrong code in the right workspace still fails and counts an attempt', async () => {
  reset();
  const r = await verifyAuthenticationTransaction({
    workspaceId: 'ws-A', phone: PHONE, code: '999999',
  });
  assert.strictEqual(r.verified, false);
  assert.strictEqual(r.reason, 'INVALID_OTP');
  assert.strictEqual(rows.find((x) => x.id === 'txn-A').attempts, 1);
});
