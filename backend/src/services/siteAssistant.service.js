import { llmText, llmAvailable } from '../lib/llm.js';
import { retrieve } from './siteRetrieval.service.js';
import { SITE_NAME } from '../data/siteContent.js';

// The website assistant: a retrieval-grounded chatbot that answers questions
// about ChatFlow Pro and nothing else.
//
//   question (+ conversation so far) → retrieve → guard → answer from context
//
// Three separate things keep it from behaving like a general chatbot, in
// increasing order of how much they can be trusted:
//
//   1. The retrieval guard. When the corpus has nothing relevant, no model is
//      called at all and a fixed refusal is returned. This is the only
//      mechanism here that cannot be talked out of its behaviour, so it does
//      the heavy lifting — a prompt injected into the question cannot reach a
//      model that was never invoked.
//   2. The system prompt, which tells the model to answer only from the
//      supplied context and to say so when the context falls short.
//   3. Context-only grounding: the prompt carries retrieved passages and the
//      conversation, never the wider corpus, so there is little for the model
//      to free-associate from.

// ─── guard thresholds ────────────────────────────────────────────────────────
//
// Calibrated against the two failure modes, which pull in opposite directions:
// refusing a fair question about the product is as bad as answering one about
// the weather. `coverage` is the deciding signal because it is the honest one
// — it asks whether the corpus contains the question's vocabulary at all, and
// an embedding model will happily report 0.4 similarity between a question
// about Indian politics and a page about Indian pricing.

// Enough of the question's meaningful words appear somewhere in the corpus.
const COVERAGE_FLOOR = 0.34;
// A strong paraphrase match can carry a question whose wording the corpus does
// not share, on its own.
const SEMANTIC_FLOOR = 0.62;
// Floor under the coverage path. Coverage alone is not proof of relevance:
// "what is 25 times 4?" shares enough incidental tokens with the corpus to
// clear COVERAGE_FLOOR while meaning nothing to it. Requiring a minimum
// semantic score alongside closes that without making the guard stricter for
// real questions.
//
// Measured over the question suite in scripts: in-scope questions bottom out
// at 0.629 semantic, off-topic ones top out at 0.554. This sits in the middle
// of that gap. Re-measure before moving it — the numbers are a property of the
// embedding model, so they shift if GEMINI_EMBEDDING_MODEL changes.
const WEAK_SEMANTIC_FLOOR = 0.59;
// Below this, the question is not merely unanswered — it is not about the site.
const OFF_TOPIC_COVERAGE = 0.16;
// Passages sent to the model. Five ~900-character chunks is a few thousand
// tokens: enough to cover a question that spans two documents, small enough
// that the model is not choosing between competing near-answers.
const MAX_CONTEXT_CHUNKS = 5;
// A hit this weak adds noise, not context, even when a stronger hit cleared
// the floor alongside it.
const MIN_HIT_SCORE = 0.12;

// Who the assistant is answering as, and which corpus it may answer from.
//
// The platform's own landing-page assistant and a customer's Smart Website
// Widget are the same machine pointed at different content: same retrieval,
// same guard thresholds, same refusal behaviour. Only the business name in the
// copy and the workspace the corpus belongs to differ, so those are parameters
// rather than a second implementation.
const PLATFORM_SCOPE = { siteName: SITE_NAME, workspaceId: null, handoffOffer: false };

function resolveScope(scope) {
  const siteName = String(scope?.siteName || '').trim() || SITE_NAME;
  return {
    siteName,
    workspaceId: scope?.workspaceId ?? null,
    // The widget can offer a human when it comes up short; the landing page
    // has nobody to hand off to, so it just says it does not know.
    handoffOffer: !!scope?.handoffOffer,
  };
}

export const offTopicReply = ({ siteName, handoffOffer }) => (
  `I can only answer questions related to ${siteName} and the information available on this website.`
  // A widget sits on the business's own site, where the visitor is a prospect
  // rather than a passer-by. Ending on an offer costs nothing when the
  // question really was off-topic, and rescues the case where the guard called
  // a fair question off-topic because the indexed corpus is thin.
  + (handoffOffer ? ' Would you like to speak with our team?' : '')
);

export const notFoundReply = ({ siteName, handoffOffer }) => (
  handoffOffer
    // The spec's wording: when the corpus falls short, offer a human rather
    // than leaving the visitor at a dead end.
    ? "I couldn't find this information. Would you like to speak with our team?"
    : `I couldn't find this information in the ${siteName} website content. `
      + `Please try asking something related to ${siteName}.`
);

