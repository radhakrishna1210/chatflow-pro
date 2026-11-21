import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { modelChain, cleanModelId } from './aiModel.js';

// Single shared LLM entry point for the whole app. Prefers Gemini (when
// GEMINI_API_KEY is set), then a local Ollama server (dev), and finally returns
// null so callers apply a deterministic fallback rather than crashing or
// hanging. This replaces the old onboarding controller's hard dependency on a
// local Ollama server that never exists in production.

// Rebuilt whenever the key changes, so a key rotated from the admin screen
// takes effect on the next call instead of after a restart.
let _gemini = null;
let _geminiKey = null;
function gemini() {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  if (!_gemini || _geminiKey !== key) {
    _gemini = new GoogleGenAI({ apiKey: key });
    _geminiKey = key;
  }
  return _gemini;
}

// Whether a provider is *configured*. OLLAMA_URL is deliberately not counted:
// it carries a default value, so including it made this function return true
// unconditionally — which is why deployAgent()'s "no LLM configured" guard could
// never fire and an agent reported itself deployed while generating nothing.
// Ollama remains a fallback at call time; it is just not evidence that anything
// is set up.
export function llmAvailable() {
  return !!env.GEMINI_API_KEY;
}

// The last thing a real generation attempt did, for the health endpoint and for
// callers that need to explain a silent fallback. A configured key that the
// provider rejects looks exactly like no key at all from the outside, and that
// ambiguity is what made a revoked key take weeks to notice.
let lastFailure = null;

export function llmHealth() {
  return {
    configured: llmAvailable(),
    model: env.GEMINI_MODEL,
    lastFailure: lastFailure && { ...lastFailure },
    // A key that is present but rejected is the state worth surfacing loudly:
    // every AI feature is silently degraded while the UI shows it as ready.
    keyRejected: lastFailure?.kind === 'auth',
  };
}

// Confirms a key actually works, without spending a real generation. Used when
// a platform credential is saved, so an invalid key is refused at the point
// someone pastes it instead of failing every AI call afterwards.
export async function verifyGeminiKey(apiKey, model = env.GEMINI_MODEL) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, reason: 'No API key supplied' };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => null);
    const message = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, reason: `Google rejected this key: ${message}` };
    }
    if (res.status === 404) {
      return { ok: false, reason: `The key is valid but model "${model}" is not available to it: ${message}` };
    }
    return { ok: false, reason: `Could not verify the key (${message})` };
  } catch (err) {
    return { ok: false, reason: `Could not reach Google to verify the key: ${err.message}` };
  }
}

// Confirms a model id is one the platform's key can actually call, before it
// is saved as the platform default or pinned to a workspace. A typo here does
// not fail loudly — every AI feature using it just stops answering — so it is
// refused at the point someone types it.
//
// `apiKey` defaults to the key in force; it is passed explicitly when a key
// and a model are being saved together, so the model is checked against the
// key that is about to be stored rather than the one being replaced.
export async function verifyGeminiModel(model, apiKey = env.GEMINI_API_KEY) {
  const id = cleanModelId(model);
  if (!id) {
    return { ok: false, reason: `"${String(model).slice(0, 60)}" is not a model id. Use the id as Google lists it, for example gemini-flash-latest.` };
  }
  if (!String(apiKey || '').trim()) {
    return { ok: false, reason: 'Add a Gemini API key first — a model cannot be checked without one.' };
  }
  const check = await verifyGeminiKey(apiKey, id);
  return check.ok ? { ok: true, model: id } : check;
}

// Families that share the generateContent method but are not chat/text models,
// so they must not be offered where a text model is being chosen.
const NOT_TEXT_MODEL = /embedding|imagen|image|veo|tts|audio|live|aqa|robotics|computer-use/i;

