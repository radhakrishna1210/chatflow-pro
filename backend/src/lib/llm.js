import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

// Single shared LLM entry point for the whole app. Prefers Gemini (when
// GEMINI_API_KEY is set), then a local Ollama server (dev), and finally returns
// null so callers apply a deterministic fallback rather than crashing or
// hanging. This replaces the old onboarding controller's hard dependency on a
// local Ollama server that never exists in production.

let _gemini = null;
function gemini() {
  if (!env.GEMINI_API_KEY) return null;
  if (!_gemini) _gemini = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return _gemini;
}

export function llmAvailable() {
  return !!env.GEMINI_API_KEY || !!env.OLLAMA_URL;
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

async function callGemini(prompt, system, { json = false } = {}) {
  const ai = gemini();
  if (!ai) return null;
  try {
    const contents = system ? `${system}\n\n${prompt}` : prompt;
    const res = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents,
      config: {
        httpOptions: { timeout: GEMINI_TIMEOUT_MS },
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    });
    return (res.text || '').trim() || null;
  } catch (err) {
    console.error('[llm] Gemini error:', err.message);
    return null;
  }
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
