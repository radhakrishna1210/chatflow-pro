/**
 * CRM Role-Based Permissions & Guarding
 *
 * Roles supported (matching WorkspaceMember.role):
 * - ADMIN: Workspace owner / administrator. Unrestricted CRM access.
 * - CLIENT: Department Head / Account Executive. Full sales pipeline access, bulk ops, reports, campaigns.
 * - AGENT: Sales rep. Operates on assigned leads, logs activities, sends individual messages.
 * - VIEWER: Read-only access to CRM records.
 */

export const CRM_PERMISSIONS = {
  LEAD_EXPORT: 'LEAD_EXPORT',
  PHONE_MASKING_OVERRIDE: 'PHONE_MASKING_OVERRIDE',
  LEAD_BULK_ASSIGN: 'LEAD_BULK_ASSIGN',
  LEAD_DELETE: 'LEAD_DELETE',
  CAMPAIGN_LAUNCH: 'CAMPAIGN_LAUNCH',
  DISTRIBUTION_RULES_MANAGE: 'DISTRIBUTION_RULES_MANAGE',
  CUSTOM_REPORTS_MANAGE: 'CUSTOM_REPORTS_MANAGE',
};

const ROLE_PERMISSIONS_MAP = {
  ADMIN: [
    CRM_PERMISSIONS.LEAD_EXPORT,
    CRM_PERMISSIONS.PHONE_MASKING_OVERRIDE,
    CRM_PERMISSIONS.LEAD_BULK_ASSIGN,
    CRM_PERMISSIONS.LEAD_DELETE,
    CRM_PERMISSIONS.CAMPAIGN_LAUNCH,
    CRM_PERMISSIONS.DISTRIBUTION_RULES_MANAGE,
    CRM_PERMISSIONS.CUSTOM_REPORTS_MANAGE,
  ],
  CLIENT: [
    CRM_PERMISSIONS.LEAD_EXPORT,
    CRM_PERMISSIONS.LEAD_BULK_ASSIGN,
    CRM_PERMISSIONS.CAMPAIGN_LAUNCH,
    CRM_PERMISSIONS.CUSTOM_REPORTS_MANAGE,
  ],
  AGENT: [
    CRM_PERMISSIONS.CUSTOM_REPORTS_MANAGE,
  ],
  VIEWER: [],
};

export function hasCrmPermission(role, permission) {
  if (!role) return false;
  const uppercaseRole = String(role).toUpperCase();
  const allowed = ROLE_PERMISSIONS_MAP[uppercaseRole] || [];
  return allowed.includes(permission);
}

export function getUserCrmPermissions(role) {
  const r = String(role || 'AGENT').toUpperCase();
  return {
    role: r,
    canExportLeads: hasCrmPermission(r, CRM_PERMISSIONS.LEAD_EXPORT),
    canExportUnmaskedPhones: hasCrmPermission(r, CRM_PERMISSIONS.PHONE_MASKING_OVERRIDE),
    shouldMaskPhones: !hasCrmPermission(r, CRM_PERMISSIONS.PHONE_MASKING_OVERRIDE),
    canBulkAssign: hasCrmPermission(r, CRM_PERMISSIONS.LEAD_BULK_ASSIGN),
    canDeleteLeads: hasCrmPermission(r, CRM_PERMISSIONS.LEAD_DELETE),
    canLaunchCampaigns: hasCrmPermission(r, CRM_PERMISSIONS.CAMPAIGN_LAUNCH),
    canManageDistributionRules: hasCrmPermission(r, CRM_PERMISSIONS.DISTRIBUTION_RULES_MANAGE),
    canManageCustomReports: hasCrmPermission(r, CRM_PERMISSIONS.CUSTOM_REPORTS_MANAGE),
  };
}

export function requireCrmPermission(permission) {
  return (req, res, next) => {
    const userRole = req.membership?.role || req.user?.role || 'AGENT';
    if (!hasCrmPermission(userRole, permission)) {
      return res.status(403).json({
        error: `Forbidden: Insufficient CRM permission '${permission}' for role '${userRole}'`,
      });
    }
    next();
  };
}