// The text models the platform's key can call, straight from Google, for the
// model pickers in Super Admin. Asked live rather than hard-coded: model ids
// are added and retired often enough that a list baked into the app is wrong
// within months — which is exactly how a retired default broke every AI
// feature once already (see GEMINI_MODEL in config/env.js).
export async function listGeminiModels(apiKey = env.GEMINI_API_KEY) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, reason: 'No Gemini API key configured', models: [] };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, reason: body?.error?.message || `Google answered HTTP ${res.status}`, models: [] };
    }
    const models = (Array.isArray(body?.models) ? body.models : [])
      .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => ({ id: cleanModelId(m.name), label: String(m.displayName || '').trim() }))
      .filter((m) => m.id && /^gemini/i.test(m.id) && !NOT_TEXT_MODEL.test(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models };
  } catch (err) {
    return { ok: false, reason: `Could not reach Google to list models: ${err.message}`, models: [] };
  }
}

// A degraded/slow Gemini response previously had no ceiling and could hold
// a request (e.g. onboarding chat) open indefinitely.
const GEMINI_TIMEOUT_MS = 10000;

// Ollama is only reached when Gemini isn't configured or errors, so it's
// already the fallback path — a local model taking 20-30s+ to generate on
// modest hardware made that fallback worse than just skipping it. 8s is
// enough for a warmed-up local model to respond; anything slower means the
// caller's own deterministic (non-LLM) fallback kicks in sooner instead of
// the request stalling.
const OLLAMA_TIMEOUT_MS = 8000;

// When Gemini answers 429 it also says how long to wait. Calling again before
// then cannot succeed, and on a free-tier key (20 requests/day) each doomed
// call spends part of a budget the app needs for real answers — so the client
// stands down for exactly as long as Google asked, and callers fall through to
// their own fallback immediately instead.
let geminiCooldownUntil = 0;

function noteGeminiFailure(err) {
  const message = String(err?.message || '');
  // "API key not valid" is a permanent configuration fault, not an outage.
  // Recording the difference is what lets the health endpoint say which one it
  // is instead of reporting a generic "AI unavailable".
  const kind = /api key not valid|API_KEY_INVALID|PERMISSION_DENIED|unauthenticated/i.test(message)
    ? 'auth'
    : /quota|rate|RESOURCE_EXHAUSTED|429/i.test(message)
      ? 'quota'
      : 'error';
  lastFailure = { kind, message: message.slice(0, 300), at: new Date().toISOString() };
  if (kind === 'auth') {
    console.error(
      '[llm] Gemini rejected the configured API key. Every AI feature (agent replies, intent '
      + 'matching, template drafting, the website assistant) is degraded until it is replaced. '
      + 'Check Super Admin -> API Management, which overrides GEMINI_API_KEY from the environment.',
    );
  }

  const retryAfterSec = Number(
    err?.message?.match(/"retryDelay"\s*:\s*"(\d+)s"/)?.[1]
    ?? err?.message?.match(/retry in (\d+(?:\.\d+)?)s/)?.[1]
    ?? 0,
  );
  if (retryAfterSec > 0) {
    geminiCooldownUntil = Date.now() + retryAfterSec * 1000;
    console.warn(`[llm] Gemini rate-limited — standing down for ${Math.round(retryAfterSec)}s.`);
  }
}

// A transient fault is one that a second attempt can plausibly clear: the
// model being busy (503 UNAVAILABLE), an internal 500, or a timeout. An
// invalid key or a retired model is not — retrying those only wastes time.
function isTransient(err) {
  const m = String(err?.message || '');
  return /\b(503|500|504)\b/.test(m)
    || /UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|overloaded|high demand|try again later/i.test(m);
}

const RETRY_DELAYS_MS = [400];

