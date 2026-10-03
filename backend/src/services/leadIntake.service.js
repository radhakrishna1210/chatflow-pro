import { getSection } from './crmCustomization.service.js';

// One set of rules for every way a lead enters or changes in the CRM.
//
// Customize Your Business configures lifecycle stages, lead sources, lead tags
// and prospecting criteria. They used to be checked only when a lead was
// created or edited in the CRM screen; web forms, CSV import, campaign-reply
// leads, workflows and sequences wrote whatever they had. Every intake path
// now resolves its values here.
//
// Two modes:
//
//   strict   someone is typing the values (CRM create/edit, bulk edits, API):
//            anything outside the configuration is a 400 they can fix.
//   lenient  nobody is there to fix it (public form, CSV row, inbound reply,
//            automation): the lead is still created — losing an inbound lead
//            over a configuration mismatch is worse — but the value is mapped
//            onto the configuration (default stage, a fallback source, unknown
//            tags dropped) and every adjustment is reported back. Missing
//            required prospecting fields mark the lead not qualified instead
//            of rejecting it.

// Statuses outside the configurable lifecycle: CONVERTED is set by conversion
// and LOST is the built-in terminal state. Neither can be removed by a
// lifecycle edit, so both are always valid.
const SYSTEM_STATUSES = ['CONVERTED', 'LOST'];

export const PRISMA_LEAD_STATUSES = new Set(['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST']);

const badRequest = (message) => { const e = new Error(message); e.status = 400; return e; };
const norm = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '_');
const lower = (v) => String(v ?? '').trim().toLowerCase();

