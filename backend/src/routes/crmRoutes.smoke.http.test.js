import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, mockIdentity, startApp } from './crmHttp.testutil.js';

// CF-163: every CRM router has at least one request through the real
// authorize() and validate() layers, so a route whose guard or schema
// disagrees with what its service expects fails here rather than in
// production. Feature behaviour is covered by the other *.http.test.js files.

const store = createStore();
let app;

const ROUTERS = {
  '/leads': './leads.routes.js',
  '/deals': './deals.routes.js',
  '/tasks': './tasks.routes.js',
  '/activities': './activities.routes.js',
  '/tickets': './tickets.routes.js',
  '/quotes': './quotes.routes.js',
  '/products': './products.routes.js',
  '/pipeline-stages': './pipelineStages.routes.js',
  '/crm-customization': './crmCustomization.routes.js',
  '/lead-forms': './leadForms.routes.js',
  '/sequences': './sequences.routes.js',
  '/lead-distribution': './leadDistribution.routes.js',
  '/crm-sales-inbox': './crmSalesInbox.routes.js',
  '/crm-analytics': './crm-analytics.routes.js',
  '/crm-data': './crmData.routes.js',
  '/saved-views': './savedViews.routes.js',
  '/custom-fields': './customFields.routes.js',
};

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: store.prisma } });
  mockIdentity(mock);
  mock.module('../services/workflowCrm.service.js', { namedExports: { emitCrmEvent: () => {} } });
  const mounts = {};
  for (const [path, file] of Object.entries(ROUTERS)) mounts[path] = (await import(file)).default;
  app = await startApp(mounts);
});
test.after(() => app?.server.close());
test.beforeEach(() => store.reset());

// [method, path, role refused, role allowed past authorize(), a body validate() rejects (default {})]
const WRITES = [
  ['POST', '/leads', 'VIEWER', 'CLIENT'],
  ['POST', '/deals', 'VIEWER', 'CLIENT'],
  ['PATCH', '/deals/d1/stage', 'VIEWER', 'CLIENT'],
  ['POST', '/tasks', 'VIEWER', 'CLIENT'],
  ['POST', '/activities', 'VIEWER', 'AGENT'],
  ['POST', '/tickets', 'VIEWER', 'CLIENT'],
  // An empty quote is a valid draft; an out-of-range discount is not.
  ['POST', '/quotes', 'VIEWER', 'CLIENT', { discountPct: 150 }],
  ['POST', '/products', 'VIEWER', 'CLIENT'],
  ['PATCH', '/pipeline-stages/reorder', 'CLIENT', 'ADMIN'],
  ['POST', '/lead-forms', 'VIEWER', 'CLIENT'],
  ['POST', '/sequences', 'VIEWER', 'CLIENT'],
  ['POST', '/sequences/s1/enroll', 'VIEWER', null],
  ['POST', '/lead-distribution/distribute', 'VIEWER', null],
  ['POST', '/crm-sales-inbox/launch-bulk-campaign', 'AGENT', 'CLIENT'],
  ['POST', '/crm-analytics/reports/saved', 'AGENT', 'CLIENT'],
  ['POST', '/saved-views', 'VIEWER', 'CLIENT'],
  ['POST', '/custom-fields', 'CLIENT', 'ADMIN'],
];

for (const [method, path, refused, allowed, badBody = {}] of WRITES) {
  test(`${method} ${path}: ${refused} is refused${allowed ? `, ${allowed} gets validation` : ''}`, async () => {
    const denied = await app.call(method, path, {}, { role: refused });
    assert.equal(denied.status, 403, `${refused} should be refused`);
    if (allowed) {
      const invalid = await app.call(method, path, badBody, { role: allowed });
      assert.equal(invalid.status, 400, `${allowed} with an invalid body should fail validation`);
    }
  });
}

test('Customize Your Business sections are admin-only and schema-checked', async () => {
  assert.equal((await app.call('PUT', '/crm-customization/lead_tags', { tags: [] }, { role: 'CLIENT' })).status, 403);
  assert.equal((await app.call('PUT', '/crm-customization/lead_tags', { tags: 'not a list' })).status, 400);
  assert.equal((await app.call('PUT', '/crm-customization/not_a_section', {})).status, 400);
});

test('report queries are validated before any service runs', async () => {
  assert.equal((await app.call('POST', '/crm-analytics/reports/query', { entity: 'invoices' })).status, 400);
});