// One attempt against one model. Returns the text and what the call cost in
// tokens, which is what AI credits are charged on.
async function generateOnce(ai, model, contents, json, timeoutMs = GEMINI_TIMEOUT_MS) {
  const res = await ai.models.generateContent({
    model,
    contents,
    config: {
      httpOptions: { timeout: timeoutMs },
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  });
  const u = res.usageMetadata || {};
  const inputTokens = Number(u.promptTokenCount) || 0;
  // totalTokenCount also covers the model's thinking tokens, which are billed
  // as output but are not part of candidatesTokenCount.
  const outputTokens = Math.max(
    Number(u.candidatesTokenCount) || 0,
    (Number(u.totalTokenCount) || 0) - inputTokens,
  );
  return { text: (res.text || '').trim() || null, usage: { inputTokens, outputTokens, model } };
}

// Roughly four characters to a token. Used only when a provider reports no
// usage (the local Ollama fallback), so a call is never charged as free.
const estimateTokens = (text) => Math.ceil(String(text || '').length / 4);

// Gemini's flash tier answers 503 "experiencing high demand" a meaningful share
// of the time — measured at roughly two calls in five against
// `gemini-flash-latest`. There was no retry and no alternative model, so each
// of those became a silent `null`: the AI agent sent nothing, intent matching
// fell through to token overlap, and the website assistant answered from
// retrieval alone. That is what "the AI is not working" actually looked like.
//
// So a transient failure is retried with a short backoff, and if the preferred
// model is still busy the request moves to GEMINI_FALLBACK_MODEL — a lighter
// model on separate capacity, which is available when the main one is not.
async function callGemini(prompt, system, opts = {}) {
  return (await callGeminiDetailed(prompt, system, opts))?.text ?? null;
}

// As callGemini, but returns { text, usage } so the caller can meter the call.
// `timeoutMs` is for the few callers that ask for a long structured answer
// (the onboarding agent writes a whole setup in one reply) and would always
// hit the default ceiling.
async function callGeminiDetailed(prompt, system, { json = false, timeoutMs } = {}) {
  const ai = gemini();
  if (!ai) return null;
  if (Date.now() < geminiCooldownUntil) return null;

  const contents = system ? `${system}\n\n${prompt}` : prompt;
  // The workspace's own model when the super admin pinned one, then the
  // platform default, then the platform fallback — see lib/aiModel.js.
  const models = modelChain();
  let lastErr = null;

  for (const model of models) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const result = await generateOnce(ai, model, contents, json, timeoutMs);
        if (model !== models[0]) {
          console.warn(`[llm] Answered with fallback model "${model}" — "${models[0]}" was unavailable.`);
        }
        lastFailure = null;
        if (!result.usage.inputTokens) result.usage.inputTokens = estimateTokens(contents);
        if (!result.usage.outputTokens) result.usage.outputTokens = estimateTokens(result.text);
        return result;
      } catch (err) {
        lastErr = err;
        if (!isTransient(err)) break; // permanent for this model: try the next one, or give up
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
      }
    }
  }

  console.error('[llm] Gemini error:', lastErr?.message);
  noteGeminiFailure(lastErr);
  return null;
}

async function callOllama(prompt, system) {
  if (!env.OLLAMA_URL) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    const res = await fetch(`${env.OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.OLLAMA_MODEL, prompt, system, stream: false, options: { temperature: 0.2 } }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.response || '').trim() || null;
  } catch (err) {
    // Ollama is a dev-only convenience — silence the noise in production.
    return null;
  }
}

// Returns generated text, or null if no provider succeeded.
export async function llmText(prompt, system = '', opts = {}) {
  return (await callGemini(prompt, system, opts)) ?? (await callOllama(prompt, system));
}

const parseJsonReply = (raw) => {
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
};

// Returns a parsed JSON object, or null.
export async function llmJson(prompt, system = '') {
  return parseJsonReply(await llmText(prompt, system, { json: true }));
}

// As llmJson, for callers that charge AI credits: returns
// { data, usage: { inputTokens, outputTokens, model } }, or null when no
// provider answered. `data` is null when the model answered but not in JSON —
// that call still cost tokens, so its usage is still reported.
export async function llmJsonMetered(prompt, system = '', { timeoutMs } = {}) {
  const viaGemini = await callGeminiDetailed(prompt, system, { json: true, timeoutMs });
  if (viaGemini?.text) return { data: parseJsonReply(viaGemini.text), usage: viaGemini.usage };

  const text = await callOllama(prompt, system);
  if (!text) return null;
  return {
    data: parseJsonReply(text),
    usage: { inputTokens: estimateTokens(`${system}\n\n${prompt}`), outputTokens: estimateTokens(text), model: env.OLLAMA_MODEL },
  };
}
