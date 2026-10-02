import { z } from 'zod';

// Per-section shapes for Customize Your Business. Each section used to accept
// any object, so a malformed save could store something the CRM screens then
// crash on. Known fields are type- and length-checked; objects pass unknown
// keys through so presentational fields the UI adds are not silently dropped,
// and the whole payload is size-capped instead.

export const MAX_SECTION_BYTES = 64 * 1024;

const text = (max) => z.string().trim().max(max);
const optText = (max) => text(max).nullable().optional();
const flag = z.boolean().optional();
// Number inputs sometimes arrive as strings; the consumers coerce them.
const num = z.union([z.number().finite(), text(20)]).nullable().optional();
const color = optText(32);
const itemId = optText(64);

// Stage keys become pipeline stage rows and lead status filters, so they keep
// to the shape the UI generates: capitals, digits and underscores.
export const STAGE_KEY = z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,49}$/, 'Stage keys use capital letters, digits and underscores (max 50)');

const loose = (shape) => z.object(shape).passthrough();

const outcomes = loose({
  outcomes: z.array(loose({
    id: itemId,
    name: text(100).min(1, 'Every outcome needs a name'),
    sentiment: optText(20),
    icon: optText(40),
    sortOrder: num,
    triggersFollowUp: flag,
  })).max(100),
});

export const SECTION_SCHEMAS = {
  lead_lifecycle: loose({
    stages: z.array(loose({
      key: STAGE_KEY,
      label: text(60).min(1, 'Every stage needs a label'),
      color,
      isDefault: flag,
      isProtected: flag,
      sortOrder: num,
      description: optText(300),
    })).min(1, 'At least one lifecycle stage is required').max(30),
  }),

  prospecting_criteria: loose({
    minBudget: num,
    currency: optText(8),
    companySizeMin: num,
    requirePhone: flag,
    requireEmail: flag,
    requireCompany: flag,
    targetIndustries: z.array(text(80)).max(50).optional(),
    checklist: z.array(loose({
      id: itemId,
      question: text(300),
      required: flag,
      weight: num,
    })).max(30).optional(),
  }),

  deal_mode: loose({
    mode: z.enum(['FLEXIBLE', 'AUTOMATIC']).optional(),
    description: optText(500),
    autoTaskConfig: loose({
      followUpDueDays: num,
      defaultPriority: optText(20),
      notifyOwner: flag,
      stageTaskTemplates: z.record(text(300).nullable()).optional(),
    }).optional(),
  }),

  lead_tags: loose({
    tags: z.array(loose({
      id: itemId,
      name: text(60).min(1, 'Every tag needs a name'),
      color,
      category: optText(60),
    })).max(200),
  }),

  lead_sources: loose({
    sources: z.array(loose({
      id: itemId,
      key: text(50).min(1, 'Every source needs an identifier'),
      name: text(80).min(1, 'Every source needs a name'),
      category: optText(60),
      isActive: flag,
      utmSource: optText(80),
    })).max(200),
  }),

  call_outcomes: outcomes,
  visit_outcomes: outcomes,

  deal_setup: loose({
    stages: z.array(loose({
      key: STAGE_KEY,
      label: optText(60),
      probability: num,
      color,
      slaDays: num,
      sortOrder: num,
      isActive: flag,
    })).min(1, 'At least one deal stage is required').max(30),
  }),

  ticket_customization: loose({
    stages: z.array(loose({
      id: itemId,
      key: text(50).min(1),
      label: text(60).min(1),
      color,
      isDefault: flag,
      sortOrder: num,
    })).max(30).optional(),
    categories: z.array(loose({
      id: itemId,
      name: text(80).min(1, 'Every category needs a name'),
      slaHours: num,
      priority: optText(20),
      color,
      description: optText(300),
    })).max(100).optional(),
  }),

  document_categories: loose({
    categories: z.array(loose({
      id: itemId,
      name: text(80).min(1),
      color,
      subcategories: z.array(text(120)).max(50).optional(),
    })).max(50),
  }),
};

// Returns the parsed section or throws a 400 naming the first problem.
export function parseSectionPayload(sectionKey, data) {
  const schema = SECTION_SCHEMAS[sectionKey];
  if (!schema) {
    const e = new Error(`Invalid customization section: ${sectionKey}`); e.status = 400; throw e;
  }
  if (JSON.stringify(data ?? null).length > MAX_SECTION_BYTES) {
    const e = new Error('This configuration is too large to save'); e.status = 400; throw e;
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');
    const e = new Error(field ? `${issue.message} (${field})` : issue.message);
    e.status = 400;
    throw e;
  }
  return result.data;
}
