// Global conversation controls and general-purpose intent detection.
//
// QA found three related gaps (BUG-02, BUG-03, BUG-04):
//
//   * An in-flight form or workflow swallowed everything the customer typed.
//     "bye", "cancel" and "done" were recorded as answers to whatever question
//     was on screen, so there was no way out of a flow short of abandoning the
//     thread.
//   * Everyday messages — "hi", "bye", "working hours", "thanks" — fell through
//     every deterministic layer and reached the model (or nothing at all),
//     which is why the same greeting behaved differently on different days.
//   * Choice questions only accepted the option text verbatim, so "urgently",
//     "very urgent" and the typo "Urrget" were all rejected as invalid.
//
// Everything here is lexical and deterministic on purpose, for the same reason
// intent.service.js is: an operator has to be able to predict what a control
// word does without running the model.

// ── Text normalisation ─────────────────────────────────────────────────────

export const normalise = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const words = (s) => normalise(s).split(' ').filter(Boolean);

// Levenshtein distance, capped: anything past `max` is not worth finishing, and
// bailing out early keeps this cheap enough to run on every inbound message.
export function editDistance(a, b, max = 3) {
  const s = String(a), t = String(b);
  if (s === t) return 0;
  if (Math.abs(s.length - t.length) > max) return max + 1;

  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (row[j] < rowMin) rowMin = row[j];
    }
    if (rowMin > max) return max + 1;
    prev = row;
  }
  return prev[t.length];
}

// How much typo slack a word of this length earns. Short words get none —
// "low" and "how" are one edit apart and must not be confused. Six letters and
// up earn two, which is what it takes to recognise QA's "Urrget" as "Urgent";
// matchOption() guards the extra reach with an ambiguity check.
const slackFor = (word) => (word.length <= 3 ? 0 : word.length <= 5 ? 1 : 2);

// Is `word` this term, allowing for a typo proportional to its length?
export function looksLike(word, term) {
  if (word === term) return true;
  const slack = Math.min(slackFor(term), slackFor(word));
  if (slack === 0) return false;
  return editDistance(word, term, slack) <= slack;
}

// ── Global control commands (BUG-02) ───────────────────────────────────────
//
// Recognised anywhere a flow is waiting on the customer. Kept to short, whole
// messages: someone typing "I want to cancel my order" is raising a support
// case, not asking to leave the form, so only a message that is essentially the
// command itself counts.

const CONTROL_COMMANDS = {
  cancel:  ['cancel', 'stop', 'quit', 'exit', 'abort', 'nevermind', 'never mind', 'forget it'],
  restart: ['restart', 'start over', 'start again', 'reset', 'begin again'],
  done:    ['done', 'finished', 'complete', 'thats all', 'that is all', 'no more'],
  goodbye: ['bye', 'goodbye', 'bye bye', 'see you', 'good bye', 'thanks bye'],
  human:   ['human', 'agent', 'representative', 'operator', 'talk to a person', 'speak to a person',
            'talk to someone', 'speak to someone', 'real person', 'customer care'],
  help:    ['help', 'menu', 'options', 'what can you do', 'commands'],
};

// The longest a message can be and still be read as a bare control word. Four
// words covers "i want to stop" and "please start over" without catching prose.
const MAX_CONTROL_WORDS = 4;

const FILLER = new Set(['i', 'id', 'want', 'wanna', 'to', 'please', 'pls', 'plz', 'just', 'can', 'you',
  'we', 'lets', 'let', 'us', 'me', 'now', 'the', 'this', 'it', 'ok', 'okay']);

/**
 * Reads a message as a global control command.
 * @returns {null | { command: 'cancel'|'restart'|'done'|'goodbye'|'human'|'help', matched: string }}
 */
export function detectControlCommand(message) {
  const text = normalise(message);
  if (!text) return null;

  const all = words(text);
  if (all.length > MAX_CONTROL_WORDS) return null;

  // Strip politeness so "please stop" and "i want to cancel" reduce to the verb.
  const core = all.filter((w) => !FILLER.has(w));
  if (core.length === 0) return null;
  const stripped = core.join(' ');

  for (const [command, phrases] of Object.entries(CONTROL_COMMANDS)) {
    for (const phrase of phrases) {
      if (stripped === phrase || text === phrase) return { command, matched: phrase };
    }
  }

  // Single-word messages get typo tolerance; multi-word ones do not, because a
  // fuzzy match across a whole sentence is where false positives come from.
  if (core.length === 1) {
    for (const [command, phrases] of Object.entries(CONTROL_COMMANDS)) {
      for (const phrase of phrases) {
        if (!phrase.includes(' ') && looksLike(core[0], phrase)) return { command, matched: phrase };
      }
    }
  }
  return null;
}

