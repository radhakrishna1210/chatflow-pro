import { z } from 'zod';
import { hasMeaningfulText } from '../lib/textValidation.js';

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

// Zod wrapper around the shared hasMeaningfulText() rule — reused across
// signup, campaigns, templates, and every automation module (workflows, AI
// agent, smart lists, WhatsApp forms) instead of each schema re-implementing
// its own regex.
function meaningfulText(schema, label = 'This field') {
  return schema.refine((v) => hasMeaningfulText(v), { message: `${label} must contain at least one letter` });
}

export const authSchemas = {
  register: z.object({
    name: meaningfulText(z.string().trim().min(1, 'Name is required').max(100), 'Name'),
    email: z.string().trim().email('Valid email required').max(254),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    role: z.enum(['ADMIN', 'CLIENT']).default('CLIENT'),
    inviteToken: z.string().trim().min(1).optional(),
  }),
  signupStart: z.object({
    name: meaningfulText(z.string().trim().min(1, 'Name is required').max(100), 'Name'),
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
  forgotPassword: z.object({ email: z.string().trim().email('Valid email required') }),
  resetPassword: z.object({
    email: z.string().trim().email('Valid email required'),
    code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
  }),
};

export const workspaceSchemas = {
  create: z.object({
    name: z.string().trim().min(1, 'Workspace name is required').max(100).optional(),
  }),
};

export const campaignSchemas = {
  create: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Campaign name'),
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

// Templates carry their actual message text inside a BODY component (e.g.
// [{ type: 'BODY', text: '...' }]) — the top-level `name` is just a Meta
// identifier slug, so the meaningful-text check has to look inside
// `components` rather than at `name`.
function checkBodyText(components, ctx) {
  if (!Array.isArray(components)) return;
  const body = components.find((c) => String(c?.type || '').toUpperCase() === 'BODY');
  if (body && !hasMeaningfulText(body.text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['components'],
      message: 'Template body must contain at least one letter — emoji/symbol-only text is not allowed',
    });
  }
}

export const templateSchemas = {
  create: z.object({
    name: z.string().trim().regex(/^[a-z0-9_]{1,64}$/, 'Lowercase letters, numbers, underscores only'),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
    language: z.string().trim().min(2).max(10),
    components: z.array(z.record(z.any())).min(1),
    waNumberId: id.optional(),
  }).superRefine((v, ctx) => checkBodyText(v.components, ctx)),
  update: z.object({
    name: z.string().trim().regex(/^[a-z0-9_]{1,64}$/).optional(),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).optional(),
    language: z.string().trim().min(2).max(10).optional(),
    components: z.array(z.record(z.any())).min(1).optional(),
  }).strict().superRefine((v, ctx) => checkBodyText(v.components, ctx)),
};

export const workflowSchemas = {
  create: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Workflow name'),
    nodes: z.any(),
    edges: z.any().optional().default([]),
    isActive: z.boolean().optional(),
  }),
  update: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Workflow name').optional(),
    nodes: z.any().optional(),
    edges: z.any().optional(),
    isActive: z.boolean().optional(),
  }).strict(),
};

export const automationSchemas = {
  createTrigger: z.object({
    keyword: meaningfulText(z.string().trim().min(1).max(80), 'Keyword'),
    responseTemplate: meaningfulText(z.string().trim().min(1).max(1000), 'Response message'),
    isActive: z.boolean().optional(),
  }),
  updateTrigger: z.object({
    keyword: meaningfulText(z.string().trim().min(1).max(80), 'Keyword').optional(),
    responseTemplate: meaningfulText(z.string().trim().min(1).max(1000), 'Response message').optional(),
    isActive: z.boolean().optional(),
  }).strict(),
};

export const whatsappFormSchemas = {
  create: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Form name'),
    fields: z.coerce.number().int().min(1).max(50).optional(),
  }),
  update: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Form name').optional(),
    fields: z.coerce.number().int().min(1).max(50).optional(),
    status: z.string().trim().min(1).max(30).optional(),
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
  testMessage: z.object({
    to: z.string().trim().min(6, 'A valid phone number is required').max(20),
    templateId: z.string().trim().min(1).max(64).optional(),
    message: z.string().trim().min(1).max(1000).optional(),
  }).refine((v) => v.templateId || v.message, {
    message: 'Provide a Template ID or a Message',
    path: ['message'],
  }),
};

const webhookUrl = z.string().trim().url('Must be a valid URL (e.g. https://your-server.com/webhook)')
  .refine((v) => /^https?:\/\//i.test(v), 'URL must start with http:// or https://');

export const settingsSchemas = {
  update: z.object({
    webhookUrl: z.union([webhookUrl, z.literal('')]).optional(),
    webhookEvents: z.array(z.enum(['messages', 'reactions', 'deliveries', 'reads', 'referrals'])).max(5).optional(),
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
