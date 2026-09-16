// Evidence ledger for the autonomous agent.
//
// Modelled on the one in trycompai/crm (MIT, Copyright (c) 2026 Comp AI):
// tools report what they observed, the ledger prices it, and the price decides
// whether a claim is written to the record or held back as a suggestion. No
// tool is allowed to hand in a confidence score — a number a model made up is
// not evidence, and accepting one would make the whole ledger decorative.
//
// The kinds below differ from theirs because the observable signals differ.
// Theirs researches the open web (LinkedIn profiles, GitHub accounts, cited
// pages); this agent reads a workspace's own messaging and CRM history, so the
// strong kinds are things the database can be asked about directly.
//
// Weights are deliberately coarse. The distinction that matters is
// "could a rep check this in ten seconds" versus "this is an inference".

export const WEIGHTS = {
  // ── primary: a specific, checkable record exists ──────────────────────────
  'crm.inbound-reply': {
    weight: 0.9,
    primary: true,
    label: 'they replied to us on a thread we have',
  },
  'crm.form-submission': {
    weight: 0.9,
    primary: true,
    label: 'they filled in one of our forms themselves',
  },
  'crm.stage-history': {
    weight: 0.85,
    primary: true,
    label: 'the deal\'s own stage history says so',
  },
  'crm.opted-out': {
    weight: 0.95,
    primary: true,
    label: 'they asked not to be contacted',
  },
  'crm.task-record': {
    weight: 0.8,
    primary: true,
    label: 'a task record shows it',
  },
  'crm.outbound-delivered': {
    weight: 0.75,
    primary: true,
    label: 'we sent them a message and it was delivered',
  },

  // ── secondary: real, but an inference from absence or aggregate ───────────
  'crm.no-activity-window': {
    weight: 0.45,
    primary: false,
    label: 'nothing has been logged for a while',
  },
  'crm.score-threshold': {
    weight: 0.4,
    primary: false,
    label: 'the lead score crossed a threshold',
  },
  'crm.field-blank': {
    weight: 0.35,
    primary: false,
    label: 'the field is simply empty',
  },

  // ── negative: pushes a claim down rather than up ──────────────────────────
  //
  // Kept as a first-class kind, as theirs does. Two sources disagreeing is a
  // fact about the world, and a ledger with no way to say so quietly resolves
  // the conflict in favour of whichever source was read last.
  contradiction: {
    weight: -0.6,
    primary: false,
    label: 'another source says otherwise',
  },
};

export const EVIDENCE_KINDS = Object.keys(WEIGHTS);

// A claim is written only if something primary supports it AND the total clears
// this. Both conditions matter: three weak signals should not add up to a fact.
const STRONG_AT = 0.7;

// Not every autonomous act is a claim about a person, and holding them to one
// bar was wrong. Two classes:
//
//   assertion  — states something about a record ("they are now CONTACTED").
//                Being confidently wrong here puts a falsehood in front of a
//                rep, so it needs a primary observation.
//
//   reminder   — schedules reversible work for a human ("follow up on this").
//                Its trigger is usually an *absence* — nothing logged, no next
//                step — and absence can never be primary, so demanding primary
//                evidence meant this class could never fire at all. The bar
//                that matters is instead: did the trigger condition verify.
//
// Worth being explicit that this is a divergence from trycompai/crm's single
// ledger. Theirs prices facts about people, where one bar is right. Ours also
// schedules work, and a reminder nobody asked for costs a rep ten seconds
// while a wrong fact about a customer costs them the relationship.
export const ACTION_CLASS = { ASSERTION: 'assertion', REMINDER: 'reminder' };

const REMINDER_AT = 0.4;

/**
 * Prices a set of observations.
 *
 * Returns { score, band, rationale }. `band` is STRONG (apply it) or WEAK
 * (offer it), or null when there is nothing usable at all.
 */
export function scoreEvidence(evidence, actionClass = ACTION_CLASS.ASSERTION) {
  const rows = Array.isArray(evidence) ? evidence : [];
  const known = rows.filter((e) => e && WEIGHTS[e.kind]);

  if (known.length === 0) {
    return { score: 0, band: null, rationale: 'No recognised evidence was supplied.' };
  }

  // Diminishing returns on repeats: two LinkedIn-ish signals of the same kind
  // are one observation seen twice, not two independent confirmations.
  const bestPerKind = new Map();
  for (const e of known) {
    if (!bestPerKind.has(e.kind)) bestPerKind.set(e.kind, e);
  }
  const distinct = [...bestPerKind.values()];

  const score = distinct.reduce((sum, e) => sum + WEIGHTS[e.kind].weight, 0);
  const hasPrimary = distinct.some((e) => WEIGHTS[e.kind].primary);
  const contradicted = distinct.some((e) => e.kind === 'contradiction');

  const reminder = actionClass === ACTION_CLASS.REMINDER;
  const clears = reminder ? score >= REMINDER_AT : (hasPrimary && score >= STRONG_AT);
  const band = clears && !contradicted ? 'STRONG' : 'WEAK';

  const parts = distinct.map((e) => WEIGHTS[e.kind].label);
  const rationale = contradicted
    ? `Held back — ${parts.join('; ')}.`
    : band === 'STRONG'
      ? `${reminder ? 'Scheduled' : 'Applied'} — ${parts.join('; ')}.`
      : hasPrimary || reminder
        ? `Held back — ${parts.join('; ')}; not enough on its own.`
        : `Held back — ${parts.join('; ')}; nothing directly observed.`;

  return { score: Number(score.toFixed(3)), band, rationale };
}

export const __testing = { STRONG_AT, REMINDER_AT };
