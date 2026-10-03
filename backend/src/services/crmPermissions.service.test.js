import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRM_PERMISSIONS,
  hasCrmPermission,
  getUserCrmPermissions,
  requireCrmPermission,
} from './crmPermissions.service.js';

test('CRM Permissions - Role matrix verification', () => {
  // ADMIN has all permissions
  assert.equal(hasCrmPermission('ADMIN', CRM_PERMISSIONS.LEAD_EXPORT), true);
  assert.equal(hasCrmPermission('ADMIN', CRM_PERMISSIONS.PHONE_MASKING_OVERRIDE), true);
  assert.equal(hasCrmPermission('ADMIN', CRM_PERMISSIONS.LEAD_DELETE), true);
  assert.equal(hasCrmPermission('ADMIN', CRM_PERMISSIONS.CAMPAIGN_LAUNCH), true);
  assert.equal(hasCrmPermission('ADMIN', CRM_PERMISSIONS.DISTRIBUTION_RULES_MANAGE), true);

  // CLIENT has operational pipeline permissions but cannot delete leads, export, or manage distribution rules without admin
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.LEAD_EXPORT), false);
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.DISTRIBUTION_RULES_MANAGE), false);
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.CUSTOM_REPORTS_MANAGE), true);
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.CAMPAIGN_LAUNCH), true);
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.LEAD_BULK_ASSIGN), true);
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.PHONE_MASKING_OVERRIDE), false);
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.LEAD_DELETE), false);

  // AGENT has limited permissions
  assert.equal(hasCrmPermission('AGENT', CRM_PERMISSIONS.LEAD_EXPORT), false);
  assert.equal(hasCrmPermission('AGENT', CRM_PERMISSIONS.CAMPAIGN_LAUNCH), false);
  assert.equal(hasCrmPermission('AGENT', CRM_PERMISSIONS.LEAD_BULK_ASSIGN), false);
  assert.equal(hasCrmPermission('AGENT', CRM_PERMISSIONS.LEAD_DELETE), false);
  // The read-mostly role floor refuses agent writes to /crm-analytics, so the
  // matrix must not claim otherwise.
  assert.equal(hasCrmPermission('AGENT', CRM_PERMISSIONS.CUSTOM_REPORTS_MANAGE), false);

  // VIEWER has no write permissions
  assert.equal(hasCrmPermission('VIEWER', CRM_PERMISSIONS.LEAD_EXPORT), false);
  assert.equal(hasCrmPermission('VIEWER', CRM_PERMISSIONS.CAMPAIGN_LAUNCH), false);
});

test('CRM Permissions - getUserCrmPermissions outputs accurate flags', () => {
  const adminPerms = getUserCrmPermissions('ADMIN');
  assert.equal(adminPerms.canExportLeads, true);
  assert.equal(adminPerms.canExportUnmaskedPhones, true);
  assert.equal(adminPerms.shouldMaskPhones, false);
  assert.equal(adminPerms.canDeleteLeads, true);
  assert.equal(adminPerms.canLaunchCampaigns, true);

  const clientPerms = getUserCrmPermissions('CLIENT');
  assert.equal(clientPerms.canExportLeads, false);
  assert.equal(clientPerms.canExportUnmaskedPhones, false);
  assert.equal(clientPerms.shouldMaskPhones, true);
  assert.equal(clientPerms.canDeleteLeads, false);
  assert.equal(clientPerms.canLaunchCampaigns, true);

  const agentPerms = getUserCrmPermissions('AGENT');
  assert.equal(agentPerms.canExportLeads, false);
  assert.equal(agentPerms.canLaunchCampaigns, false);
});

// That the matrix is enforced on the routes it governs (and fails closed for
// roles below it) is tested over HTTP in routes/crmAccess.http.test.js.

test('CRM Permissions - the middleware fails closed when no role was resolved', () => {
  // Only reachable if it were mounted before workspaceContext, which HTTP
  // tests cannot arrange; kept as a unit check of the guard itself.
  const res = { status(code) { this.statusCode = code; return this; }, json() { return this; } };
  let passed = false;
  requireCrmPermission(CRM_PERMISSIONS.CAMPAIGN_LAUNCH)({ user: {} }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});
