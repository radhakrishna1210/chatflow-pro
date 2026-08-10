import { loadIndex, embeddableText } from './siteKnowledge.service.js';
import { embedQuery, cosine, EMBEDDING_DIM } from '../lib/embeddings.js';

// Retrieval for the website assistant: given a question, return the handful of
// indexed chunks most likely to contain the answer — or nothing, when the
// corpus plainly does not cover it.
//
// Two scorers run over the same chunks and their results are blended.
//
//   Semantic — cosine distance between the question's embedding and each
//   chunk's. Handles paraphrase: "how much does it cost" finds a passage that
//   says "priced at", with no shared vocabulary.
//
//   Lexical — BM25 over the chunk text. Handles the exact tokens embeddings
//   are worst at: a plan name, "STOP", "Razorpay", "API key". It also needs no
//   provider, which is what keeps the assistant answering when the embedding
//   quota is spent.
//
// Neither alone is enough. Semantic-only misses literal names; lexical-only
// misses every question phrased differently from the docs. Running both and
// combining is the cheapest way to have both properties, at a corpus size
// where scanning everything costs nothing.

const K1 = 1.2;   // BM25 term-frequency saturation
const B = 0.75;   // BM25 length normalisation

// Words carrying no retrieval signal. Kept deliberately short: an aggressive
// list strips the words that distinguish two questions from each other, and
// with a corpus this small the cost of a common word is negligible.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing',
  'have', 'has', 'had', 'having', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'into', 'about',
  'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'shall',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'there', 'here', 'so', 'not', 'no', 'yes', 'please', 'tell', 'give',
]);

// Light suffix stripping, applied to documents and queries alike.
//
// Without it BM25 compares raw word forms, and "how do I connect an
// integration?" scored exactly zero against the Integrations guide — which
// says "Integrations" and "connecting". The document had the best semantic
// score of anything in the corpus and still ranked fifth, because half the
// blend was reporting no match at all.
//
// Deliberately not a full Porter stemmer: this is a hundred-chunk corpus of
// plain product prose, where plurals and -ing/-ed verb forms are essentially
// all of the variation. The length guards stop it mangling short words
// ("use"/"used" is left alone rather than reduced to "us").
function stem(token) {
  if (token.length <= 4) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;   // replies -> reply
  if (token.endsWith('sses')) return token.slice(0, -2);        // classes -> class
  // Plain plural. "ss" and "us" endings are not plurals (address, status).
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) {
    return token.slice(0, -1);                                  // integrations -> integration
  }
  for (const suffix of ['ing', 'ed']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      return token.slice(0, -suffix.length);                    // connecting -> connect
    }
  }
  return token;
}

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    // Keep digits: "10,000 messages" and "gemini-2" carry real signal.
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

// ─── lexical index ───────────────────────────────────────────────────────────

// Keyed on the chunk array's identity. loadIndex() returns a stable array per
// scope until that scope is invalidated, so a Map keyed on the array itself
// gives one lexical index per corpus with no explicit scope plumbing — and a
// WeakMap lets a replaced index be collected rather than pinned forever.
const lexicalByChunks = new WeakMap();

function buildLexical(chunks) {
  const documentFrequency = new Map();
  const documents = chunks.map((chunk) => {
    const counts = new Map();
    for (const token of tokenize(embeddableText(chunk))) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    for (const token of counts.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
    return { counts, length: [...counts.values()].reduce((a, b) => a + b, 0) };
  });
  const totalLength = documents.reduce((sum, doc) => sum + doc.length, 0);
  return {
    documents,
    documentFrequency,
    count: chunks.length,
    averageLength: chunks.length ? totalLength / chunks.length : 0,
  };
}

function lexicalIndex(chunks) {
  const held = lexicalByChunks.get(chunks);
  if (held) return held;
  const built = buildLexical(chunks);
  lexicalByChunks.set(chunks, built);
  return built;
}

// Standard BM25 inverse document frequency. A term in no document at all gets
// the largest weight, which is what makes `coverage` below able to notice that
// a question is about something the corpus has never heard of.
function idf(index, term) {
  const df = index.documentFrequency.get(term) ?? 0;
  return Math.log(1 + (index.count - df + 0.5) / (df + 0.5));
}

// ─── scoring ─────────────────────────────────────────────────────────────────

// Maps an unbounded BM25 score onto (0, 1) so it can be blended with a cosine.
// The constant sets what counts as "a strong lexical match" — at BM25 = 8 this
// returns 0.5.
function saturate(score) {
  return score / (score + 8);
}

// `workspaceId` picks the corpus: null searches the platform's own site
// content, a workspace id searches that customer's indexed website. The
// lexical index is keyed on the chunk array's identity, so switching scopes
// rebuilds it automatically — see lexicalIndex().
export async function retrieve(query, { limit = 5, workspaceId = null } = {}) {
  const chunks = await loadIndex(workspaceId);
  if (!chunks.length) return { hits: [], best: 0, coverage: 0, semantic: false };

  const index = lexicalIndex(chunks);
  const terms = tokenize(query);

  // Weight of the question's vocabulary, and how much of that weight the
  // corpus can account for at all. A question made of terms that appear in no
  // document scores 0 here however the embeddings feel about it — this is the
  // signal that catches "who is the Prime Minister of India".
  const weights = new Map();
  let totalWeight = 0;
  for (const term of new Set(terms)) {
    const weight = idf(index, term);
    weights.set(term, weight);
    totalWeight += weight;
  }

  const queryVector = await embedQuery(query);
  const semantic = !!queryVector;

  const scored = chunks.map((chunk, i) => {
    const doc = index.documents[i];
    let bm25 = 0;
    let covered = 0;
    for (const [term, weight] of weights) {
      const tf = doc.counts.get(term) ?? 0;
      if (!tf) continue;
      covered += weight;
      const norm = 1 - B + (B * doc.length) / (index.averageLength || 1);
      bm25 += weight * ((tf * (K1 + 1)) / (tf + K1 * norm));
    }
    const lexicalScore = saturate(bm25);
    const coverage = totalWeight > 0 ? covered / totalWeight : 0;

    // Cosine runs in [-1, 1]; the negative half means "about something else"
    // and is clamped away rather than allowed to drag a blend negative.
    const semanticScore = semantic && chunk.embedding?.length === EMBEDDING_DIM
      ? Math.max(0, cosine(queryVector, chunk.embedding))
      : 0;

    // Weighted towards semantics when they are available, because paraphrase
    // is the common case and BM25 already contributes the literal matches it
    // is good at. With no embeddings the lexical score carries the whole
    // ranking rather than being scaled down to a third of it.
    const score = semanticScore > 0
      ? 0.65 * semanticScore + 0.35 * lexicalScore
      : lexicalScore;

    return { chunk, score, semanticScore, lexicalScore, coverage };
  });

  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, limit);

  return {
    hits,
    best: hits[0]?.score ?? 0,
    // Best coverage anywhere in the corpus, not just among the returned hits:
    // it answers "does anything here know these words at all?"
    coverage: scored.reduce((max, row) => Math.max(max, row.coverage), 0),
    bestSemantic: scored.reduce((max, row) => Math.max(max, row.semanticScore), 0),
    semantic,
  };
}