/** The four sections intake depends on, read once per write. */
export async function loadLeadIntakeRules(workspaceId) {
  const read = (key) => getSection(workspaceId, key).catch(() => null);
  const [lifecycle, sources, tags, criteria] = await Promise.all([
    read('lead_lifecycle'), read('lead_sources'), read('lead_tags'), read('prospecting_criteria'),
  ]);
  return { lifecycle, sources, tags, criteria };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

const lifecycleStages = (rules) => (Array.isArray(rules?.lifecycle?.stages) ? rules.lifecycle.stages.filter((s) => s?.key) : []);

export function defaultStatus(rules) {
  const stages = lifecycleStages(rules);
  return stages.find((s) => s.isDefault)?.key || stages[0]?.key || 'NEW';
}

/**
 * Maps a requested status (key or label, any case) onto the lifecycle.
 * -> { key, status, statusKey, adjusted }: `status` is the DB enum value and
 * `statusKey` the custom lifecycle key stored in customFields, or null.
 */
export function resolveLeadStatus(rules, requested, { strict = true } = {}) {
  const stages = lifecycleStages(rules);
  const wanted = norm(requested);
  let key = null;
  let adjusted = null;

  if (!wanted) {
    key = defaultStatus(rules);
  } else if (SYSTEM_STATUSES.includes(wanted)) {
    key = wanted;
  } else if (stages.length === 0) {
    // No lifecycle at all (a broken config read): only the built-ins are known.
    key = PRISMA_LEAD_STATUSES.has(wanted) ? wanted : null;
  } else {
    key = stages.find((s) => norm(s.key) === wanted || norm(s.label) === wanted)?.key ?? null;
  }

  if (!key) {
    if (strict) {
      throw badRequest(`"${requested}" is not a stage in this workspace's lead lifecycle (Customize Your Business -> Lead Lifecycle).`);
    }
    key = defaultStatus(rules);
    adjusted = `Status "${requested}" is not in the lead lifecycle; set to ${key}`;
  }

  const builtIn = PRISMA_LEAD_STATUSES.has(key);
  return { key, status: builtIn ? key : 'NEW', statusKey: builtIn ? null : key, adjusted };
}

/**
 * The `status` + `customFields` write for moving a lead to `requested`,
 * merged over the lead's current customFields. Used by every status writer
 * (edit, bulk edit, workflows, sequences) so a custom stage is never written
 * to the enum column and a built-in one always clears a stale custom key.
 */
export function leadStatusWrite(rules, requested, currentCustomFields, options) {
  const resolved = resolveLeadStatus(rules, requested, options);
  const customFields = currentCustomFields && typeof currentCustomFields === 'object' ? { ...currentCustomFields } : {};
  if (resolved.statusKey) customFields.statusKey = resolved.statusKey;
  else delete customFields.statusKey;
  return {
    resolved,
    data: { status: resolved.status, customFields: Object.keys(customFields).length > 0 ? customFields : null },
  };
}

// ─── Sources ─────────────────────────────────────────────────────────────────

const configuredSources = (rules) => (Array.isArray(rules?.sources?.sources) ? rules.sources.sources.filter((s) => s?.key) : []);

const findSource = (sources, value) => {
  const v = lower(value);
  if (!v) return null;
  return sources.find((s) => lower(s.key) === v || lower(s.name) === v || (s.utmSource && lower(s.utmSource) === v)) ?? null;
};

/**
 * Maps a requested source (key, name or UTM source) onto the configured
 * sources. -> { source, detail, adjusted }. `detail` keeps the original
 * label ("Campaign: Diwali Offer") when a fallback source had to be used.
 *
 * Lenient callers pass `fallbacks`: source keys to try, in order, when the
 * requested one is unknown or disabled ("OTHER" is always tried last).
 */
export function resolveLeadSource(rules, requested, { strict = true, fallbacks = [] } = {}) {
  const raw = String(requested ?? '').trim() || null;
  const sources = configuredSources(rules);
  if (sources.length === 0) return { source: raw, detail: null, adjusted: null };
  // No source given: none is invented unless the channel names its own.
  if (!raw && (strict || fallbacks.length === 0)) return { source: null, detail: null, adjusted: null };

  const matched = findSource(sources, raw);
  if (matched && matched.isActive !== false) return { source: matched.key, detail: null, adjusted: null };

  if (strict) {
    throw badRequest(matched
      ? `Lead source "${matched.name || raw}" is disabled and cannot be selected.`
      : `Invalid lead source "${raw}". Please select from configured lead sources.`);
  }

  for (const key of [...fallbacks, 'OTHER']) {
    const fb = findSource(sources, key);
    if (fb && fb.isActive !== false) {
      return {
        source: fb.key,
        detail: raw,
        adjusted: raw ? `Source "${raw}" is not a configured lead source; recorded as ${fb.key}` : null,
      };
    }
  }
  return { source: null, detail: raw, adjusted: raw ? `Source "${raw}" is not a configured lead source; left empty` : null };
}

// ─── Tags ────────────────────────────────────────────────────────────────────

const configuredTags = (rules) => (Array.isArray(rules?.tags?.tags) ? rules.tags.tags.map((t) => String(t?.name ?? '').trim()).filter(Boolean) : []);

/**
 * Lead tags must come from Customize Your Business -> Lead Tags. Matching is
 * case-insensitive and returns the configured spelling. Tags the contact
 * already carries (`existing`, from Contacts or automations) are kept as they
 * are; only newly added ones are checked.
 * -> { tags, rejected }
 */
export function resolveLeadTags(rules, requested, { strict = true, existing = [] } = {}) {
  const wanted = [...new Set((Array.isArray(requested) ? requested : []).map((t) => String(t ?? '').trim()).filter(Boolean))];
  const allowed = configuredTags(rules);
  if (allowed.length === 0) return { tags: wanted, rejected: [] };

  const had = new Set((existing || []).map(lower));
  const tags = [];
  const rejected = [];
  for (const tag of wanted) {
    if (had.has(lower(tag))) { tags.push(tag); continue; }
    const match = allowed.find((a) => lower(a) === lower(tag));
    if (match) tags.push(match);
    else rejected.push(tag);
  }
  if (rejected.length && strict) {
    throw badRequest(`Unknown lead tag(s): ${rejected.join(', ')}. Add them under Customize Your Business -> Lead Tags first.`);
  }
  return { tags: [...new Set(tags)], rejected };
}

// ─── Prospecting ─────────────────────────────────────────────────────────────

/** Required contact details the prospecting criteria ask for and `info` lacks. */
export function missingRequiredFields(rules, { phone, email, company } = {}) {
  const c = rules?.criteria;
  const missing = [];
  if (c?.requirePhone && !phone) missing.push('phone');
  if (c?.requireEmail && !email) missing.push('email');
  if (c?.requireCompany && !company) missing.push('company');
  return missing;
}

const REQUIRED_MESSAGE = {
  phone: 'Phone number is required based on workspace prospecting criteria.',
  email: 'Email is required based on workspace prospecting criteria.',
  company: 'Company is required based on workspace prospecting criteria.',
};

export function assertRequiredFields(rules, info) {
  const [first] = missingRequiredFields(rules, info);
  if (first) throw badRequest(REQUIRED_MESSAGE[first]);
}

/**
 * Qualification against the prospecting criteria, plus the required-field
 * check. A lead missing a required detail is never qualified.
 */
export function evaluateProspectingCriteria(criteriaConfig, info = {}) {
  const {
    budget = null,
    companySize = null,
    industry = '',
    answers = {},
  } = info;

  const checks = [];
  let score = 0;
  let maxScore = 0;
  let allRequiredPassed = true;

  // 1. Budget check
  if (criteriaConfig?.minBudget != null && Number(criteriaConfig.minBudget) > 0) {
    maxScore += 25;
    const min = Number(criteriaConfig.minBudget);
    const leadBudget = budget != null && budget !== '' ? Number(budget) : null;
    const passed = leadBudget !== null && leadBudget >= min;
    if (!passed) allRequiredPassed = false;
    else score += 25;
    checks.push({
      key: 'minBudget',
      label: `Minimum Budget (${criteriaConfig.currency || 'USD'} ${min})`,
      required: true,
      passed,
      value: leadBudget != null ? `${criteriaConfig.currency || 'USD'} ${leadBudget}` : 'Not provided',
    });
  }

  // 2. Company size check
  if (criteriaConfig?.companySizeMin != null && Number(criteriaConfig.companySizeMin) > 0) {
    maxScore += 20;
    const min = Number(criteriaConfig.companySizeMin);
    const leadSize = companySize != null && companySize !== '' ? Number(companySize) : null;
    const passed = leadSize !== null && leadSize >= min;
    if (!passed) allRequiredPassed = false;
    else score += 20;
    checks.push({
      key: 'companySizeMin',
      label: `Minimum Company Size (${min} employees)`,
      required: true,
      passed,
      value: leadSize != null ? `${leadSize} employees` : 'Not provided',
    });
  }

  // 3. Target industries check
  if (Array.isArray(criteriaConfig?.targetIndustries) && criteriaConfig.targetIndustries.length > 0) {
    maxScore += 15;
    const leadInd = String(industry || '').trim().toLowerCase();
    const passed = Boolean(leadInd) && criteriaConfig.targetIndustries.some(
      (ti) => ti.toLowerCase() === leadInd || leadInd.includes(ti.toLowerCase()) || ti.toLowerCase().includes(leadInd)
    );
    if (passed) score += 15;
    checks.push({
      key: 'targetIndustries',
      label: 'Target Industry Match',
      required: false,
      passed,
      value: industry || 'Not specified',
    });
  }

  // 4. Checklist questions
  if (Array.isArray(criteriaConfig?.checklist) && criteriaConfig.checklist.length > 0) {
    for (const item of criteriaConfig.checklist) {
      const weight = Number(item.weight) || 10;
      maxScore += weight;
      const ans = Boolean(answers[item.id] ?? answers[item.question]);
      if (ans) {
        score += weight;
      } else if (item.required) {
        allRequiredPassed = false;
      }
      checks.push({
        key: item.id,
        label: item.question,
        required: Boolean(item.required),
        passed: ans,
        weight,
      });
    }
  }

  // 5. Required contact details (lenient intake records them here instead of
  //    rejecting the lead).
  const missing = Array.isArray(info.missingRequired) ? info.missingRequired : [];
  for (const field of missing) {
    allRequiredPassed = false;
    checks.push({ key: `require_${field}`, label: `Required: ${field}`, required: true, passed: false, value: 'Not provided' });
  }

  const finalScore = maxScore > 0 ? Math.round((score / maxScore) * 100) : 100;
  const isQualified = allRequiredPassed && (maxScore === 0 || finalScore >= 50);

  const criteriaChecks = {
    budget: checks.find((c) => c.key === 'minBudget')?.passed ?? true,
    companySize: checks.find((c) => c.key === 'companySizeMin')?.passed ?? true,
    industry: checks.find((c) => c.key === 'targetIndustries')?.passed ?? true,
  };

  return {
    score: finalScore,
    isQualified,
    status: isQualified ? 'QUALIFIED' : 'DISQUALIFIED',
    checks,
    criteriaChecks,
    ...(missing.length ? { missingRequired: missing } : {}),
    evaluatedAt: new Date(),
  };
}

// ─── Whole-lead intake ───────────────────────────────────────────────────────

/**
 * Resolves everything a new lead carries from the workspace rules.
 *
 * `input`: { status, source, tags, existingTags, phone, email, company,
 *            budget, companySize, industry, answers, customFields }
 * `options`: { strict, sourceFallbacks }
 *
 * -> { status, statusKey, source, tags, customFields, warnings }
 * customFields carries statusKey, prospecting, qualification and (when a
 * fallback source was used) sourceDetail, merged over input.customFields.
 */
export function prepareLeadIntake(rules, input = {}, { strict = true, sourceFallbacks = [] } = {}) {
  const warnings = [];

  const missing = missingRequiredFields(rules, input);
  if (strict && missing.length) throw badRequest(REQUIRED_MESSAGE[missing[0]]);
  if (missing.length) warnings.push(`Prospecting criteria require ${missing.join(', ')}; marked not qualified`);

  const status = resolveLeadStatus(rules, input.status, { strict });
  if (status.adjusted) warnings.push(status.adjusted);

  const source = resolveLeadSource(rules, input.source, { strict, fallbacks: sourceFallbacks });
  if (source.adjusted) warnings.push(source.adjusted);

  const tags = resolveLeadTags(rules, input.tags, { strict, existing: input.existingTags });
  if (tags.rejected.length) warnings.push(`Tag(s) not configured as lead tags were dropped: ${tags.rejected.join(', ')}`);

  const customFields = input.customFields && typeof input.customFields === 'object' ? { ...input.customFields } : {};
  if (status.statusKey) customFields.statusKey = status.statusKey;
  else delete customFields.statusKey;
  if (source.detail) customFields.sourceDetail = source.detail;

  const prospecting = {
    budget: input.budget ?? null,
    companySize: input.companySize ?? null,
    industry: input.industry ?? null,
    company: input.company ?? null,
    answers: input.answers ?? {},
  };
  customFields.prospecting = prospecting;
  customFields.qualification = evaluateProspectingCriteria(rules?.criteria, { ...prospecting, missingRequired: missing });

  return {
    status: status.status,
    statusKey: status.statusKey,
    source: source.source,
    tags: tags.tags,
    customFields,
    warnings,
  };
}
