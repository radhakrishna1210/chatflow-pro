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

  // CLIENT has operational pipeline permissions but cannot delete leads or manage distribution rules without admin
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.LEAD_EXPORT), true);
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.CAMPAIGN_LAUNCH), true);
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.LEAD_BULK_ASSIGN), true);
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.PHONE_MASKING_OVERRIDE), false);
  assert.equal(hasCrmPermission('CLIENT', CRM_PERMISSIONS.LEAD_DELETE), false);

  // AGENT has limited permissions
  assert.equal(hasCrmPermission('AGENT', CRM_PERMISSIONS.LEAD_EXPORT), false);
  assert.equal(hasCrmPermission('AGENT', CRM_PERMISSIONS.CAMPAIGN_LAUNCH), false);
  assert.equal(hasCrmPermission('AGENT', CRM_PERMISSIONS.LEAD_BULK_ASSIGN), false);
  assert.equal(hasCrmPermission('AGENT', CRM_PERMISSIONS.LEAD_DELETE), false);

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
  assert.equal(clientPerms.canExportLeads, true);
  assert.equal(clientPerms.canExportUnmaskedPhones, false);
  assert.equal(clientPerms.shouldMaskPhones, true);
  assert.equal(clientPerms.canDeleteLeads, false);
  assert.equal(clientPerms.canLaunchCampaigns, true);

  const agentPerms = getUserCrmPermissions('AGENT');
  assert.equal(agentPerms.canExportLeads, false);
  assert.equal(agentPerms.canLaunchCampaigns, false);
});

test('CRM Permissions - requireCrmPermission middleware enforces role checks', () => {
  const mw = requireCrmPermission(CRM_PERMISSIONS.CAMPAIGN_LAUNCH);

  let nextCalled = false;
  const mockReqAllowed = { membership: { role: 'CLIENT' } };
  const mockRes = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  mw(mockReqAllowed, mockRes, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  // Denied case
  let nextCalledDenied = false;
  const mockReqDenied = { membership: { role: 'AGENT' } };
  mw(mockReqDenied, mockRes, () => { nextCalledDenied = true; });
  assert.equal(nextCalledDenied, false);
  assert.equal(mockRes.statusCode, 403);
  assert.match(mockRes.body.error, /Insufficient CRM permission/);
});
