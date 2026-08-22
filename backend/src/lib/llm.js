import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

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

// A degraded/slow Gemini response previously had no ceiling and could hold
// a request (e.g. onboarding chat) open indefinitely.
const GEMINI_TIMEOUT_MS = 20000;

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

const RETRY_DELAYS_MS = [400, 1200];

// One attempt against one model.
async function generateOnce(ai, model, contents, json) {
  const res = await ai.models.generateContent({
    model,
    contents,
    config: {
      httpOptions: { timeout: GEMINI_TIMEOUT_MS },
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  });
  return (res.text || '').trim() || null;
}

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
async function callGemini(prompt, system, { json = false } = {}) {
  const ai = gemini();
  if (!ai) return null;
  if (Date.now() < geminiCooldownUntil) return null;

  const contents = system ? `${system}\n\n${prompt}` : prompt;
  const models = [...new Set([env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean))];
  let lastErr = null;

  for (const model of models) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const text = await generateOnce(ai, model, contents, json);
        if (model !== env.GEMINI_MODEL) {
          console.warn(`[llm] Answered with fallback model "${model}" — "${env.GEMINI_MODEL}" was unavailable.`);
        }
        lastFailure = null;
        return text;
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

// Returns a parsed JSON object, or null.
export async function llmJson(prompt, system = '') {
  const raw = await llmText(prompt, system, { json: true });
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
