import { z } from 'zod';
import * as authenticationConfigService from './authentication-config.service.js';

// Query for GET /authentication/analytics. A malformed value is a 400 (the
// error handler turns a ZodError into one), not a silently ignored filter.
const usageQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(['PENDING', 'VERIFIED', 'EXPIRED', 'FAILED']).optional(),
  source: z.enum(['API', 'CAMPAIGN']).optional(),
  templateId: z.string().trim().min(1).max(64).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export async function getConfiguration(req, res) {
  const result =
    await authenticationConfigService.getAuthenticationConfiguration(
      req.params.workspaceId
    );

  res.json(result);
}

export async function updateConfiguration(req, res) {
  const result =
    await authenticationConfigService.updateAuthenticationConfiguration(
      req.params.workspaceId,
      req.body
    );

  res.json(result);
}

export async function getUsage(req, res) {
  const result =
    await authenticationConfigService.getAuthenticationUsage(
      req.params.workspaceId,
      usageQuery.parse(req.query ?? {})
    );

  res.json(result);
}
