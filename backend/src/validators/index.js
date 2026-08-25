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

// The roles a workspace can hand out, ordered as the UI lists them. Declared
// once so the invite, link-invite and role-change schemas cannot drift apart —
// they were four separate copies of ['ADMIN', 'CLIENT'].
const workspaceRole = () => z.enum(['VIEWER', 'AGENT', 'CLIENT', 'ADMIN']);

export const authSchemas = {
  register: z.object({
    name: meaningfulText(z.string().trim().min(1, 'Name is required').max(100), 'Name'),
    email: z.string().trim().email('Valid email required').max(254),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    // Accepted for backwards compatibility and deliberately not honoured: a
    // self-registered user gets no workspace at all until they create one
    // (which makes them ADMIN of it) or accept an invite (which sets the role
    // the inviter chose). See services/auth.service.js#register.
    role: workspaceRole().default('CLIENT'),
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
    // Inert, as in `register` above.
    role: workspaceRole().default('CLIENT'),
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

// The campaign's AI Agent block. `agentId` is only shape-checked here — it is
// resolved against the workspace's own agent in campaigns.service.js, because
// an id that parses is not the same as an id the caller is allowed to use.
const aiAgentConfig = z.object({
  enabled: z.boolean().default(false),
  agentId: z.union([id, z.null()]).optional(),
  ctaLabel: meaningfulText(z.string().trim().min(1).max(25), 'CTA label').optional(),
}).strict();

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
    aiAgent: aiAgentConfig.optional(),
    goal: z.enum(['sales', 'launch', 'reengage', 'nurture']).optional(),
  }).passthrough().refine((v) => v.numberId || v.whatsappNumberId, { message: 'numberId is required' }),
  addRecipients: z.object({ contactIds: z.array(id).min(1, 'At least one contact is required').max(10_000) }),
  // Replacing an audience may legitimately empty it — a draft mid-edit does
  // not have to have anyone selected yet. Launch is what insists on that.
  setRecipients: z.object({ contactIds: z.array(id).max(10_000) }),
  update: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Campaign name').optional(),
    replyRules: z.any().optional(),
    retryConfig: z.any().optional(),
    trackingConfig: z.any().optional(),
    fallbackConfig: z.any().optional(),
    aiAgent: aiAgentConfig.optional(),
    // Editable while the campaign is still a draft; the service enforces that.
    templateId: id.optional(),
    numberId: id.optional(),
    whatsappNumberId: id.optional(),
    scheduledAt: z.union([z.string(), z.date(), z.null()]).optional(),
    goal: z.enum(['sales', 'launch', 'reengage', 'nurture']).optional(),
  }).passthrough(),
  launch: z.object({
    scheduledAt: z.union([z.string(), z.date(), z.null()]).optional(),
    retryConfig: z.any().optional(),
  }),
  // Either a selection of contacts (wizard, before the campaign exists) or an
  // existing draft campaign.
  estimate: z.object({
    contactIds: z.array(id).max(10_000).optional(),
    campaignId: id.optional(),
    // Drives per-category message pricing before the campaign row exists.
    templateId: id.optional(),
  }).refine((v) => (v.contactIds && v.contactIds.length > 0) || v.campaignId, {
    message: 'Provide contactIds or a campaignId',
    path: ['contactIds'],
  }),
};

export const contactSchemas = {
  create: z.object({
    name: z.string().trim().min(1).max(120),
    phoneNumber: z.string().trim().min(6).max(20),
    email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
    tags: z.array(z.string().trim().max(50)).max(30).optional().default([]),
    // Shape only. The keys and value types are checked against the workspace's
    // own field definitions in customFields.service.js#validateCustomFields —
    // a schema here could not know what fields this workspace has.
    customFields: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
  }),
  update: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    phoneNumber: z.string().trim().min(6).max(20).optional(),
    email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
    tags: z.array(z.string().trim().max(50)).max(30).optional(),
    optedOut: z.boolean().optional(),
    customFields: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
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
    // Stored bytes of the header image, so a campaign can re-send the picture
    // after approval. Zod strips unknown keys, so it has to be declared here
    // or it never reaches the service.
    headerAssetId: id.optional(),
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

  // Basic Automations now carry the reply text and working hours, not just the
  // three on/off flags. The schedule (businessHours) and the on/off switch
  // (businessHoursEnabled) are independent so disabling never wipes the days.
  updateBasic: z.object({
    autoOooEnabled: z.boolean().optional(),
    autoWelcomeEnabled: z.boolean().optional(),
    autoDelayedEnabled: z.boolean().optional(),
    welcomeMessage: meaningfulText(z.string().trim().min(1).max(1000), 'Welcome message').optional(),
    oooMessage: meaningfulText(z.string().trim().min(1).max(1000), 'Out-of-office message').optional(),
    delayedMessage: meaningfulText(z.string().trim().min(1).max(1000), 'Delayed response message').optional(),
    delayedAfterMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    businessHoursEnabled: z.boolean().optional(),
    businessHours: z.object({
      tz: z.string().trim().min(1).max(64).optional(),
      enabled: z.boolean().optional(),
      days: z.array(z.object({
        day: z.coerce.number().int().min(0).max(6),
        enabled: z.boolean(),
        start: z.string().trim().optional(),
        end: z.string().trim().optional(),
      })).max(7),
    }).nullable().optional(),
  }).strict(),
};

const formField = z.object({
  key: z.string().trim().max(60).optional(),
  label: meaningfulText(z.string().trim().min(1).max(300), 'Question'),
  type: z.enum(['text', 'email', 'phone', 'number', 'choice']).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
});

