import { z } from 'zod';

// validate({ body, params, query }) — parsed values replace the originals so
// controllers receive clean, typed input instead of raw request payloads.
export function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body)   req.body   = schemas.body.parse(req.body ?? {});
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      if (schemas.query)  Object.assign(req.query, schemas.query.parse(req.query));
      next();
    } catch (err) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation error', details: err.flatten().fieldErrors });
      }
      next(err);
    }
  };
}

const id = z.string().min(1);

export const authSchemas = {
  register: z.object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    email: z.string().trim().email('Valid email required').max(254),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    role: z.enum(['ADMIN', 'CLIENT']).default('CLIENT'),
    inviteToken: z.string().trim().min(1).optional(),
  }),
  signupStart: z.object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    email: z.string().trim().email('Valid email required').max(254),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  }),
  signupVerify: z.object({
    email: z.string().trim().email('Valid email required'),
    code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    role: z.enum(['ADMIN', 'CLIENT']).default('CLIENT'),
    inviteToken: z.string().trim().min(1).optional(),
  }),
  signupResend: z.object({ email: z.string().trim().email('Valid email required') }),
  login: z.object({
    email: z.string().trim().email('Valid email required'),
    password: z.string().min(1, 'Password is required'),
  }),
  refresh: z.object({ refreshToken: z.string().min(1) }),
};

export const workspaceSchemas = {
  create: z.object({
    name: z.string().trim().min(1, 'Workspace name is required').max(100).optional(),
  }),
};

export const campaignSchemas = {
  create: z.object({
    name: z.string().trim().min(1).max(120),
    templateId: id,
    numberId: id.optional(),
    whatsappNumberId: id.optional(),
    replyRules: z.any().optional(),
    retryConfig: z.any().optional(),
    trackingConfig: z.any().optional(),
    fallbackConfig: z.any().optional(),
  }).passthrough().refine((v) => v.numberId || v.whatsappNumberId, { message: 'numberId is required' }),
  addRecipients: z.object({ contactIds: z.array(id).min(1, 'At least one contact is required').max(10_000) }),
  launch: z.object({ scheduledAt: z.union([z.string(), z.date(), z.null()]).optional() }),
};

export const contactSchemas = {
  create: z.object({
    name: z.string().trim().min(1).max(120),
    phoneNumber: z.string().trim().min(6).max(20),
    email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
    tags: z.array(z.string().trim().max(50)).max(30).optional().default([]),
  }),
  update: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    phoneNumber: z.string().trim().min(6).max(20).optional(),
    email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
    tags: z.array(z.string().trim().max(50)).max(30).optional(),
    optedOut: z.boolean().optional(),
  }).strict(),
};

export const segmentSchemas = {
  create: z.object({
    name: z.string().trim().min(1).max(80),
    desc: z.string().trim().max(300).optional().nullable(),
    color: z.string().trim().max(30).optional().nullable(),
  }),
  // Whitelist — blocks mass assignment of workspaceId/id/createdAt.
  update: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    desc: z.string().trim().max(300).optional().nullable(),
    color: z.string().trim().max(30).optional().nullable(),
  }).strict(),
};

export const templateSchemas = {
  create: z.object({
    name: z.string().trim().regex(/^[a-z0-9_]{1,64}$/, 'Lowercase letters, numbers, underscores only'),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
    language: z.string().trim().min(2).max(10),
    components: z.array(z.record(z.any())).min(1),
    waNumberId: id.optional(),
  }),
  update: z.object({
    name: z.string().trim().regex(/^[a-z0-9_]{1,64}$/).optional(),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).optional(),
    language: z.string().trim().min(2).max(10).optional(),
    components: z.array(z.record(z.any())).min(1).optional(),
  }).strict(),
};

export const workflowSchemas = {
  create: z.object({
    name: z.string().trim().min(1).max(120),
    nodes: z.any(),
    edges: z.any().optional().default([]),
    isActive: z.boolean().optional(),
  }),
  update: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    nodes: z.any().optional(),
    edges: z.any().optional(),
    isActive: z.boolean().optional(),
  }).strict(),
};

export const memberSchemas = {
  invite: z.object({
    email: z.string().trim().email(),
    role: z.enum(['ADMIN', 'CLIENT']).default('CLIENT'),
  }),
  updateRole: z.object({ role: z.enum(['ADMIN', 'CLIENT']) }),
};

export const apiKeySchemas = {
  create: z.object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    environment: z.string().trim().min(1).max(30).optional(),
  }),
};

const webhookUrl = z.string().trim().url('Must be a valid URL (e.g. https://your-server.com/webhook)')
  .refine((v) => /^https?:\/\//i.test(v), 'URL must start with http:// or https://');

export const settingsSchemas = {
  update: z.object({
    webhookUrl: z.union([webhookUrl, z.literal('')]).optional(),
    notifyNewConversation: z.boolean().optional(),
    notifyTemplateApproved: z.boolean().optional(),
    notifyTemplateRejected: z.boolean().optional(),
    notifyCampaignCompleted: z.boolean().optional(),
    notifyHighOptout: z.boolean().optional(),
    notifyRateLimit: z.boolean().optional(),
    emailNotifyCampaignCompleted: z.boolean().optional(),
    emailNotifyTemplateApproved: z.boolean().optional(),
    emailNotifyTemplateRejected: z.boolean().optional(),
    emailNotifyMemberInvite: z.boolean().optional(),
  }),
};

export const invitationSchemas = {
  create: z.object({
    email: z.string().trim().email(),
    role: z.enum(['ADMIN', 'CLIENT']).default('CLIENT'),
  }),
};