// Commands that should tear down whatever flow is running. `done` ends the flow
// too, but acknowledges it as finished rather than abandoned.
const INTERRUPTING = new Set(['cancel', 'restart', 'done', 'goodbye', 'human']);
export const interruptsFlow = (command) => INTERRUPTING.has(command);

// What to say when a flow is torn down by a control word. `restart` and `human`
// are answered by their callers, which do something further.
export const CONTROL_REPLIES = {
  cancel:  'No problem — cancelled. Send me a message whenever you want to start again.',
  done:    "Great — all done. I've closed this off. Message me any time if you need anything else.",
  goodbye: 'Goodbye! Thanks for getting in touch — message us any time.',
};

// ── General conversational intents (BUG-03) ────────────────────────────────
//
// The everyday messages every business receives. These are matched only after
// the workspace's own configured automations have had their turn, so a
// workspace that has built a "Greeting" trigger keeps using it; this is the
// safety net for the ones that have not.

const GENERAL_INTENTS = {
  greeting:       ['hi', 'hii', 'hiii', 'hello', 'hey', 'heya', 'hiya', 'yo', 'good morning',
                   'good afternoon', 'good evening', 'greetings', 'namaste', 'hi there', 'hello there'],
  goodbye:        ['bye', 'goodbye', 'good bye', 'see you', 'see ya', 'take care', 'catch you later'],
  thanks:         ['thanks', 'thank you', 'thankyou', 'thx', 'ty', 'appreciate it', 'much appreciated', 'cheers'],
  business_hours: ['working hours', 'business hours', 'opening hours', 'open hours', 'office hours',
                   'what time do you open', 'what time do you close', 'when are you open',
                   'are you open', 'timings', 'timing', 'store hours'],
  help:           ['help', 'menu', 'options', 'what can you do', 'how does this work', 'support options'],
  human:          ['human', 'agent', 'representative', 'operator', 'talk to a person', 'speak to a person',
                   'talk to someone', 'speak to someone', 'real person', 'customer care', 'customer service'],
};