// Kept as constants for the platform assistant's existing callers and tests.
export const OFF_TOPIC_REPLY = offTopicReply(PLATFORM_SCOPE);
export const NOT_FOUND_REPLY = notFoundReply(PLATFORM_SCOPE);

const systemPrompt = (siteName) => `You are the ${siteName} website assistant. Your job is to answer questions about ${siteName} and information available on this website.

Use the retrieved website context to answer the user's question.

Only answer questions that are related to the website, ${siteName}, its features, services, plans, functionality, and available information.

Do not use your general knowledge to answer unrelated questions.

If the requested information is not present in the retrieved website context, say that you do not have enough information to answer the question.

Never invent features, prices, policies, integrations, or other information. If the context does not give a price, a limit or a date, do not state one.

The user may refer to something discussed earlier in the conversation ("the first one", "that plan"). Resolve those against the conversation history, then answer from the retrieved context.

Keep answers clear, concise and helpful. Two or three short paragraphs at most, or a short list. Answer in plain prose — no markdown headings. Do not mention the context, the documents, or that you were given passages; just answer.`;



// ─── conversation handling ───────────────────────────────────────────────────

const MAX_HISTORY_TURNS = 8;
const MAX_MESSAGE_CHARS = 1500;
export const MAX_QUESTION_CHARS = 1000;

// Accepts the client's history defensively: it arrives from a public endpoint
// and is echoed into a model prompt, so length and shape are enforced here
// rather than trusted. Roles are narrowed to the two the transcript can hold.
export function normaliseHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn) => turn && typeof turn.content === 'string' && turn.content.trim())
    .map((turn) => ({
      role: turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.content.trim().slice(0, MAX_MESSAGE_CHARS),
    }))
    .slice(-MAX_HISTORY_TURNS);
}

