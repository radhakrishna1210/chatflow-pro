import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

// Text embeddings for the website assistant's knowledge index.
//
// Deliberately a sibling of lib/llm.js rather than part of it: embeddings are
// a different model family with a different quota, and the two fail
// independently. A key that has exhausted its generation budget can still
// embed, and vice versa, so folding them together would make one outage look
// like the other.
//
// The contract is the same as llmText(): return null when no provider could
// answer, never throw. Every caller here has a lexical fallback, so a null is
// a downgrade in ranking quality, not a broken feature — which is the whole
// reason the assistant keeps working on a free-tier key that has run out.

let _client = null;
let _clientKey = null;
function client() {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  // Rebuilt when the key changes so a rotation from the admin screen takes
  // effect on the next call, matching lib/llm.js.
  if (!_client || _clientKey !== key) {
    _client = new GoogleGenAI({ apiKey: key });
    _clientKey = key;
  }
  return _client;
}

export function embeddingsAvailable() {
  return !!env.GEMINI_API_KEY;
}

export const EMBEDDING_DIM = env.GEMINI_EMBEDDING_DIM;

// Indexing is a background job and can afford to wait longer than a user's
// question can. Queries get the short ceiling because someone is watching a
// spinner; a slow embedding there is worse than none, since the lexical
// scorer is already able to answer.
const DOC_TIMEOUT_MS = 30000;
const QUERY_TIMEOUT_MS = 6000;

// Requests per call. The API takes an array, and one round trip for 16 chunks
// beats 16 round trips — but an oversized batch is also a single point of
// failure, and on a rate-limited key a smaller batch means a partial index
// rather than none.
const BATCH_SIZE = 16;

// Same stand-down discipline as lib/llm.js: when Google answers 429 it says
// how long to wait, and calling again before then cannot succeed. Tracked
// separately from the generation cooldown because the quotas are separate.
let cooldownUntil = 0;

function noteFailure(err) {
  const retryAfterSec = Number(
    err?.message?.match(/"retryDelay"\s*:\s*"(\d+)s"/)?.[1]
    ?? err?.message?.match(/retry in (\d+(?:\.\d+)?)s/)?.[1]
    ?? 0,
  );
  if (retryAfterSec > 0) {
    cooldownUntil = Date.now() + retryAfterSec * 1000;
    console.warn(`[embeddings] Rate-limited — standing down for ${Math.round(retryAfterSec)}s.`);
  }
}

export function embeddingsCoolingDown() {
  return Date.now() < cooldownUntil;
}

// Unit-normalised, so cosine similarity is a plain dot product at query time
// and the ranking loop does no square roots. Returns null for a zero vector,
// which has no direction to compare against.
function normalise(values) {
  let sumSquares = 0;
  for (const v of values) sumSquares += v * v;
  if (!(sumSquares > 0)) return null;
  const inverseLength = 1 / Math.sqrt(sumSquares);
  return values.map((v) => v * inverseLength);
}

async function embedBatch(texts, { taskType, timeoutMs }) {
  const ai = client();
  if (!ai) return null;
  if (embeddingsCoolingDown()) return null;
  try {
    const res = await ai.models.embedContent({
      model: env.GEMINI_EMBEDDING_MODEL,
      contents: texts,
      config: {
        taskType,
        outputDimensionality: EMBEDDING_DIM,
        httpOptions: { timeout: timeoutMs },
      },
    });
    const rows = res?.embeddings;
    // A short array would silently misalign vectors with their chunks, which
    // is worse than no index at all — the assistant would cite the wrong page.
    if (!Array.isArray(rows) || rows.length !== texts.length) return null;
    return rows.map((row) => {
      const values = row?.values;
      return Array.isArray(values) && values.length ? normalise(values) : null;
    });
  } catch (err) {
    console.error('[embeddings] error:', err.message);
    noteFailure(err);
    return null;
  }
}

// Embeds documents for storage. Returns an array the same length as `texts`,
// holding a unit vector or null per entry — a partial result is useful, since
// the chunks that did embed are better retrievable than the ones that didn't,
// and the next sync retries only the nulls.
//
// RETRIEVAL_DOCUMENT/RETRIEVAL_QUERY are an asymmetric pair: the model places
// a passage and a question that the passage answers near each other, which a
// single symmetric task type does not do nearly as well.
export async function embedDocuments(texts) {
  if (!texts.length) return [];
  const out = new Array(texts.length).fill(null);
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const slice = texts.slice(start, start + BATCH_SIZE);
    const vectors = await embedBatch(slice, {
      taskType: 'RETRIEVAL_DOCUMENT',
      timeoutMs: DOC_TIMEOUT_MS,
    });
    // A cooldown mid-corpus means the rest of the batches would fail too;
    // stop and let the caller persist what it has.
    if (!vectors) {
      if (embeddingsCoolingDown()) break;
      continue;
    }
    for (let i = 0; i < vectors.length; i++) out[start + i] = vectors[i];
  }
  return out;
}

// Embeds one search query. Null means "rank lexically instead".
export async function embedQuery(text) {
  const vectors = await embedBatch([text], {
    taskType: 'RETRIEVAL_QUERY',
    timeoutMs: QUERY_TIMEOUT_MS,
  });
  return vectors?.[0] ?? null;
}

// Dot product of two unit vectors — cosine similarity, in [-1, 1]. Mismatched
// widths mean the index was built under a different GEMINI_EMBEDDING_DIM and
// the comparison is meaningless, so it scores zero rather than throwing.
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return total;
}