// Longest-first so "good bye" is tested before "bye" and "working hours" before
// "hours" — otherwise a short phrase claims a message the longer one describes.
const GENERAL_ENTRIES = Object.entries(GENERAL_INTENTS)
  .flatMap(([intent, phrases]) => phrases.map((phrase) => ({ intent, phrase })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

const MAX_GENERAL_WORDS = 6;

/**
 * Classifies an everyday message.
 * @returns {null | { intent: string, phrase: string, confidence: number }}
 */
export function detectGeneralIntent(message) {
  const text = normalise(message);
  if (!text) return null;
  const all = words(text);
  // Long messages are real questions; the model is a better answer than a
  // canned greeting that happened to share a word with them.
  if (all.length > MAX_GENERAL_WORDS) return null;

  for (const { intent, phrase } of GENERAL_ENTRIES) {
    if (text === phrase) return { intent, phrase, confidence: 1 };
  }
  // A multi-word phrase contained in a short message still counts — "hi, what
  // are your working hours" is a business-hours question.
  for (const { intent, phrase } of GENERAL_ENTRIES) {
    if (phrase.includes(' ') && text.includes(phrase)) return { intent, phrase, confidence: 0.9 };
  }
  if (all.length === 1) {
    for (const { intent, phrase } of GENERAL_ENTRIES) {
      if (!phrase.includes(' ') && looksLike(all[0], phrase)) return { intent, phrase, confidence: 0.8 };
    }
  }
  return null;
}

// ── Fuzzy option matching (BUG-04) ─────────────────────────────────────────
//
// Choice questions ("Urgent / Normal / Low") were exact-match only. Customers
// answer them in prose, so an answer counts when it is the option, a number,
// a known synonym, or the option word with a typo in it.

const OPTION_SYNONYMS = {
  urgent:    ['urgently', 'very urgent', 'asap', 'emergency', 'critical', 'immediately', 'high', 'high priority', 'right away'],
  normal:    ['medium', 'regular', 'standard', 'average', 'moderate', 'normal priority'],
  low:       ['low priority', 'not urgent', 'whenever', 'no rush', 'minor', 'later'],
  yes:       ['yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'correct', 'right', 'affirmative', 'y'],
  no:        ['nope', 'nah', 'negative', 'not really', 'n'],
  technical: ['technical issue', 'technical problem', 'tech issue', 'tech problem', 'not working', 'broken', 'bug', 'error'],
  billing:   ['payment', 'invoice', 'charge', 'refund', 'money', 'billing issue'],
  order:     ['order issue', 'my order', 'order problem', 'purchase', 'delivery'],
};

// Words that add nothing to an option answer — dropped before comparing so
// "this is urgent" and "very urgent please" both reduce to "urgent".
const ANSWER_FILLER = new Set(['this', 'is', 'its', 'it', 'the', 'a', 'an', 'my', 'i', 'am', 'very', 'really',
  'quite', 'so', 'please', 'pls', 'would', 'like', 'want', 'need', 'option', 'choose', 'select', 'pick', 'and']);

const strip = (s) => words(s).filter((w) => !ANSWER_FILLER.has(w)).join(' ');

/**
 * Resolves a free-text answer to one of `options`.
 * @returns {null | { option: string, index: number, confidence: number }}
 */
export function matchOption(answer, options) {
  const list = (Array.isArray(options) ? options : []).map((o) => String(o ?? ''));
  if (list.length === 0) return null;

  const raw = String(answer ?? '').trim();
  if (!raw) return null;

  // "2" picks the second option — the prompt numbers them.
  const index = Number.parseInt(raw, 10);
  if (String(index) === raw && index >= 1 && index <= list.length) {
    return { option: list[index - 1], index: index - 1, confidence: 1 };
  }

  const text = normalise(raw);
  const bare = strip(raw);

  const exact = list.findIndex((o) => normalise(o) === text);
  if (exact !== -1) return { option: list[exact], index: exact, confidence: 1 };

  const stripped = list.findIndex((o) => strip(o) === bare && bare.length > 0);
  if (stripped !== -1) return { option: list[stripped], index: stripped, confidence: 0.95 };

  // The option appears inside the answer: "I'd say normal please".
  const contained = list.findIndex((o) => {
    const n = normalise(o);
    return n.length >= 3 && (text.includes(n) || (strip(o).length > 0 && bare.includes(strip(o))));
  });
  if (contained !== -1) return { option: list[contained], index: contained, confidence: 0.85 };

  // A known synonym of one of the options.
  const viaSynonym = list.findIndex((o) => {
    const key = normalise(o);
    const synonyms = OPTION_SYNONYMS[key] || OPTION_SYNONYMS[key.split(' ')[0]];
    if (!synonyms) return false;
    return synonyms.some((s) => text === s || bare === s || text.includes(s) || bare.includes(s));
  });
  if (viaSynonym !== -1) return { option: list[viaSynonym], index: viaSynonym, confidence: 0.8 };

  // Last resort: a typo. Compared word by word so "Urrget" matches "Urgent"
  // inside a longer answer, and only the closest option wins.
  const answerWords = words(bare.length ? bare : text);
  const closest = list.map((o, i) => {
    let distance = Infinity;
    for (const optionWord of words(o)) {
      for (const w of answerWords) {
        const slack = Math.min(slackFor(optionWord), slackFor(w));
        if (slack === 0) continue;
        const d = editDistance(w, optionWord, slack);
        if (d <= slack && d < distance) distance = d;
      }
    }
    return { option: o, index: i, distance };
  }).filter((c) => c.distance !== Infinity).sort((a, b) => a.distance - b.distance);

  // Two options equally close to the typo means we cannot tell which was meant.
  // Re-asking is better than filing the answer under the wrong one.
  if (closest.length === 0) return null;
  if (closest.length > 1 && closest[1].distance === closest[0].distance) return null;

  const best = closest[0];
  return { option: best.option, index: best.index, confidence: best.distance === 1 ? 0.75 : 0.65 };
}
