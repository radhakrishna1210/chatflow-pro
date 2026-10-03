import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// CF-200 through the real contacts router: every write stores E.164 with the
// workspace's default country, and a number already stored under another
// spelling is a 409, not a second contact.

const state = {};

function reset() {
  state.country = 'IN';
  state.contacts = [];
}

const matches = (row, where) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(row[k]);
  return row[k] === v;
});

const fakePrisma = {
  workspace: {
    findUnique: async () => ({ defaultPhoneCountry: state.country }),
  },
  contact: {
    findMany: async ({ where, take }) => state.contacts.filter((c) => matches(c, where)).slice(0, take ?? Infinity),
    findFirst: async ({ where }) => state.contacts.find((c) => matches(c, where)) ?? null,
    findUnique: async ({ where }) => state.contacts.find((c) => c.id === where.id) ?? null,
    create: async ({ data }) => {
      if (state.contacts.some((c) => c.workspaceId === data.workspaceId && c.phoneNumber === data.phoneNumber)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row = { id: `c${state.contacts.length + 1}`, optedOut: false, ...data };
      state.contacts.push(row);
      return row;
    },
    createMany: async ({ data }) => {
      let count = 0;
      for (const d of data) {
        if (state.contacts.some((c) => c.workspaceId === d.workspaceId && c.phoneNumber === d.phoneNumber)) continue;
        state.contacts.push({ id: `c${state.contacts.length + 1}`, optedOut: false, ...d });
        count += 1;
      }
      return { count };
    },
    update: async ({ where, data }) => Object.assign(state.contacts.find((c) => c.id === where.id), data),
  },
};

let baseUrl;
let server;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('../config/env.js', { namedExports: { env: { ADMIN_EMAIL: 'admin@example.test' } } });
  mock.module('../middleware/authenticate.js', {
    namedExports: {
      authenticate: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
      authenticateOptional: (_req, _res, next) => next(),
    },
  });
  mock.module('../middleware/workspaceContext.js', {
    namedExports: {
      workspaceContext: (req, _res, next) => {
        req.user.workspaceId = req.params.workspaceId;
        req.user.role = 'ADMIN';
        req.user.workspaceRoleVerified = true;
        next();
      },
    },
  });
  // The plan limit has its own tests in subscription.service.test.js.
  mock.module('../services/subscription.service.js', {
    namedExports: { assertWithinLimit: async () => {}, assertContactCapacity: async () => {}, hasContactCapacity: async () => true },
  });
  mock.module('../services/workspaceCustomFields.service.js', {
    namedExports: { validateCustomFields: async (_ws, v) => v },
  });

  const { default: express } = await import('express');
  const { default: contactsRoutes } = await import('./contacts.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/w/:workspaceId/contacts', contactsRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/w/ws1`;
});

test.after(() => server?.close());
test.beforeEach(reset);

const send = (method, path, body) => fetch(`${baseUrl}${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('a national-format number is stored as E.164 with the workspace country', async () => {
  const res = await send('POST', '/contacts', { name: 'Asha', phoneNumber: '098765 43210' });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).phoneNumber, '+919876543210');
});

test('another spelling of an existing number is a conflict, not a second contact', async () => {
  assert.equal((await send('POST', '/contacts', { name: 'Asha', phoneNumber: '+91 98765 43210' })).status, 201);
  const res = await send('POST', '/contacts', { name: 'Asha again', phoneNumber: '9876543210' });
  assert.equal(res.status, 409);
  assert.equal(state.contacts.length, 1);
});

test('a row stored before normalisation is still found', async () => {
  state.contacts.push({ id: 'legacy', workspaceId: 'ws1', name: 'Old', phoneNumber: '09876543210', optedOut: false });
  const res = await send('POST', '/contacts', { name: 'New', phoneNumber: '+919876543210' });
  assert.equal(res.status, 409);
});

test('the default country follows the workspace setting', async () => {
  state.country = 'US';
  const res = await send('POST', '/contacts', { name: 'Sam', phoneNumber: '(555) 123-4567' });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).phoneNumber, '+15551234567');
});

test('editing a number normalises it and refuses one another contact holds', async () => {
  state.contacts.push(
    { id: 'a', workspaceId: 'ws1', name: 'A', phoneNumber: '+919811111111', optedOut: false },
    { id: 'b', workspaceId: 'ws1', name: 'B', phoneNumber: '+919822222222', optedOut: false },
  );
  let res = await send('PATCH', '/contacts/a', { phoneNumber: '09833333333' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).phoneNumber, '+919833333333');

  res = await send('PATCH', '/contacts/a', { phoneNumber: '98222 22222' });
  assert.equal(res.status, 409);
});

test('a CSV import normalises every row and skips numbers already stored under another spelling', async () => {
  state.contacts.push({ id: 'legacy', workspaceId: 'ws1', name: 'Old', phoneNumber: '9811111111', optedOut: false });
  const form = new FormData();
  form.append('file', new Blob(['name,phone\nA,09811111111\nB,98222 22222\nC,+919822222222\n'], { type: 'text/csv' }), 'c.csv');
  const res = await fetch(`${baseUrl}/contacts/import`, { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.imported, 1);
  assert.deepEqual(state.contacts.map((c) => c.phoneNumber).sort(), ['+919822222222', '9811111111']);
});