export const instagramSchemas = {
  create: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Flow name'),
    source: z.enum(['dm', 'comment', 'story_reply']).optional(),
    // Empty keyword is legal — it means "reply to everything on this source".
    keyword: z.string().trim().max(80).optional(),
    responseTemplate: meaningfulText(z.string().trim().min(1).max(1000), 'Reply message'),
    alsoSendDm: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }),
  update: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Flow name').optional(),
    source: z.enum(['dm', 'comment', 'story_reply']).optional(),
    keyword: z.string().trim().max(80).optional(),
    responseTemplate: meaningfulText(z.string().trim().min(1).max(1000), 'Reply message').optional(),
    alsoSendDm: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }).strict(),
};

export const whatsappFormSchemas = {
  create: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Form name'),
    // `schema` is the real field list; the old numeric `fields` is derived from
    // it server-side and no longer accepted from the client.
    schema: z.array(formField).max(50).optional(),
    // Display-only tags; deduplicated and capped server-side.
    categories: z.array(z.string().trim().max(40)).max(10).optional(),
    keyword: z.string().trim().max(80).optional(),
    completionMessage: meaningfulText(z.string().trim().min(1).max(1000), 'Completion message').optional(),
    status: z.enum(['Draft', 'Active']).optional(),
  }),
  update: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Form name').optional(),
    schema: z.array(formField).max(50).optional(),
    categories: z.array(z.string().trim().max(40)).max(10).optional(),
    keyword: z.string().trim().max(80).optional(),
    completionMessage: meaningfulText(z.string().trim().min(1).max(1000), 'Completion message').optional(),
    status: z.enum(['Draft', 'Active']).optional(),
  }).strict(),
};

export const memberSchemas = {
  invite: z.object({
    email: z.string().trim().email(),
    role: workspaceRole().default('CLIENT'),
  }),
  updateRole: z.object({ role: workspaceRole() }),
};

export const apiKeySchemas = {
  create: z.object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    environment: z.string().trim().min(1).max(30).optional(),
    // Validated against the catalogue in lib/apiScopes.js, which raises a 400
    // naming any unknown scope. Omitted means the safe default set.
    scopes: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  }),
  testMessage: z.object({
    to: z.string().trim().min(6, 'A valid phone number is required').max(24),
    templateId: z.string().trim().min(1).max(64).optional(),
    message: z.string().trim().min(1).max(1000).optional(),
    // Values for a template's {{1}}, {{2}}, … placeholders, in order.
    variables: z.array(z.string().max(500)).max(20).optional().default([]),
  }).refine((v) => v.templateId || v.message, {
    message: 'Provide a Template ID or a Message',
    path: ['message'],
  }),
};

export const optOutSchemas = {
  block: z.object({
    phoneNumber: z.string().trim().min(6, 'A valid phone number is required').max(24),
    reason: z.string().trim().max(200).optional(),
  }),
  bulkUnblock: z.object({
    ids: z.array(id).min(1, 'Select at least one number to unblock').max(500),
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
    // Workspace profile and branding. The service validates the colour, the
    // logo scheme and the time zone properly — this layer only keeps obvious
    // junk and oversized payloads out of it.
    name: z.string().trim().min(1, 'Workspace name is required').max(120).optional(),
    industry: z.union([z.string().trim().max(80), z.literal('')]).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour').optional(),
    brandLogoUrl: z.union([z.string().trim().url().max(500), z.literal('')]).optional(),
  }),
};

export const invitationSchemas = {
  create: z.object({
    email: z.string().trim().email(),
    role: workspaceRole().default('CLIENT'),
  }),
  // A shareable link takes no address. maxUses caps how many people can join
  // through it; omitted means unlimited until it expires or is revoked.
  createLink: z.object({
    role: workspaceRole().default('CLIENT'),
    maxUses: z.coerce.number().int().positive().max(500).optional(),
  }),
};

const phone = z.string().trim().max(30).regex(/^[0-9+\-\s()]{6,30}$/, 'Enter a valid phone number');

export const userSchemas = {
  updateProfile: z.object({
    name: z.string().trim().min(1, 'Name is required').max(100).optional(),
    phone: z.union([phone, z.literal('')]).optional(),
    jobTitle: z.union([z.string().trim().max(100), z.literal('')]).optional(),
    company: z.union([z.string().trim().max(100), z.literal('')]).optional(),
    timezone: z.union([z.string().trim().max(60), z.literal('')]).optional(),
    language: z.union([z.string().trim().max(60), z.literal('')]).optional(),
  }).strict(),
  changePassword: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128)
      .regex(/[a-zA-Z]/, 'Password must include at least one letter')
      .regex(/[0-9]/, 'Password must include at least one number'),
  }).refine((v) => v.newPassword !== v.currentPassword, {
    message: 'New password must be different from your current password',
    path: ['newPassword'],
  }),
  // Password for ordinary accounts; confirmEmail for Google accounts, which
  // have no password to re-authenticate against. The service decides which
  // one it requires — both are optional here.
  deleteAccount: z.object({
    password: z.string().max(128).optional(),
    confirmEmail: z.string().trim().max(200).optional(),
  }),
};

export const clusterSchemas = {
  create: z.object({
    name: z.string().trim().min(1, 'Cluster name is required').max(120),
    description: z.union([z.string().trim(), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
    contactIds: z.array(z.string().min(1)).min(1, 'At least one contact must be selected').max(10_000),
  }),
  update: z.object({
    name: z.string().trim().min(1, 'Cluster name is required').max(120).optional(),
    description: z.union([z.string().trim(), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
    contactIds: z.array(z.string().min(1)).min(1, 'At least one contact must be selected').max(10_000).optional(),
  }),
};
