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
  }).passthrough().refine((v) => v.numberId || v.whatsappNumberId, { message: 'numberId is required' }),
  addRecipients: z.object({ contactIds: z.array(id).min(1, 'At least one contact is required').max(10_000) }),
  update: z.object({
    name: meaningfulText(z.string().trim().min(1).max(120), 'Campaign name').optional(),
    replyRules: z.any().optional(),
    retryConfig: z.any().optional(),
    trackingConfig: z.any().optional(),
    fallbackConfig: z.any().optional(),
    aiAgent: aiAgentConfig.optional(),
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
    email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
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
  // three on/off flags. businessHours: null means "always open".
  updateBasic: z.object({
    autoOooEnabled: z.boolean().optional(),
    autoWelcomeEnabled: z.boolean().optional(),
    autoDelayedEnabled: z.boolean().optional(),
    welcomeMessage: meaningfulText(z.string().trim().min(1).max(1000), 'Welcome message').optional(),
    oooMessage: meaningfulText(z.string().trim().min(1).max(1000), 'Out-of-office message').optional(),
    delayedMessage: meaningfulText(z.string().trim().min(1).max(1000), 'Delayed response message').optional(),
    delayedAfterMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    businessHours: z.object({
      tz: z.string().trim().min(1).max(64).optional(),
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
    // Turns a campaign reply into a CRM lead. Off by default.
    autoLeadFromReply: z.boolean().optional(),
  }),
};

export const invitationSchemas = {
  create: z.object({
    email: z.string().trim().email(),
    role: z.enum(['ADMIN', 'CLIENT']).default('CLIENT'),
  }),
  // A shareable link takes no address. maxUses caps how many people can join
  // through it; omitted means unlimited until it expires or is revoked.
  createLink: z.object({
    role: z.enum(['ADMIN', 'CLIENT']).default('CLIENT'),
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

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST'];
const DEAL_STAGES = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

export const leadSchemas = {
  create: z.object({
    contactId: id.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    phoneNumber: z.string().trim().min(6).max(20).optional(),
    email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    source: z.union([z.string().trim().max(60), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    ownerUserId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    notes: z.union([z.string().trim().max(2000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
  }).refine((d) => d.contactId || (d.name && d.phoneNumber) || d.phoneNumber, {
    message: 'Provide contactId, or a phoneNumber to create the contact',
  }),
  update: z.object({
    status: z.enum(LEAD_STATUSES).optional(),
    ownerUserId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    source: z.union([z.string().trim().max(60), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    notes: z.union([z.string().trim().max(2000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    // Shape only. The values are validated against the workspace's field
    // definitions in customFields.service.js, which is the only place that
    // knows what a given key is allowed to contain.
    customFields: z.record(z.any()).nullable().optional(),
  }).strict(),
  convert: z.object({
    title: z.string().trim().min(1, 'Deal title is required').max(160),
    value: z.coerce.number().nonnegative().optional().nullable(),
    currency: z.string().trim().length(3).optional(),
    stage: z.enum(DEAL_STAGES).optional(),
    expectedCloseDate: z.coerce.date().optional().nullable(),
    ownerUserId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
  }),
};

// Line-item money is never accepted from the client — subtotal, taxAmount and
// total are absent from these schemas by design and are computed server-side.
const lineItemBase = {
  productId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
  name: z.string().trim().min(1).max(160).optional(),
  quantity: z.coerce.number().positive().max(1_000_000).optional(),
  unitPrice: z.coerce.number().nonnegative().max(1_000_000_000).optional(),
  discountPct: z.coerce.number().min(0).max(100).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
};

export const productSchemas = {
  create: z.object({
    name: z.string().trim().min(1, 'Product name is required').max(160),
    sku: z.union([z.string().trim().max(60), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    category: z.union([z.string().trim().max(60), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    description: z.union([z.string().trim().max(2000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    unitPrice: z.coerce.number().nonnegative().max(1_000_000_000),
    currency: z.string().trim().length(3).optional(),
    unit: z.union([z.string().trim().max(24), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    taxRate: z.coerce.number().min(0).max(100).optional(),
    isService: z.boolean().optional(),
  }),
  update: z.object({
    name: z.string().trim().min(1).max(160).optional(),
    sku: z.union([z.string().trim().max(60), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    category: z.union([z.string().trim().max(60), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    description: z.union([z.string().trim().max(2000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    unitPrice: z.coerce.number().nonnegative().max(1_000_000_000).optional(),
    currency: z.string().trim().length(3).optional(),
    unit: z.union([z.string().trim().max(24), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    taxRate: z.coerce.number().min(0).max(100).optional(),
    isService: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }).strict(),
};

export const quoteSchemas = {
  create: z.object({
    dealId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    contactId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    currency: z.string().trim().length(3).optional(),
    discountPct: z.coerce.number().min(0).max(100).optional(),
    validUntil: z.coerce.date().optional().nullable(),
    terms: z.union([z.string().trim().max(4000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    notes: z.union([z.string().trim().max(2000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    fromDealLineItems: z.boolean().optional(),
  }),
  update: z.object({
    discountPct: z.coerce.number().min(0).max(100).optional(),
    validUntil: z.coerce.date().optional().nullable(),
    terms: z.union([z.string().trim().max(4000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    notes: z.union([z.string().trim().max(2000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
  }).strict(),
  status: z.object({
    status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']),
  }).strict(),
  lineItem: z.object(lineItemBase),
};

export const pipelineStageSchemas = {
  update: z.object({
    label: z.string().trim().min(1, 'Stage label is required').max(40).optional(),
    probability: z.coerce.number().int().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
  }).strict(),
  reorder: z.object({
    keys: z.array(z.enum(DEAL_STAGES)).min(1),
  }).strict(),
};

// Step shape is checked properly by validateSteps() in the engine, which is
// also what runs on publish. This only keeps obvious junk out of the body.
const sequenceStep = z.object({
  kind: z.enum(['MESSAGE', 'WAIT', 'TASK', 'UPDATE_FIELD', 'EXIT']),
  body: z.string().max(4096).optional(),
  minutes: z.coerce.number().optional(),
  title: z.string().max(200).optional(),
  dueInDays: z.coerce.number().optional(),
  status: z.string().max(40).optional(),
  reason: z.string().max(200).optional(),
}).passthrough();

export const sequenceSchemas = {
  create: z.object({
    name: z.string().trim().min(1, 'A sequence needs a name').max(120),
    description: z.union([z.string().trim().max(500), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    steps: z.array(sequenceStep).min(1).max(50),
    respectBusinessHours: z.boolean().optional(),
    exitOnReply: z.boolean().optional(),
  }),
  update: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.union([z.string().trim().max(500), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    steps: z.array(sequenceStep).min(1).max(50).optional(),
    respectBusinessHours: z.boolean().optional(),
    exitOnReply: z.boolean().optional(),
  }).strict(),
  status: z.object({
    status: z.enum(['DRAFT', 'PUBLISHED', 'PAUSED']),
  }).strict(),
  enroll: z.object({
    contactIds: z.array(id).max(1000).optional().default([]),
    leadIds: z.array(id).max(1000).optional().default([]),
  }).strict(),
};

const TICKET_STATUSES = ['NEW', 'OPEN', 'WAITING', 'RESOLVED', 'CLOSED'];
const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export const ticketSchemas = {
  create: z.object({
    subject: z.string().trim().min(1, 'A ticket needs a subject').max(200),
    description: z.union([z.string().trim().max(5000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    category: z.union([z.string().trim().max(60), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    contactId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    ownerUserId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    teamId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    conversationId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
  }),
  // `status` is absent by design — it moves only through /status, which is what
  // enforces the transition rules and stamps resolvedAt/closedAt.
  update: z.object({
    subject: z.string().trim().min(1).max(200).optional(),
    description: z.union([z.string().trim().max(5000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    category: z.union([z.string().trim().max(60), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    ownerUserId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    teamId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
  }).strict(),
  status: z.object({
    status: z.enum(TICKET_STATUSES),
  }).strict(),
};

const leadFormField = z.object({
  key: z.string().trim().max(60).optional(),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'email', 'phone', 'textarea', 'select']).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});

export const leadFormSchemas = {
  create: z.object({
    name: z.string().trim().min(1, 'A form needs a name').max(120),
    slug: z.string().trim().max(60).optional(),
    description: z.union([z.string().trim().max(500), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    fields: z.array(leadFormField).min(1).max(25),
    successMessage: z.string().trim().min(1).max(300).optional(),
    consentText: z.union([z.string().trim().max(500), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    source: z.union([z.string().trim().max(60), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    ownerUserId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    isActive: z.boolean().optional(),
  }),
  update: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.union([z.string().trim().max(500), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    fields: z.array(leadFormField).min(1).max(25).optional(),
    successMessage: z.string().trim().min(1).max(300).optional(),
    consentText: z.union([z.string().trim().max(500), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    source: z.union([z.string().trim().max(60), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    ownerUserId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    isActive: z.boolean().optional(),
  }).strict(),
  // Public submission. Deliberately permissive in shape — the real validation
  // is against the form's own field definitions, which this layer cannot see.
  // `_hp` is the honeypot and must be accepted so it can be inspected.
  submit: z.object({
    answers: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
    attribution: z.record(z.string()).optional(),
    consent: z.boolean().optional(),
    _hp: z.string().max(200).optional(),
  }).strict(),
};

export const teamSchemas = {
  create: z.object({
    name: z.string().trim().min(1, 'A team needs a name').max(80),
    description: z.union([z.string().trim().max(300), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
  }),
  update: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.union([z.string().trim().max(300), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
  }).strict(),
  members: z.object({
    // The full membership list, not a delta — a partial update would make
    // "who is on this team" depend on request ordering.
    userIds: z.array(id).max(500),
  }).strict(),
  visibility: z.object({
    recordVisibility: z.enum(['ALL', 'TEAM', 'OWN']),
  }).strict(),
};

const CUSTOM_FIELD_TYPES = [
  'TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN',
  'DROPDOWN', 'MULTISELECT', 'URL', 'EMAIL', 'PHONE', 'USER',
];

export const customFieldSchemas = {
  create: z.object({
    entity: z.enum(['lead', 'deal']),
    label: z.string().trim().min(1, 'A field needs a label').max(60),
    type: z.enum(CUSTOM_FIELD_TYPES).optional(),
    options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    helpText: z.union([z.string().trim().max(200), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    required: z.boolean().optional(),
  }),
  // Neither `key` nor `type` appears here: values already stored are shaped by
  // them, so changing either after the fact would reinterpret existing data.
  update: z.object({
    label: z.string().trim().min(1).max(60).optional(),
    options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    helpText: z.union([z.string().trim().max(200), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    required: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  }).strict(),
};

const SAVED_VIEW_ENTITIES = ['leads', 'deals', 'tasks'];

export const savedViewSchemas = {
  create: z.object({
    entity: z.enum(SAVED_VIEW_ENTITIES),
    name: z.string().trim().min(1, 'View name is required').max(60),
    // The stored query is whatever the list screen understands. Capped so a
    // saved view cannot be used to stash arbitrary payloads in the database.
    filters: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
    isShared: z.boolean().optional().default(false),
  }),
  update: z.object({
    name: z.string().trim().min(1).max(60).optional(),
    filters: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    isShared: z.boolean().optional(),
  }).strict(),
};

export const dealSchemas = {
  create: z.object({
    contactId: id,
    leadId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    title: z.string().trim().min(1, 'Deal title is required').max(160),
    value: z.coerce.number().nonnegative().optional().nullable(),
    currency: z.string().trim().length(3).optional(),
    stage: z.enum(DEAL_STAGES).optional(),
    ownerUserId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    expectedCloseDate: z.coerce.date().optional().nullable(),
  }),
  update: z.object({
    title: z.string().trim().min(1).max(160).optional(),
    value: z.coerce.number().nonnegative().optional().nullable(),
    currency: z.string().trim().length(3).optional(),
    ownerUserId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    expectedCloseDate: z.coerce.date().optional().nullable(),
    customFields: z.record(z.any()).nullable().optional(),
  }).strict(),
  stageUpdate: z.object({
    stage: z.enum(DEAL_STAGES),
    lostReason: z.union([z.string().trim().max(500), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
  }).strict(),
  lineItem: z.object(lineItemBase),
  lineItemUpdate: z.object(lineItemBase).strict(),
};

const TASK_STATUSES = ['PENDING', 'COMPLETED'];
const CRM_ACTIVITY_TYPES = ['NOTE', 'CALL', 'EMAIL', 'MEETING'];

// A nullable foreign key supplied by the client. The schema only proves the
// shape — services still have to prove the referenced row is in this
// workspace, which is what stops a task being pinned to someone else's deal.
const optionalRef = z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null)));

export const taskSchemas = {
  create: z.object({
    title: z.string().trim().min(1, 'Task title is required').max(200),
    description: z.union([z.string().trim().max(2000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    status: z.enum(TASK_STATUSES).optional(),
    dueDate: z.coerce.date().optional().nullable(),
    assignedToUserId: optionalRef,
    leadId: optionalRef,
    dealId: optionalRef,
    contactId: optionalRef,
  }),
  // .strict() is what keeps `workspaceId` out of the update payload — without
  // it the service spreads the body into prisma.task.update and the task
  // silently moves to whatever workspace the caller names.
  update: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.union([z.string().trim().max(2000), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    status: z.enum(TASK_STATUSES).optional(),
    dueDate: z.coerce.date().optional().nullable(),
    assignedToUserId: optionalRef,
    leadId: optionalRef,
    dealId: optionalRef,
    contactId: optionalRef,
  }).strict(),
};

export const crmActivitySchemas = {
  create: z.object({
    type: z.enum(CRM_ACTIVITY_TYPES).optional(),
    content: z.string().trim().min(1, 'Activity content is required').max(5000),
    leadId: optionalRef,
    dealId: optionalRef,
    contactId: optionalRef,
  }),
};

export const clusterSchemas = {
  create: z.object({
    name: z.string().trim().min(1, 'Cluster name is required').max(120),
    description: z.union([z.string().trim(), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : (v || null))),
    contactIds: z.array(z.string().min(1)).min(1, 'At least one contact must be selected').max(10_000),
  }),
  update: z.object({
    name: z.string().trim().min(1, 'Cluster name is required').max(120).optional(),
    description: z.union([z.string().trim(), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
    contactIds: z.array(z.string().min(1)).min(1, 'At least one contact must be selected').max(10_000).optional(),
  }),
};