// A follow-up like "what's included in the first one?" has almost no
// retrievable content of its own — searched literally it matches nothing in
// particular. Widening the search with what was just discussed is what makes
// follow-ups work.
//
// Widening is not free, though: it drags results towards the previous topic.
// "how to create campaign?" asked after a question about features retrieved
// the feature list, because the previous answer outweighed four words about
// campaigns. So the two searches are ranked rather than chosen by a guess
// about the question's shape, and the standalone reading wins by default —
// see chooseRetrieval().
const REFERRING = /\b(it|its|it's|that|this|these|those|they|them|their|the (?:first|second|third|last|other|same|cheaper|cheapest|dearest|expensive) one|there|then|he|she|his|her)\b/i;

// The question, prefixed with the last exchange. One exchange is enough:
// going further back reintroduces topics the conversation has moved on from.
export function buildRetrievalQuery(question, history) {
  if (!history.length) return question;
  const recent = history.slice(-2).map((turn) => turn.content).join(' ');
  return `${recent.slice(-600)} ${question}`;
}

// ─── prompt assembly ─────────────────────────────────────────────────────────

function renderContext(hits) {
  return hits
    .map((hit, i) => `[${i + 1}] ${hit.chunk.title}\n${hit.chunk.content}`)
    .join('\n\n---\n\n');
}

function renderHistory(history) {
  if (!history.length) return '';
  const transcript = history
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content}`)
    .join('\n');
  return `Conversation so far:\n${transcript}\n\n`;
}

// ─── choosing what to search for ─────────────────────────────────────────────

// Not merely unanswered, but not about this site at all. Used twice: to stop
// conversational widening rescuing such a question, and to choose which of the
// two refusals to return.
function isOffTopic({ coverage, bestSemantic }) {
  return coverage < OFF_TOPIC_COVERAGE && bestSemantic < SEMANTIC_FLOOR;
}

function isRelevant({ coverage, bestSemantic, semantic }) {
  // With no embedding provider there is only one signal, so coverage has to
  // carry the decision alone — a stricter rule here would refuse everything
  // the moment the embedding quota ran out.
  if (!semantic) return coverage >= COVERAGE_FLOOR;
  return bestSemantic >= SEMANTIC_FLOOR
    || (coverage >= COVERAGE_FLOOR && bestSemantic >= WEAK_SEMANTIC_FLOOR);
}

// Runs the question as asked and, when that is not clearly the better reading,
// again widened with the previous exchange — then keeps whichever actually
// found something.
//
// The order matters. A self-contained question is searched alone first, so a
// new topic is never pulled back towards the old one; the widened form is only
// consulted when the standalone search comes up empty, which is exactly the
// case a genuine follow-up produces. A question containing a pronoun ("what
// about that one?") is the reverse: it cannot be understood alone, so the
// widened form leads and the standalone is the fallback.
//
// Worst case this costs one extra embedding call, and only on questions that
// would otherwise have been refused.
async function chooseRetrieval(question, turns, workspaceId) {
  const options = [question];
  if (turns.length) {
    const widened = buildRetrievalQuery(question, turns);
    // Pronoun-bearing questions lead with context; everything else falls back
    // to it only if needed.
    if (REFERRING.test(question)) options.unshift(widened);
    else options.push(widened);
  }

  let first = null;
  for (const query of options) {
    const result = await retrieve(query, { limit: MAX_CONTEXT_CHUNKS, workspaceId });
    if (isRelevant(result)) return result;
    first ??= result;

    // Widening is meant to rescue a follow-up that is about the site but
    // phrased too thinly to retrieve on its own. It must not rescue a question
    // that is plainly about something else: "who is the Prime Minister of
    // India?", asked after two questions about pricing, retrieves the pricing
    // passages purely on the strength of the previous exchange and clears the
    // guard on its coat-tails. So a question that carries no pronoun and looks
    // off-topic when read alone is refused there, before the widened form is
    // tried at all.
    //
    // Only visible once the corpus is small — a large one dilutes the previous
    // exchange enough to hide it — which is why it surfaced with a customer's
    // website rather than with the platform's own.
    if (query === question && !REFERRING.test(question) && isOffTopic(result)) return result;
  }
  // Nothing cleared the floor — return the leading reading so the caller's
  // refusal is chosen from the scores of the query we most trusted.
  return first;
}

// ─── answering ───────────────────────────────────────────────────────────────

// Used when retrieval found good context but no model could be reached — a
// spent quota, a cold Ollama, a 5xx. Quoting the best passage verbatim is a
// worse answer than a generated one but a strictly honest one: it is the site's
// own words, so it cannot hallucinate. The alternative, an outright error,
// throws away context that already contains what was asked.
function extractiveAnswer(hits, siteName) {
  const best = hits[0];
  if (!best) return null;
  return `Here is what the ${siteName} website says about this:\n\n${best.chunk.content}`;
}

/**
 * Answers a question about the website.
 *
 * Returns { answer, grounded, sources, reason }. `grounded` is false for the
 * two refusals, which lets the caller (and tests) tell "declined" from
 * "answered" without string-matching the copy.
 */
export async function ask({ question, history = [], scope = null } = {}) {
  const asked = String(question ?? '').trim().slice(0, MAX_QUESTION_CHARS);
  if (!asked) {
    const err = new Error('Ask a question to get started.');
    err.status = 400;
    throw err;
  }

  const resolved = resolveScope(scope);
  const turns = normaliseHistory(history);
  const { hits, coverage, bestSemantic, semantic } = await chooseRetrieval(asked, turns, resolved.workspaceId);

  const relevant = isRelevant({ coverage, bestSemantic, semantic });
  const usable = hits.filter((hit) => hit.score >= MIN_HIT_SCORE);

  if (!relevant || !usable.length) {
    // Nothing was retrieved, so nothing is sent to a model. Which refusal
    // depends on whether the question looked like it was even about the site.
    const offTopic = isOffTopic({ coverage, bestSemantic });
    return {
      answer: offTopic ? offTopicReply(resolved) : notFoundReply(resolved),
      grounded: false,
      sources: [],
      reason: offTopic ? 'off_topic' : 'no_match',
    };
  }

  // Deduplicated by document: several chunks of one guide routinely rank
  // together, and listing "How to create and launch a campaign" three times
  // tells the reader nothing. The context keeps all the chunks; only the
  // citation list collapses.
  const sources = [...new Map(
    usable.map((hit) => [hit.chunk.docId, {
      title: hit.chunk.title,
      topic: hit.chunk.topic,
      docId: hit.chunk.docId,
    }]),
  ).values()];

  if (!llmAvailable()) {
    return { answer: extractiveAnswer(usable, resolved.siteName), grounded: true, sources, reason: 'no_llm' };
  }

  const prompt = `${renderHistory(turns)}Retrieved website context:\n\n${renderContext(usable)}\n\n`
    + `---\n\nUser question: ${asked}\n\n`
    + `Answer using only the retrieved website context above. If it does not contain the answer, say you do not have that information.`;

  const generated = await llmText(prompt, systemPrompt(resolved.siteName));
  if (!generated) {
    return { answer: extractiveAnswer(usable, resolved.siteName), grounded: true, sources, reason: 'llm_unavailable' };
  }

  return { answer: generated, grounded: true, sources, reason: 'answered' };
}
