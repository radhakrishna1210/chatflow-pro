import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// CSV lead import against an in-memory prisma stand-in: row validation, the
// row cap, batched writes and the background follow-up hand-off.

let contacts;
let leads;
let members;
let followUps;
let contactCreateManyCalls;
let extraSections = {};

const fakePrisma = {
  workspaceMember: {
    findFirst: async ({ where }) => (members.includes(where.userId) ? { userId: where.userId } : null),
  },
  contact: {
    findMany: async ({ where }) => contacts.filter((c) => where.phoneNumber.in.includes(c.phoneNumber)),
    createMany: async ({ data }) => {
      contactCreateManyCalls += 1;
      for (const d of data) contacts.push({ id: `c-${d.phoneNumber}`, ...d });
      return { count: data.length };
    },
  },
  lead: {
    findMany: async ({ where }) => leads.filter((l) => where.contactId.in.includes(l.contactId)),
    createManyAndReturn: async ({ data }) => data.map((d, i) => {
      const row = { id: `l-${leads.length + i}`, ...d };
      return row;
    }).map((row) => { leads.push(row); return { id: row.id }; }),
  },
};

let svc;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('./contacts.service.js', {
    namedExports: {
      isValidPhone: (v) => /^\+?\d{7,15}$/.test(String(v ?? '').replace(/[\s-]/g, '')),
      normalizePhone: (v) => String(v).replace(/[^\d+]/g, ''),
    },
  });
  mock.module('./crmCustomization.service.js', {
    namedExports: {
      getSection: async (_ws, key) => (key === 'lead_lifecycle'
        ? { stages: [{ key: 'NEW', isDefault: true }, { key: 'QUALIFIED' }, { key: 'SITE_VISIT', label: 'Site Visit' }] }
        : extraSections[key] ?? null),
    },
  });
  mock.module('../queues/crmMaintenance.queue.js', {
    namedExports: {
      enqueueImportFollowUp: async (workspaceId, leadIds, opts) => { followUps.push({ workspaceId, leadIds, opts }); },
    },
  });
  // The plan contact limit has its own tests in subscription.service.test.js.
  mock.module('./subscription.service.js', { namedExports: { assertContactCapacity: async () => {} } });
  svc = await import('./crmImport.service.js');
});

test.beforeEach(() => {
  contacts = [{ id: 'c-existing', workspaceId: 'ws1', phoneNumber: '+911111111111' }];
  leads = [{ id: 'l-old', contactId: 'c-existing' }];
  members = ['u1'];
  followUps = [];
  contactCreateManyCalls = 0;
  extraSections = {};
});

const csv = (rows) => Buffer.from(['name,phone,status', ...rows].join('\n'));

test('valid rows are imported in batches and bad rows are reported per line', async () => {
  const res = await svc.importLeads('ws1', csv([
    'Asha,+912222222222,Qualified',
    'Bad,12,NEW',
    'Dup,+912222222222,NEW',
    'Existing,+911111111111,NEW',
    'Visit,+913333333333,Site Visit',
  ]));
  assert.equal(res.imported, 2);
  assert.equal(res.contactsCreated, 2);
  assert.equal(res.alreadyLeads, 1);
  assert.deepEqual(res.errors.map((e) => e.line), [3, 4]);
  assert.equal(contactCreateManyCalls, 1);

  const asha = leads.find((l) => l.contactId === 'c-+912222222222');
  assert.equal(asha.status, 'QUALIFIED');
  const visit = leads.find((l) => l.contactId === 'c-+913333333333');
  assert.equal(visit.status, 'NEW');
  assert.equal(visit.customFields.statusKey, 'SITE_VISIT');

  assert.equal(res.followUp, 'queued');
  assert.equal(followUps.length, 1);
  assert.equal(followUps[0].leadIds.length, 2);
  assert.deepEqual(followUps[0].opts, { distribute: true });
});

test('CONVERTED is not importable and lands as NEW', async () => {
  await svc.importLeads('ws1', csv(['A,+914444444444,Converted']));
  assert.equal(leads.at(-1).status, 'NEW');
});

test('an owner from outside the workspace is refused', async () => {
  await assert.rejects(
    () => svc.importLeads('ws1', csv(['A,+914444444444,NEW']), { ownerUserId: 'stranger' }),
    (e) => e.status === 400,
  );
  assert.equal(leads.length, 1);
});

test('files over the row cap are refused before anything is written', async () => {
  const rows = Array.from({ length: svc.MAX_IMPORT_ROWS + 1 }, (_, i) => `N${i},+91${String(5000000000 + i)},NEW`);
  assert.throws(() => svc.previewLeadImport(csv(rows)), (e) => e.status === 400 && /at most/.test(e.message));
  await assert.rejects(() => svc.importLeads('ws1', csv(rows)), (e) => e.status === 400);
  assert.equal(contactCreateManyCalls, 0);
});

test('rows are held to the workspace lead rules and every adjustment is reported (CF-154)', async () => {
  extraSections = {
    lead_sources: { sources: [{ key: 'REFERRAL', name: 'Referral', isActive: true }, { key: 'OTHER', name: 'Other', isActive: true }] },
    lead_tags: { tags: [{ name: 'VIP' }] },
    prospecting_criteria: { requireEmail: true },
  };
  const res = await svc.importLeads('ws1', Buffer.from([
    'name,phone,status,source,tags,email',
    'A,+915555555555,Hot,referral,vip;whale,a@x.test',
    'B,+915555555556,NEW,Billboard,,',
  ].join('\n')));
  assert.equal(res.imported, 2);
  const [a, b] = leads.slice(-2);
  assert.equal(a.status, 'NEW', 'an unknown status takes the default stage');
  assert.equal(a.source, 'REFERRAL');
  assert.deepEqual(contacts.find((c) => c.phoneNumber === '+915555555555').tags, ['VIP']);
  assert.equal(b.source, 'OTHER');
  assert.equal(b.customFields.qualification.isQualified, false);
  const reasons = res.warnings.map((w) => `${w.line}:${w.reason}`).join('|');
  assert.match(reasons, /2:Status "Hot"/);
  assert.match(reasons, /2:Tag\(s\) not configured.*whale/);
  assert.match(reasons, /3:Prospecting criteria require email/);
  assert.match(reasons, /3:Source "Billboard"/);
});
